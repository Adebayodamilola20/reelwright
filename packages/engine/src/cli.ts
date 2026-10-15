#!/usr/bin/env node
/**
 * ve-cli — headless entry point for the engine (Agent 1's E2E harness).
 *
 *   ve-cli demo <dir>              Full end-to-end slice: generate tiny media,
 *                                  create/save/reopen project, timeline ops,
 *                                  export with progress + honest failure demo.
 *   ve-cli probe <file>            Print ffprobe-derived asset metadata.
 *   ve-cli export <project> <out>  Export an existing .veproj (removes nothing).
 */

import { spawn } from 'node:child_process';
import { mkdirSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createEngine } from './engine.js';
import { ffprobeJson } from './media/probe.js';
import { resolveTool } from './media/tools.js';
import { TICKS_PER_SECOND, formatTimecode, secFromTicks } from './time.js';
import { toErrorShape } from './errors.js';
import type { EngineInstance } from './engine.js';
import type { EngineEvents } from './api.js';

function run(bin: string, args: string[]): Promise<void> {
  return new Promise((res, rej) => {
    const child = spawn(bin, args, { stdio: ['ignore', 'inherit', 'inherit'] });
    child.on('error', rej);
    child.on('close', (code) => (code === 0 ? res() : rej(new Error(`${bin} exited ${code}`))));
  });
}

function log(msg: string): void {
  process.stdout.write(`[demo] ${msg}\n`);
}

function waitForExport(engine: EngineInstance, exportId: string): Promise<void> {
  return new Promise((res, rej) => {
    const offs = [
      engine.on('export:done', (p: EngineEvents['export:done']) => {
        if (p.exportId === exportId) { cleanup(); res(); }
      }),
      engine.on('export:error', (p: EngineEvents['export:error']) => {
        if (p.exportId === exportId) { cleanup(); rej(new Error(`${p.error.code}: ${p.error.message}`)); }
      }),
      engine.on('export:cancelled', (p: EngineEvents['export:cancelled']) => {
        if (p.exportId === exportId) { cleanup(); rej(new Error('cancelled')); }
      }),
    ];
    const offs2 = [
      engine.on('export:progress', (p: EngineEvents['export:progress']) => {
        if (p.exportId === exportId && p.percent !== null) {
          process.stdout.write(`\r[demo] export ${p.percent.toFixed(1)}%   `);
        }
      }),
    ];
    function cleanup(): void {
      process.stdout.write('\n');
      for (const off of [...offs, ...offs2]) off();
    }
  });
}

async function generateFixtures(dir: string): Promise<{ video: string; tone: string; still: string }> {
  const mediaDir = join(dir, 'media');
  mkdirSync(mediaDir, { recursive: true });
  const ffmpeg = resolveTool('ffmpeg');
  const video = join(mediaDir, 'sample-video.mp4');
  const tone = join(mediaDir, 'tone.wav');
  const still = join(mediaDir, 'still.png');
  if (!existsSync(video)) {
    await run(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y',
      '-f', 'lavfi', '-i', 'testsrc2=size=320x240:rate=30:duration=4',
      '-f', 'lavfi', '-i', 'sine=frequency=440:duration=4',
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', video]);
  }
  if (!existsSync(tone)) {
    await run(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y',
      '-f', 'lavfi', '-i', 'sine=frequency=880:duration=3',
      '-c:a', 'pcm_s16le', tone]);
  }
  if (!existsSync(still)) {
    await run(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y',
      '-f', 'lavfi', '-i', 'testsrc2=size=320x240:rate=30:duration=1',
      '-frames:v', '1', still]);
  }
  return { video, tone, still };
}

