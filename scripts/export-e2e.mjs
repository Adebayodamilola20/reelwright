#!/usr/bin/env node
/**
 * export-e2e.mjs — Phase-1 export acceptance evidence
 * (docs/PHASE_PLAN.md checkbox: "Export produces a playable file via ffmpeg
 * with real progress %, working cancel, and readable errors on failure").
 *
 * Drives the REAL engine from built dist/ — packages/engine/src is read-only
 * for this lane. Uses only test-media/ fixtures. No dependencies.
 *
 * Scenarios:
 *   S1 success path  — build project → export mp4 → progress monotonic → 100% →
 *                      done → ffprobe-verified playable output
 *   S2 cancel        — long export → cancel mid-flight → process gone, honest
 *                      cancelled status, no output, no temp leftovers
 *   S3 missing input — asset file deleted after import → ASSET_MISSING with
 *                      code + hint, no stack leak, missing detected via
 *                      verifyAssets()
 *   S4 unwritable dir— output dir not writable → readable error (code+hint,
 *                      no raw stack), nothing created
 *   S5 text gate     — text clip export with drawtext-less ffmpeg → honest
 *                      UNSUPPORTED_FEATURE + hint (never silently dropped)
 *
 * Usage:  npm run verify:export          (or: node scripts/export-e2e.mjs)
 * Requires: npm run build -w @ve/engine   and ffmpeg/ffprobe on PATH.
 * Exit 0 = all checks pass. Evidence JSON: demo-output/export-e2e-evidence.json
 */

import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url)) + '/..';
const DIST = join(ROOT, 'packages/engine/dist/index.js');
const FIXTURES = join(ROOT, 'test-media');
const DEMO_OUT = join(ROOT, 'demo-output');

if (!existsSync(DIST)) {
  console.error('engine dist/ missing — run: npm run build -w @ve/engine');
  process.exit(2);
}

const { createEngine, TICKS_PER_SECOND, toErrorShape } = await import(DIST);

const SEC = TICKS_PER_SECOND;
const evidence = [];
let passCount = 0;
let failCount = 0;

function record(scenario, name, pass, detail = '') {
  if (pass) passCount++;
  else failCount++;
  const tag = pass ? 'PASS' : 'FAIL';
  const line = `  ${tag} ${name}${detail ? ` — ${detail}` : ''}`;
  console.log(line);
  evidence.push({ scenario, name, pass, detail });
  return pass;
}
function info(scenario, name, detail = '') {
  console.log(`  INFO ${name}${detail ? ` — ${detail}` : ''}`);
  evidence.push({ scenario, name, pass: null, detail });
}

// --------------------------------------------------------------- utilities

function ffprobe(file) {
  const res = spawnSync('ffprobe', [
    '-v', 'error', '-print_format', 'json',
    '-show_format', '-show_streams', file,
  ], { encoding: 'utf8' });
  if (res.status !== 0) return { error: res.stderr || 'ffprobe failed' };
  try {
    return JSON.parse(res.stdout);
  } catch (e) {
    return { error: `unparsable ffprobe output: ${e.message}` };
  }
}

function countFrames(file) {
  const res = spawnSync('ffprobe', [
    '-v', 'error', '-select_streams', 'v:0',
    '-count_frames', '-show_entries', 'stream=nb_read_frames', file,
  ], { encoding: 'utf8' });
  const m = /nb_read_frames=(\d+)/.exec(res.stdout || '');
  return m ? Number(m[1]) : null;
}

function partLeftovers(dir) {
  try {
    return readdirSync(dir).filter((f) => f.includes('.part-'));
  } catch {
    return [];
  }
}

/** Live ffmpeg processes referencing our unique tmp path (evidence of kill). */
function liveFfmpegFor(marker) {
  const ps = spawnSync('ps', ['-ax', '-o', 'pid=,command='], { encoding: 'utf8' });
  return (ps.stdout || '')
    .split('\n')
    .filter((l) => l.includes('ffmpeg') && l.includes(marker))
    .map((l) => l.trim());
}

