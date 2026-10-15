import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {
  planNoiseCleanup,
  listNoiseProfiles,
  runNoiseCleanup,
  probeFilters,
  probeDurationSec,
  parseWav,
  AudioError,
} from '../index.js';
import { readFile } from 'node:fs/promises';
import { cleanupTempDir, genNoisyToneWav, makeTempDir } from './fixtures.js';

test('planNoiseCleanup: known profiles resolve against the real filter set', async () => {
  const available = await probeFilters();
  for (const profile of ['light', 'hum-removal', 'standard', 'strong'] as const) {
    const plan = planNoiseCleanup(profile, available);
    // The local build was observed to have every needed filter (2026-10-15),
    // but the assertions stay honest: whatever the probe says, the plan agrees.
    if (plan.ok) {
      assert.ok(plan.filters.length > 0);
      assert.equal(plan.notes.length, plan.filters.length);
    } else {
      assert.equal(plan.code, 'UNSUPPORTED_FEATURE');
      assert.ok(plan.missing.length > 0);
      assert.ok(plan.reason.length > 0);
    }
  }
});

test('planNoiseCleanup: missing filters produce UNSUPPORTED_FEATURE with names', () => {
  const plan = planNoiseCleanup('standard', new Set(['highpass'])); // afftdn absent
  assert.equal(plan.ok, false);
  if (!plan.ok) {
    assert.deepEqual(plan.missing, ['afftdn']);
    assert.ok(plan.reason.includes('afftdn'));
  }
});

test('planNoiseCleanup: unknown profile throws INVALID_ARGUMENT', () => {
  assert.throws(
    () => planNoiseCleanup('nope' as never, new Set()),
    (err: unknown) => err instanceof AudioError && err.code === 'INVALID_ARGUMENT',
  );
});

test('listNoiseProfiles: UI metadata present for every profile', () => {
  const profiles = listNoiseProfiles();
  assert.ok(profiles.length >= 4);
  for (const p of profiles) {
    assert.ok(p.id && p.label && p.description);
  }
});

test('runNoiseCleanup: light profile on noisy wav produces a valid WAV', async () => {
  const dir = await makeTempDir();
  try {
    const input = await genNoisyToneWav(path.join(dir, 'noisy.wav'), { durationSec: 1 });
    const output = path.join(dir, 'clean.wav');
    const result = await runNoiseCleanup(input, output, 'light');
    assert.deepEqual(result.filters, ['highpass=f=90', 'lowpass=f=15500']);
    const wav = parseWav(await readFile(output));
    assert.equal(wav.sampleRate, 48000);
    assert.ok(wav.sampleCount > 47_000 && wav.sampleCount < 49_000, `≈1 s of samples, got ${wav.sampleCount}`);
    const outSec = await probeDurationSec(output);
    assert.ok(Math.abs(outSec - 1) < 0.1, `output ≈ 1 s, got ${outSec}`);
  } finally {
    await cleanupTempDir(dir);
  }
});

test('runNoiseCleanup: standard profile (afftdn) applies or fails honestly', async () => {
  const dir = await makeTempDir();
  try {
    const input = await genNoisyToneWav(path.join(dir, 'noisy.wav'), { durationSec: 1 });
    const output = path.join(dir, 'denoised.wav');
    try {
      const result = await runNoiseCleanup(input, output, 'standard');
      assert.ok(result.filters.some((f) => f.startsWith('afftdn=')));
      const wav = parseWav(await readFile(output));
      assert.ok(wav.sampleCount > 0);
    } catch (err) {
      // Only acceptable failure: the build genuinely lacks the filter.
      assert.ok(err instanceof AudioError);
      assert.equal(err.code, 'UNSUPPORTED_FEATURE');
    }
  } finally {
    await cleanupTempDir(dir);
  }
});
