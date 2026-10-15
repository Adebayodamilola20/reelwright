import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {
  audioCapabilities,
  probeDurationSec,
  runFfmpeg,
  runVersion,
  AudioError,
} from '../index.js';
import { cleanupTempDir, genToneWav, makeTempDir } from './fixtures.js';

test('audioCapabilities: version + core audio filters/encoders present (Observed)', async () => {
  const caps = await audioCapabilities();
  assert.ok(caps.ffmpegVersion.startsWith('ffmpeg'), `version string: ${caps.ffmpegVersion}`);
  // Contract + environment baseline claim these exist; assert for real.
  for (const f of ['volume', 'afade', 'atrim', 'amix'] as const) {
    assert.equal(caps.filters[f], true, `filter ${f} available`);
  }
  for (const e of ['aac', 'libmp3lame', 'pcm_s16le'] as const) {
    assert.equal(caps.encoders[e], true, `encoder ${e} available`);
  }
});

test('runVersion / runFfmpeg: missing binary → FFMPEG_NOT_FOUND', async () => {
  await assert.rejects(
    () => runVersion('/definitely/not/ffmpeg'),
    (err: unknown) => err instanceof AudioError && err.code === 'FFMPEG_NOT_FOUND',
  );
  await assert.rejects(
    () => runFfmpeg(['-version'], { bin: '/definitely/not/ffmpeg' }),
    (err: unknown) => err instanceof AudioError && err.code === 'FFMPEG_NOT_FOUND',
  );
});

test('runFfmpeg: non-zero exit resolves with code + stderr (no throw)', async () => {
  const { code, stderr } = await runFfmpeg(['-i', '/definitely/not/media.wav', '-f', 'null', '-']);
  assert.notEqual(code, 0);
  assert.ok(stderr.length > 0);
});

test('probeDurationSec: tone wav duration within tolerance', async () => {
  const dir = await makeTempDir();
  try {
    const wav = await genToneWav(path.join(dir, 'tone.wav'), { durationSec: 1.5, sampleRate: 48000 });
    const sec = await probeDurationSec(wav);
    assert.ok(Math.abs(sec - 1.5) < 0.05, `duration ≈ 1.5 s, got ${sec}`);
  } finally {
    await cleanupTempDir(dir);
  }
});

test('probeDurationSec: unreadable file → FFMPEG_FAILED', async () => {
  await assert.rejects(
    () => probeDurationSec('/definitely/not/media.wav'),
    (err: unknown) => err instanceof AudioError && err.code === 'FFMPEG_FAILED',
  );
});
