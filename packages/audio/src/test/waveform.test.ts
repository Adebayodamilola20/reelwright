import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import {
  computeWaveform,
  waveformCached,
  readWaveformSidecar,
  waveformSidecarName,
  AudioError,
} from '../index.js';
import { cleanupTempDir, genBarsToneMp4, genSilenceWav, genToneWav, genVideoOnlyMp4, makeTempDir } from './fixtures.js';

test('computeWaveform: sine tone produces full-length min/max pairs with real amplitude', async () => {
  const dir = await makeTempDir();
  try {
    const wav = await genToneWav(path.join(dir, 'tone.wav'), { durationSec: 2, sampleRate: 48000 });
    const peaks = await computeWaveform(wav, { buckets: 100 });
    assert.equal(peaks.buckets, 100);
    assert.equal(peaks.min.length, 100);
    assert.equal(peaks.max.length, 100);
    assert.ok(Math.abs(peaks.durationSec - 2) < 0.05, `durationSec ≈ 2, got ${peaks.durationSec}`);
    // A loud sine must show real amplitude in nearly every bucket.
    const loud = peaks.max.filter((v) => v > 1000).length;
    assert.ok(loud >= 95, `expected ≥95 loud buckets, got ${loud}`);
    for (let i = 0; i < 100; i++) {
      assert.ok(peaks.min[i] <= peaks.max[i], `bucket ${i}: min ≤ max`);
      assert.ok(peaks.min[i] <= 0, `bucket ${i}: sine crosses zero so min ≤ 0`);
      assert.ok(peaks.max[i] >= 0, `bucket ${i}: sine crosses zero so max ≥ 0`);
    }
  } finally {
    await cleanupTempDir(dir);
  }
});

test('computeWaveform: digital silence yields all-zero buckets', async () => {
  const dir = await makeTempDir();
  try {
    const wav = await genSilenceWav(path.join(dir, 'silence.wav'), { durationSec: 1 });
    const peaks = await computeWaveform(wav, { buckets: 20 });
    assert.deepEqual(peaks.min, new Array(20).fill(0));
    assert.deepEqual(peaks.max, new Array(20).fill(0));
  } finally {
    await cleanupTempDir(dir);
  }
});

test('computeWaveform: works on an audio-bearing mp4 (video asset with audio)', async () => {
  const dir = await makeTempDir();
  try {
    const mp4 = await genBarsToneMp4(path.join(dir, 'bars.mp4'), { durationSec: 1 });
    const peaks = await computeWaveform(mp4, { buckets: 25 });
    assert.equal(peaks.min.length, 25);
    assert.ok(peaks.max.some((v) => v > 1000), 'audio track decoded from mp4');
  } finally {
    await cleanupTempDir(dir);
  }
});

test('computeWaveform: video-only asset fails honestly (FFMPEG_FAILED + hint)', async () => {
  const dir = await makeTempDir();
  try {
    const mp4 = await genVideoOnlyMp4(path.join(dir, 'silent.mp4'));
    await assert.rejects(
      () => computeWaveform(mp4, { buckets: 10 }),
      (err: unknown) => {
        assert.ok(err instanceof AudioError);
        assert.equal(err.code, 'FFMPEG_FAILED');
        assert.ok(err.hint?.includes('no audio stream'), `hint mentions no audio stream: ${err.hint}`);
        return true;
      },
    );
  } finally {
    await cleanupTempDir(dir);
  }
});

test('computeWaveform: rejects invalid buckets', async () => {
  const dir = await makeTempDir();
  try {
    const wav = await genToneWav(path.join(dir, 'tone.wav'), { durationSec: 0.2 });
    await assert.rejects(
      () => computeWaveform(wav, { buckets: 0 }),
      (err: unknown) => err instanceof AudioError && err.code === 'INVALID_ARGUMENT',
    );
    await assert.rejects(
      () => computeWaveform(wav, { buckets: 1.5 }),
      (err: unknown) => err instanceof AudioError && err.code === 'INVALID_ARGUMENT',
    );
  } finally {
    await cleanupTempDir(dir);
  }
});

test('waveformCached: miss → hit → invalidated by bucket change → invalidated by source change', async () => {
  const dir = await makeTempDir();
  try {
    const wav = await genToneWav(path.join(dir, 'tone.wav'), { durationSec: 1 });
    const cacheDir = path.join(dir, 'cache');

    const first = await waveformCached(wav, cacheDir, { buckets: 40 });
    assert.equal(first.cacheHit, false);
    assert.equal(first.peaks.buckets, 40);

    const second = await waveformCached(wav, cacheDir, { buckets: 40 });
    assert.equal(second.cacheHit, true);
    assert.deepEqual(second.peaks, first.peaks);

    const differentBuckets = await waveformCached(wav, cacheDir, { buckets: 80 });
    assert.equal(differentBuckets.cacheHit, false);
    assert.equal(differentBuckets.peaks.buckets, 80);

    // Rewrite the source with different content → fingerprint (size/mtime) changes.
    const { utimes, writeFile } = await import('node:fs/promises');
    await writeFile(wav, await readFile(wav)); // same bytes… now touch mtime forward
    const future = new Date(Date.now() + 5000);
    await utimes(wav, future, future);
    const afterTouch = await waveformCached(wav, cacheDir, { buckets: 40 });
    assert.equal(afterTouch.cacheHit, false);
  } finally {
    await cleanupTempDir(dir);
  }
});

test('sidecar: readable JSON with version/kind/fingerprint; corrupt file → null', async () => {
  const dir = await makeTempDir();
  try {
    const wav = await genToneWav(path.join(dir, 'tone.wav'), { durationSec: 0.5 });
    const cacheDir = path.join(dir, 'cache');
    const { sidecarPath } = await waveformCached(wav, cacheDir, { buckets: 30 });

    const sidecar = await readWaveformSidecar(sidecarPath);
    assert.ok(sidecar);
    assert.equal(sidecar.version, 1);
    assert.equal(sidecar.kind, 'waveform-peaks');
    assert.equal(sidecar.peaks.buckets, 30);
    assert.ok(sidecar.source.sizeBytes > 0);
    assert.ok(sidecar.source.modifiedMs > 0);

    const { writeFile } = await import('node:fs/promises');
    await writeFile(sidecarPath, '{ not json', 'utf8');
    assert.equal(await readWaveformSidecar(sidecarPath), null);
    assert.equal(await readWaveformSidecar(path.join(dir, 'missing.json')), null);
  } finally {
    await cleanupTempDir(dir);
  }
});

test('waveformSidecarName: deterministic per path+buckets, differs across buckets', () => {
  const a = waveformSidecarName('/media/clip.wav', { buckets: 100 });
  const b = waveformSidecarName('/media/clip.wav', { buckets: 100 });
  const c = waveformSidecarName('/media/clip.wav', { buckets: 200 });
  assert.equal(a, b);
  assert.notEqual(a, c);
  assert.match(a, /^waveform-[0-9a-f]{16}-100b-8000hz\.json$/);
});