function capture(engine) {
  const c = {
    progress: [],
    done: null,
    error: null,
    cancelled: null,
    terminal: null,
    unsub: [],
  };
  c.unsub.push(engine.on('export:progress', (p) => c.progress.push(p)));
  c.unsub.push(engine.on('export:done', (p) => {
    if (!c.terminal) { c.done = p; c.terminal = 'done'; }
  }));
  c.unsub.push(engine.on('export:error', (p) => {
    if (!c.terminal) { c.error = p; c.terminal = 'error'; }
  }));
  c.unsub.push(engine.on('export:cancelled', (p) => {
    if (!c.terminal) { c.cancelled = p; c.terminal = 'cancelled'; }
  }));
  c.dispose = () => c.unsub.forEach((u) => u());
  return c;
}

async function awaitTerminal(c, ms) {
  const t0 = Date.now();
  while (!c.terminal && Date.now() - t0 < ms) {
    await new Promise((r) => setTimeout(r, 25));
  }
  return c.terminal;
}

async function awaitCond(fn, ms) {
  const t0 = Date.now();
  while (!fn() && Date.now() - t0 < ms) {
    await new Promise((r) => setTimeout(r, 25));
  }
  return fn();
}

function percents(c) {
  return c.progress.map((p) => p.percent).filter((p) => typeof p === 'number');
}

function newEngine(tmp) {
  return createEngine({
    appDataDir: join(tmp, 'appdata'),
    autosaveIntervalMs: 0, // keep scenario dirs clean; explicit saves only
  });
}

async function makeProject(engine, tmp, name, settings) {
  const dir = join(tmp, name);
  mkdirSync(dir, { recursive: true });
  const { state } = await engine.project.create({ name, dir, settings });
  const project = state.project;
  const videoTrack = project.tracks.find((t) => t.kind === 'video');
  const audioTrack = project.tracks.find((t) => t.kind === 'audio');
  if (!videoTrack || !audioTrack) throw new Error('seeded tracks missing');
  return { dir, project, videoTrack, audioTrack };
}

function hasNoStack(s) {
  return typeof s === 'string' && !/\n\s+at\s/.test(s) && !s.includes('node:internal');
}