async function demo(dirRaw: string): Promise<void> {
  const dir = resolve(dirRaw);
  mkdirSync(dir, { recursive: true });
  const { video, tone, still } = await generateFixtures(dir);
  log('fixtures generated (ffmpeg lavfi — no downloads)');

  const engine = createEngine({ autosaveIntervalMs: 0 });
  const S = TICKS_PER_SECOND; // shorthand: S = 1 second in ticks

  // 1. create + save
  const { path: projectPath } = await engine.project.create({
    name: 'Demo',
    dir,
    settings: { width: 640, height: 360, frameRate: { n: 30, d: 1 } },
  });
  log(`project created: ${projectPath}`);

  // 2. import media
  const imported = await engine.assets.import([video, tone, still]);
  if (imported.failed.length) throw new Error(`import failed: ${JSON.stringify(imported.failed)}`);
  log(`imported ${imported.imported.length} assets: ${imported.imported.map((a) => `${a.name}(${a.kind})`).join(', ')}`);

  const [vAsset, toneAsset, stillAsset] = imported.imported;
  const tracks = await engine.timeline.addTrack('video', 'Overlay');
  const { project } = (await engine.project.current())!;
  const v1 = project!.tracks.find((t) => t.kind === 'video')!;
  const a1 = project!.tracks.find((t) => t.kind === 'audio')!;

  // 3. multitrack timeline ops
  const clip1 = await engine.timeline.addClip({ trackId: v1.id, assetId: vAsset.id, start: 0 });
  const [, clip2] = await engine.timeline.splitClip(clip1.id, 2 * S);
  log('split video clip at 2s');
  await engine.timeline.moveClip(clip2.id, { start: 3 * S });
  await engine.timeline.trimClip(clip2.id, { edge: 'out', to: 4.5 * S });
  log('moved + trimmed second half (trim is non-destructive)');

  const imageClip = await engine.timeline.addClip({
    trackId: tracks.id, assetId: stillAsset.id, start: 1 * S, duration: 2 * S,
    transform: { x: 100, opacity: 0.5 },
  });
  const toneClip = await engine.timeline.addClip({
    trackId: a1.id, assetId: toneAsset.id, start: 0, duration: 3 * S,
    audio: { volume: 0.5, fadeIn: Math.round(0.2 * S) },
  });
  const { clip: textClip } = await engine.timeline.addTextClip({
    trackId: tracks.id, start: 5 * S, duration: 1.5 * S, text: 'Hello from the engine',
  });
  log(`placed image overlay, audio (${formatTimecode(toneClip.start, { n: 30, d: 1 })}..), text clip`);

  // batch gesture demo (one undo entry)
  await engine.history.beginBatch();
  await engine.timeline.updateClip(imageClip.id, { transform: { x: 120 } });
  await engine.timeline.updateClip(imageClip.id, { transform: { x: 140 } });
  await engine.history.endBatch();
  await engine.history.undo();
  log('batched transform gesture + undo (single step)');

  await engine.project.save();
  log('project saved');

  // 4. reopen + asset-reference recovery
  await engine.project.close();
  const reopened = await engine.project.open(projectPath);
  const resolutions = await engine.project.verifyAssets();
  const missing = resolutions.filter((r) => r.status === 'missing');
  log(`reopened: ${reopened.state.project!.tracks.length} tracks, ${reopened.state.project!.assets.length} assets, ` +
      `${resolutions.length - missing.length}/${resolutions.length} asset paths recovered`);
  if (missing.length) throw new Error(`asset recovery failed: ${JSON.stringify(missing)}`);

  // 5. export — first attempt honestly fails (text clips need drawtext)
  const caps = await engine.exportMedia.capabilities();
  log(`ffmpeg capabilities: textBurnIn=${caps.textBurnIn} (${caps.ffmpegVersion})`);
  const outPath = join(dir, 'demo-export.mp4');
  try {
    const { exportId } = await engine.exportMedia.start({ outputPath: outPath, container: 'mp4' });
    await waitForExport(engine, exportId);
    throw new Error('expected the text-clip export to be rejected, but it succeeded');
  } catch (e) {
    const shape = toErrorShape(e);
    if (shape.code !== 'UNSUPPORTED_FEATURE') throw e;
    log(`text-clip export correctly rejected: ${shape.code} — ${shape.message}`);
  }

  // remove text clip (documented workaround), export again → progress + success
  await engine.timeline.removeClip(textClip.id);
  const { exportId } = await engine.exportMedia.start({ outputPath: outPath, container: 'mp4' });
  await waitForExport(engine, exportId);
  log(`exported: ${outPath}`);

  const outProbe = await ffprobeJson(outPath, resolveTool('ffprobe'));
  const outStreams = (outProbe.streams ?? []).map((s) => s.codec_type);
  const outDur = Number(outProbe.format?.duration ?? 0);
  log(`output verified: ${(outStreams.join('+'))}, ${outDur.toFixed(2)}s`);
  if (!outStreams.includes('video') || !outStreams.includes('audio')) {
    throw new Error('exported file is missing streams');
  }

  await engine.project.save();
  engine.dispose();
  log('E2E demo complete ✔');
}

async function probe(fileRaw: string): Promise<void> {
  const engine = createEngine({ autosaveIntervalMs: 0 });
  const res = await engine.assets.import([resolve(fileRaw)]);
  process.stdout.write(JSON.stringify(res, null, 2) + '\n');
  engine.dispose();
}

async function main(): Promise<void> {
  const [cmd, ...rest] = process.argv.slice(2);
  if (cmd === 'demo' && rest[0]) {
    await demo(rest[0]);
  } else if (cmd === 'probe' && rest[0]) {
    await probe(rest[0]);
  } else if (cmd === 'export' && rest[0] && rest[1]) {
    const engine = createEngine({ autosaveIntervalMs: 0 });
    await engine.project.open(resolve(rest[0]));
    const { exportId } = await engine.exportMedia.start({
      outputPath: resolve(rest[1]),
      container: (rest[2] as 'mp4') ?? 'mp4',
    });
    engine.on('export:progress', (p) => {
      if (p.percent !== null) process.stdout.write(`\rexport ${p.percent.toFixed(1)}%`);
    });
    engine.on('export:error', (p) => {
      process.stderr.write(`\n${p.error.code}: ${p.error.message}\n${p.error.hint ?? ''}\n`);
      process.exit(1);
    });
    engine.on('export:done', () => {
      process.stdout.write('\ndone\n');
      engine.dispose();
    });
  } else {
    process.stderr.write('usage: ve-cli <demo <dir>|probe <file>|export <project> <out> [container]>\n');
    process.exit(2);
  }
}

main().catch((e) => {
  const shape = toErrorShape(e);
  process.stderr.write(`\nERROR ${shape.code}: ${shape.message}\n${shape.hint ?? ''}\n`);
  process.exit(1);
});

export { secFromTicks };
