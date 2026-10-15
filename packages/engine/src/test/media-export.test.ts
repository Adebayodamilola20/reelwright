import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createEngine, type EngineInstance } from '../engine.js';
import { ffprobeJson, probeMedia } from '../media/probe.js';
import { resolveTool } from '../media/tools.js';
import { TICKS_PER_SECOND } from '../time.js';
import type { EngineEvents } from '../api.js';

const S = TICKS_PER_SECOND;
const ffmpeg = resolveTool('ffmpeg');
const ffprobe = resolveTool('ffprobe');

function tmp(tag: string): string {
  return mkdtempSync(join(tmpdir(), `ve-${tag}-`));
}

function run(bin: string, args: string[]): Promise<void> {
  return new Promise((res, rej) => {
    const child = spawn(bin, args, { stdio: 'ignore' });
    child.on('error', rej);
    child.on('close', (code) => (code === 0 ? res() : rej(new Error(`${bin} exited ${code}`))));
  });
}

async function makeMedia(dir: string): Promise<{ video: string; tone: string; still: string }> {
  mkdirSync(dir, { recursive: true });
  const video = join(dir, 'v.mp4');
  const tone = join(dir, 't.wav');
  const still = join(dir, 's.png');
  await run(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', 'testsrc2=size=320x240:rate=30:duration=4',
    '-f', 'lavfi', '-i', 'sine=frequency=440:duration=4',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', video]);
  await run(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', 'sine=frequency=880:duration=3', '-ar', '48000', '-c:a', 'pcm_s16le', tone]);
  await run(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', 'testsrc2=size=320x240:rate=30:duration=1', '-frames:v', '1', still]);
  return { video, tone, still };
}

function waitForExport(engine: EngineInstance, exportId: string): Promise<EngineEvents['export:done']> {
  return new Promise((res, rej) => {
    const offs = [
      engine.on('export:done', (p) => { if (p.exportId === exportId) { off(); res(p); } }),
      engine.on('export:error', (p) => { if (p.exportId === exportId) { off(); rej(new Error(`${p.error.code}: ${p.error.message}`)); } }),
      engine.on('export:cancelled', (p) => { if (p.exportId === exportId) { off(); rej(new Error('cancelled')); } }),
    ];
    const off = () => offs.forEach((o) => o());
  });
}

test('probe classifies ffmpeg-generated video/audio/image with exact-ish durations', async () => {
  const dir = tmp('probe');
  try {
    const { video, tone, still } = await makeMedia(dir);
    const v = await probeMedia(video, ffprobe);
    assert.equal(v.kind, 'video');
    assert.ok(v.meta.video?.width === 320 && v.meta.video?.height === 240);
    assert.ok(v.meta.video?.frameRate, 'frame rate parsed');
    assert.ok(Math.abs((v.meta.durationTicks ?? 0) - 4 * S) < S / 10, '≈4s');
    assert.ok(v.meta.audio, 'audio stream captured');
    const a = await probeMedia(tone, ffprobe);
    assert.equal(a.kind, 'audio');
    assert.equal(a.meta.audio?.sampleRate, 48000);
    const i = await probeMedia(still, ffprobe);
    assert.equal(i.kind, 'image');
    assert.equal(i.meta.durationTicks, undefined);
    await run(ffprobe, ['-v', 'error', video]); // sanity: tool available for later tests
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('import dedupes by path and reports failures per-file', async () => {
  const dir = tmp('import');
  const engine = createEngine({ autosaveIntervalMs: 0, appDataDir: join(dir, 'appdata') });
  try {
    const { video } = await makeMedia(join(dir, 'media'));
    await engine.project.create({ name: 'Imp', dir });
    const first = await engine.assets.import([video, join(dir, 'nope.mp4')]);
    assert.equal(first.imported.length, 1);
    assert.equal(first.failed.length, 1);
    assert.equal(first.failed[0].error.code, 'NOT_FOUND');
    const second = await engine.assets.import([video]);
    assert.equal(second.existing.length, 1, 'already imported');
    assert.equal(second.imported.length, 0);
  } finally {
    engine.dispose();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('full export E2E: multitrack timeline → playable mp4 with progress; cancellation cleans up', async () => {
  const dir = tmp('export');
  const engine = createEngine({ autosaveIntervalMs: 0, appDataDir: join(dir, 'appdata') });
  try {
    const { video, tone, still } = await makeMedia(join(dir, 'media'));
    await engine.project.create({
      name: 'Exp', dir, settings: { width: 320, height: 240, frameRate: { n: 30, d: 1 } },
    });
    const res = await engine.assets.import([video, tone, still]);
    assert.equal(res.imported.length, 3, JSON.stringify(res.failed));
    const [vAsset, toneAsset, stillAsset] = res.imported;

    const overlay = await engine.timeline.addTrack('video', 'Overlay');
    const project = (await engine.project.current())!.project!;
    const v1 = project.tracks.find((t) => t.kind === 'video')!;
    const a1 = project.tracks.find((t) => t.kind === 'audio')!;

    // split at 2s, move tail to 3.5s → program = 5.5s with a gap (tests gap fill)
    const clip1 = await engine.timeline.addClip({ trackId: v1.id, assetId: vAsset.id, start: 0 });
    const [, clip2] = await engine.timeline.splitClip(clip1.id, 2 * S);
    await engine.timeline.moveClip(clip2.id, { start: Math.round(3.5 * S) });
    await engine.timeline.addClip({
      trackId: overlay.id, assetId: stillAsset.id, start: S, duration: S,
      transform: { x: 40, opacity: 0.6 },
    });
    await engine.timeline.addClip({
      trackId: a1.id, assetId: toneAsset.id, start: 0, duration: Math.round(1.5 * S),
      audio: { volume: 0.5, fadeIn: Math.round(0.2 * S) },
    });
    await engine.project.save();

    const outPath = join(dir, 'out.mp4');
    const progress: number[] = [];
    engine.on('export:progress', (p) => { if (p.percent !== null) progress.push(p.percent); });
    const { exportId } = await engine.exportMedia.start({ outputPath: outPath, container: 'mp4' });
    await waitForExport(engine, exportId);

    assert.ok(existsSync(outPath), 'output exists');
    assert.ok(progress.length > 0, 'progress events emitted');
    assert.deepEqual([...progress].sort((a, b) => a - b), progress, 'progress is monotonic');
    assert.equal(progress[progress.length - 1], 100, 'final progress hits 100');
    // hidden temp files are gone (only the final file remains)
    const leftovers = readdirSync(dir).filter((f) => f.includes('.part-'));
    assert.equal(leftovers.length, 0, 'no temp output leftovers');

    const probe = await ffprobeJson(outPath, ffprobe);
    const types = (probe.streams ?? []).map((s) => s.codec_type);
    assert.ok(types.includes('video') && types.includes('audio'), `streams: ${types.join('+')}`);
    const dur = Number(probe.format?.duration ?? 0);
    assert.ok(Math.abs(dur - 5.5) < 0.35, `duration ≈ 5.5s (got ${dur})`);
  } finally {
    engine.dispose();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('cancellation terminates ffmpeg, removes temp output, emits export:cancelled', async () => {
  const dir = tmp('cancel');
  const engine = createEngine({ autosaveIntervalMs: 0, appDataDir: join(dir, 'appdata') });
  try {
    // longer media so the export runs long enough to cancel
    const mediaDir = join(dir, 'media');
    mkdirSync(mediaDir, { recursive: true });
    const long = join(mediaDir, 'long.mp4');
    await run(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y',
      '-f', 'lavfi', '-i', 'testsrc2=size=640x480:rate=30:duration=25',
      '-f', 'lavfi', '-i', 'sine=frequency=440:duration=25',
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', long]);
    await engine.project.create({
      name: 'Cancel', dir, settings: { width: 640, height: 480, frameRate: { n: 30, d: 1 } },
    });
    const res = await engine.assets.import([long]);
    const project = (await engine.project.current())!.project!;
    const v1 = project.tracks.find((t) => t.kind === 'video')!;
    await engine.timeline.addClip({ trackId: v1.id, assetId: res.imported[0].id, start: 0 });

    const outPath = join(dir, 'cancelled.mp4');
    const cancelled = new Promise<void>((res2) => {
      engine.on('export:cancelled', () => res2());
    });
    const { exportId } = await engine.exportMedia.start({ outputPath: outPath, container: 'mp4' });
    await new Promise((r) => setTimeout(r, 700)); // let it get going
    assert.equal(await engine.exportMedia.cancel(exportId), true);
    await cancelled;
    assert.equal(existsSync(outPath), false, 'no final output after cancel');
    const leftovers = readdirSync(dir).filter((f) => f.includes('.part-'));
    assert.equal(leftovers.length, 0, 'temp output cleaned up');
    assert.equal(await engine.exportMedia.cancel(exportId), false, 'second cancel is a no-op');
  } finally {
    engine.dispose();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('text clip export is honestly rejected (capability gate)', async () => {
  const dir = tmp('textgate');
  const engine = createEngine({ autosaveIntervalMs: 0, appDataDir: join(dir, 'appdata') });
  try {
    const { video } = await makeMedia(join(dir, 'media'));
    await engine.project.create({ name: 'Txt', dir });
    const res = await engine.assets.import([video]);
    const project = (await engine.project.current())!.project!;
    const v1 = project.tracks.find((t) => t.kind === 'video')!;
    const overlay = await engine.timeline.addTrack('video', 'Overlay');
    await engine.timeline.addClip({ trackId: v1.id, assetId: res.imported[0].id, start: 0 });
    await engine.timeline.addTextClip({ trackId: overlay.id, start: 0, duration: S, text: 'hi' });
    // Preflight lists the blocker BEFORE any run (contract review note 6)
    const pre = await engine.exportMedia.preflight({ container: 'mp4' });
    assert.equal(pre.blockers.length, 1, JSON.stringify(pre.blockers));
    assert.equal(pre.blockers[0].code, 'UNSUPPORTED_FEATURE');
    assert.ok(pre.blockers[0].hint, 'blocker carries an actionable hint');
    // If the local ffmpeg ever gains drawtext, the gate changes message but stays an error.
    await assert.rejects(
      engine.exportMedia.start({ outputPath: join(dir, 't.mp4'), container: 'mp4' }),
      (e: { code?: string }) => e.code === 'UNSUPPORTED_FEATURE',
    );
    assert.equal(existsSync(join(dir, 't.mp4')), false);
  } finally {
    engine.dispose();
    rmSync(dir, { recursive: true, force: true });
  }
});