// ============================================================ S1: success
async function s1() {
  const SC = 'S1 success path';
  console.log(`\n=== ${SC} ===`);
  const tmp = mkdtempSync(join(tmpdir(), 've-e2e-s1-'));
  const engine = newEngine(tmp);
  try {
    const { dir, project, videoTrack, audioTrack } = await makeProject(engine, tmp, 'e2e-success', {
      width: 320, height: 240, frameRate: { n: 30, d: 1 },
      sampleRate: 48000, channels: 2, background: '#000000',
    });
    const imp = await engine.assets.import([
      join(FIXTURES, 'bars-tone.mp4'),
      join(FIXTURES, 'tone-48k.wav'),
      join(FIXTURES, 'still.png'),
    ]);
    record(SC, 'import 3 fixtures (ffprobe ingest)', imp.imported.length === 3 && imp.failed.length === 0,
      `imported=${imp.imported.length} failed=${imp.failed.length}`);
    const byName = Object.fromEntries(imp.imported.map((a) => [a.name, a]));
    const bars = byName['bars-tone.mp4'];
    const wav = byName['tone-48k.wav'];
    const png = byName['still.png'];
    record(SC, 'asset metadata probed (duration/fps/size)',
      !!bars?.meta.durationTicks && !!bars.meta.video && !!wav?.meta.audio && !!png && png.kind === 'image',
      `bars durationTicks=${bars?.meta.durationTicks} video=${JSON.stringify(bars?.meta.video)} wav.audio=${JSON.stringify(wav?.meta.audio)}`);

    // Timeline: bars 0–2s, bars again 2–4s, still image 4–5s, tone 0–1s.
    await engine.timeline.addClip({ trackId: videoTrack.id, assetId: bars.id, start: 0 });
    await engine.timeline.addClip({ trackId: videoTrack.id, assetId: bars.id, start: 2 * SEC });
    await engine.timeline.addClip({ trackId: videoTrack.id, assetId: png.id, start: 4 * SEC, duration: 1 * SEC });
    await engine.timeline.addClip({ trackId: audioTrack.id, assetId: wav.id, start: 0 });

    const out = join(dir, 'out.mp4');
    const caps = await engine.exportMedia.capabilities();
    info(SC, 'ffmpeg capabilities', `${caps.ffmpegVersion}; textBurnIn=${caps.textBurnIn}`);

    const c = capture(engine);
    const { exportId } = await engine.exportMedia.start({
      outputPath: out, container: 'mp4',
      video: { codec: 'h264', quality: 'high' },
      audio: { codec: 'aac' },
    });
    const terminal = await awaitTerminal(c, 120_000);
    c.dispose();

    record(SC, 'terminal event is export:done', terminal === 'done',
      `terminal=${terminal}${c.error ? ` error=${JSON.stringify(c.error.error)}` : ''}`);
    const per = percents(c);
    record(SC, 'progress events observed', per.length >= 1, `${per.length} percent events`);
    const mono = per.every((v, i) => i === 0 || v >= per[i - 1]);
    record(SC, 'progress monotonic non-decreasing', mono,
      per.length ? `${per[0]} → ${per[per.length - 1]} (${per.length} samples)` : 'no samples');
    record(SC, 'progress reaches 100%', per.includes(100),
      per.length ? `max=${Math.max(...per)}` : '');
    record(SC, 'progress bound to this exportId',
      c.progress.every((p) => p.exportId === exportId), exportId);
    record(SC, 'done reports requested outputPath',
      c.done?.outputPath === out, c.done?.outputPath ?? 'none');

    const parts = partLeftovers(dir);
    record(SC, 'no .part- temp leftovers', parts.length === 0, parts.join(',') || 'clean');

    if (!existsSync(out)) {
      record(SC, 'output file exists', false, 'missing');
      return;
    }
    const sizeKb = Math.round(statSync(out).size / 1024);
    record(SC, 'output file non-trivial', sizeKb > 10, `${sizeKb} KB`);

    const probe = ffprobe(out);
    record(SC, 'ffprobe: valid mp4 container', !probe.error && String(probe.format?.format_name || '').includes('mp4'),
      probe.error ?? probe.format?.format_name);
    const dur = Number(probe.format?.duration ?? -1);
    record(SC, 'ffprobe: duration ≈ 5.000 s (±0.25)', dur >= 4.75 && dur <= 5.25, `${dur.toFixed(3)} s`);
    const v = (probe.streams || []).find((s) => s.codec_type === 'video');
    const a = (probe.streams || []).find((s) => s.codec_type === 'audio');
    record(SC, 'ffprobe: video stream h264 320x240 @30/1',
      v?.codec_name === 'h264' && v.width === 320 && v.height === 240 && v.r_frame_rate === '30/1',
      `${v?.codec_name} ${v?.width}x${v?.height} ${v?.r_frame_rate}`);
    record(SC, 'ffprobe: audio stream aac 48000 Hz',
      a?.codec_name === 'aac' && String(a.sample_rate) === '48000',
      `${a?.codec_name} ${a?.sample_rate} Hz ch=${a?.channels}`);
    const frames = countFrames(out);
    record(SC, 'ffprobe: frame count 150 (5 s × 30 fps, ±1)',
      frames !== null && frames >= 149 && frames <= 151, `frames=${frames}`);
  } catch (e) {
    record(SC, 'scenario ran without exception', false, String(e?.stack || e));
  } finally {
    engine.dispose();
  }
}

// ============================================================ S2: cancel
async function cancelAttempt(tmp, clipCount, attempt) {
  const engine = newEngine(tmp);
  try {
    const { videoTrack } = await makeProject(engine, tmp, `e2e-cancel-${attempt}`, {
      width: 1920, height: 1080, frameRate: { n: 30, d: 1 },
      sampleRate: 48000, channels: 2, background: '#000000',
    });
    const imp = await engine.assets.import([join(FIXTURES, 'bars-tone.mp4')]);
    const bars = imp.imported[0];
    for (let i = 0; i < clipCount; i++) {
      await engine.timeline.addClip({
        trackId: videoTrack.id, assetId: bars.id, start: i * 2 * SEC,
      });
    }
    const out = join(tmp, `out-cancel-${attempt}.mp4`);
    const c = capture(engine);
    const { exportId } = await engine.exportMedia.start({
      outputPath: out, container: 'mp4',
      video: { codec: 'h264', quality: 'draft' },
      audio: { codec: 'aac' },
    });
    // Cancel at the FIRST mid-flight progress report.
    const midReached = await awaitCond(() =>
      c.progress.some((p) => typeof p.percent === 'number' && p.percent > 0 && p.percent < 99), 45_000);
    let cancelOk = false;
    if (midReached) cancelOk = await engine.exportMedia.cancel(exportId);
    const terminal = await awaitTerminal(c, 10_000);
    c.dispose();
    const marker = tmp;
    await new Promise((r) => setTimeout(r, 600)); // let close/kill settle
    const survivors = liveFfmpegFor(marker);
    return { engine, out, c, midReached, cancelOk, terminal, survivors, exportId };
  } catch (e) {
    engine.dispose();
    throw e;
  }
}

async function s2() {
  const SC = 'S2 cancel mid-export';
  console.log(`\n=== ${SC} ===`);
  const tmp = mkdtempSync(join(tmpdir(), 've-e2e-s2-'));
  let run;
  let engine = null;
  try {
    run = await cancelAttempt(tmp, 20, 1);
    engine = run.engine;
    if (run.terminal === 'done') {
      // Export beat the cancel — retry once with a program long enough to
      // reliably catch mid-flight.
      info(SC, 'first attempt finished before cancel — retrying with 40 clips');
      engine.dispose();
      run = await cancelAttempt(tmp, 40, 2);
      engine = run.engine;
    }
    const { out, c, midReached, cancelOk, terminal, survivors, exportId } = run;
    record(SC, 'export was mid-flight when cancelled', midReached,
      midReached ? `percent samples=${percents(c).length}` : 'never saw 0<pct<99');
    record(SC, 'cancel(exportId) returned true', cancelOk === true, String(cancelOk));
    record(SC, 'terminal event is export:cancelled (not done)',
      terminal === 'cancelled', `terminal=${terminal}`);
    record(SC, 'cancelled exportId matches', c.cancelled?.exportId === exportId,
      c.cancelled?.exportId ?? 'none');
    record(SC, 'no final output presented as success', !existsSync(out),
      existsSync(out) ? 'OUTPUT EXISTS' : 'absent as expected');
    const dir = dirname(out);
    const parts = partLeftovers(dir);
    record(SC, 'no .part- temp leftovers after cancel', parts.length === 0, parts.join(',') || 'clean');
    record(SC, 'no live ffmpeg process for this run', survivors.length === 0,
      survivors.length ? survivors.join(' | ') : 'none found');
  } catch (e) {
    record(SC, 'scenario ran without exception', false, String(e?.stack || e));
  } finally {
    if (engine) engine.dispose();
  }
}

// ============================================================ S3: missing input
async function s3() {
  const SC = 'S3 missing input file';
  console.log(`\n=== ${SC} ===`);
  const tmp = mkdtempSync(join(tmpdir(), 've-e2e-s3-'));
  const engine = newEngine(tmp);
  try {
    const { dir, videoTrack } = await makeProject(engine, tmp, 'e2e-missing', {
      width: 320, height: 240, frameRate: { n: 30, d: 1 },
      sampleRate: 48000, channels: 2, background: '#000000',
    });
    const src = join(dir, 'source.mp4');
    copyFileSync(join(FIXTURES, 'bars-tone.mp4'), src);
    const imp = await engine.assets.import([src]);
    const bars = imp.imported[0];
    await engine.timeline.addClip({ trackId: videoTrack.id, assetId: bars.id, start: 0 });
    rmSync(src); // file disappears — the classic moved/deleted media case

    const res = await engine.project.verifyAssets();
    const missing = res.find((r) => r.assetId === bars.id);
    record(SC, 'verifyAssets detects missing file', missing?.status === 'missing',
      JSON.stringify(missing));

    let caught = null;
    try {
      await engine.exportMedia.start({
        outputPath: join(dir, 'out.mp4'), container: 'mp4',
        video: { codec: 'h264', quality: 'draft' }, audio: { codec: 'aac' },
      });
    } catch (e) {
      caught = e;
    }
    record(SC, 'export rejected (throws, not silent)', caught !== null,
      caught ? `code=${caught.code}` : 'export started instead!');
    if (caught) {
      const shape = toErrorShape(caught);
      record(SC, 'EngineErrorShape code = ASSET_MISSING', shape.code === 'ASSET_MISSING', shape.code);
      record(SC, 'readable message', hasNoStack(shape.message) && shape.message.length > 15,
        JSON.stringify(shape.message.slice(0, 120)));
      record(SC, 'actionable hint present (relink guidance)',
        typeof shape.hint === 'string' && shape.hint.length > 10, JSON.stringify(shape.hint ?? ''));
      record(SC, 'no raw stack in wire shape',
        hasNoStack(shape.message) && (shape.hint === undefined || hasNoStack(shape.hint)));
    }
    record(SC, 'no output file created', !existsSync(join(dir, 'out.mp4')),
      'absent as expected');
  } catch (e) {
    record(SC, 'scenario ran without exception', false, String(e?.stack || e));
  } finally {
    engine.dispose();
  }
}

// ============================================================ S4: unwritable output dir
async function s4() {
  const SC = 'S4 unwritable output dir';
  console.log(`\n=== ${SC} ===`);
  const tmp = mkdtempSync(join(tmpdir(), 've-e2e-s4-'));
  const engine = newEngine(tmp);
  const locked = join(tmp, 'locked');
  try {
    const { dir, videoTrack } = await makeProject(engine, tmp, 'e2e-unwritable', {
      width: 320, height: 240, frameRate: { n: 30, d: 1 },
      sampleRate: 48000, channels: 2, background: '#000000',
    });
    const imp = await engine.assets.import([join(FIXTURES, 'bars-tone.mp4')]);
    await engine.timeline.addClip({ trackId: videoTrack.id, assetId: imp.imported[0].id, start: 0 });

    mkdirSync(locked, { recursive: true });
    chmodSync(locked, 0o555); // unwritable for this user
    const out = join(locked, 'out.mp4');

    const c = capture(engine);
    let thrown = null;
    try {
      const { exportId } = await engine.exportMedia.start({
        outputPath: out, container: 'mp4',
        video: { codec: 'h264', quality: 'draft' }, audio: { codec: 'aac' },
      });
      info(SC, 'start accepted, awaiting ffmpeg-side failure', exportId);
      await awaitTerminal(c, 30_000);
    } catch (e) {
      thrown = e;
    }
    c.dispose();

    const shape = thrown ? toErrorShape(thrown) : (c.error ? c.error.error : null);
    record(SC, 'failed with a structured error (event or throw)',
      shape !== null,
      shape ? `code=${shape.code}` : `terminal=${c.terminal}`);
    if (shape) {
      const known = ['FFMPEG_NOT_FOUND', 'FFMPEG_FAILED', 'ASSET_MISSING', 'UNSUPPORTED_FEATURE',
        'INVALID_ARGUMENT', 'OVERLAP', 'IO_ERROR', 'NOT_FOUND', 'BUSY', 'NOT_CONFIGURED', 'INTERNAL'];
      record(SC, 'error code is a known EngineErrorCode', known.includes(shape.code), shape.code);
      record(SC, 'readable message (no raw stack)',
        hasNoStack(shape.message) && shape.message.length > 10, JSON.stringify(shape.message.slice(0, 120)));
      record(SC, 'hint present',
        typeof shape.hint === 'string' && shape.hint.length > 3, JSON.stringify((shape.hint ?? '').slice(0, 160)));
      if (shape.code === 'ASSET_MISSING') {
        info(SC, 'WATCH: output-path open failure surfaced as ASSET_MISSING '
          + '(ffmpeg stderr "No such file" mapped to missing media) — readable, but IO_ERROR would be more precise');
      }
    }
    record(SC, 'no output or temp files anywhere', !existsSync(out) && partLeftovers(locked).length === 0,
      'locked dir empty');
    record(SC, 'output directory was NOT auto-created (no silent fix-up)', readdirSync(locked).length === 0,
      'no mkdir by engine');
  } catch (e) {
    record(SC, 'scenario ran without exception', false, String(e?.stack || e));
  } finally {
    try { chmodSync(locked, 0o755); } catch { /* may not exist */ }
    engine.dispose();
  }
}

// ============================================================ S5: text honesty gate
async function s5() {
  const SC = 'S5 text burn-in honesty gate';
  console.log(`\n=== ${SC} ===`);
  const tmp = mkdtempSync(join(tmpdir(), 've-e2e-s5-'));
  const engine = newEngine(tmp);
  try {
    const { dir, videoTrack } = await makeProject(engine, tmp, 'e2e-text', {
      width: 320, height: 240, frameRate: { n: 30, d: 1 },
      sampleRate: 48000, channels: 2, background: '#000000',
    });
    const imp = await engine.assets.import([join(FIXTURES, 'bars-tone.mp4')]);
    await engine.timeline.addClip({ trackId: videoTrack.id, assetId: imp.imported[0].id, start: 0 });
    // Adjacent to the bars clip (0–2 s) so overlap policy doesn't fire first —
    // we want the TEXT capability gate to be the rejection under test.
    await engine.timeline.addTextClip({
      trackId: videoTrack.id, start: 2 * SEC, duration: 1 * SEC, text: 'Caption',
    });

    const caps = await engine.exportMedia.capabilities();
    let caught = null;
    try {
      await engine.exportMedia.start({
        outputPath: join(dir, 'out.mp4'), container: 'mp4',
        video: { codec: 'h264', quality: 'draft' }, audio: { codec: 'aac' },
      });
    } catch (e) {
      caught = e;
    }
    if (caps.textBurnIn) {
      info(SC, 'local ffmpeg HAS drawtext — gate not exercised here',
        'export would proceed; scenario inconclusive by environment');
      return;
    }
    record(SC, 'capabilities.textBurnIn is false (honest probe)', caps.textBurnIn === false,
      caps.ffmpegVersion);
    record(SC, 'text export rejected with UNSUPPORTED_FEATURE',
      caught?.code === 'UNSUPPORTED_FEATURE', caught ? caught.code : 'export started!');
    if (caught) {
      record(SC, 'rejection hint explains the real reason',
        hasNoStack(caught.message) && typeof caught.hint === 'string' && /freetype|drawtext|remove text/i.test(caught.hint),
        JSON.stringify((caught.hint ?? '').slice(0, 160)));
    }
    record(SC, 'no output file created by rejected export',
      !existsSync(join(dir, 'out.mp4')), 'absent as expected');
  } catch (e) {
    record(SC, 'scenario ran without exception', false, String(e?.stack || e));
  } finally {
    engine.dispose();
  }
}

// ================================================================== main
console.log('export-e2e — Phase-1 export acceptance evidence');
console.log(`root: ${ROOT}`);

await s1();
await s2();
await s3();
await s4();
await s5();

console.log(`\n=== SUMMARY: ${passCount} passed, ${failCount} failed ===`);
try {
  mkdirSync(DEMO_OUT, { recursive: true });
  writeFileSync(join(DEMO_OUT, 'export-e2e-evidence.json'),
    JSON.stringify({ at: new Date().toISOString(), passCount, failCount, evidence }, null, 2));
  console.log(`evidence: demo-output/export-e2e-evidence.json`);
} catch (e) {
  console.log(`(could not write evidence file: ${e.message})`);
}
process.exit(failCount > 0 ? 1 : 0);
