import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  atempoChain,
  MAX_SPEED,
  MIN_SPEED,
  sourceSpanTicks,
  sourceTicksAt,
  speedExportPlan,
  speedFactor,
  timelineTicksForSource,
  validateSpeed,
} from '../speed.js';
import { EffectsError } from '../errors.js';
import { TICKS_PER_SECOND } from '../types.js';

const SEC = TICKS_PER_SECOND;

test('validateSpeed rejects non-positive and out-of-range', () => {
  assert.throws(() => validateSpeed({ n: 0, d: 1 }), (e: unknown) => e instanceof EffectsError && e.code === 'INVALID_ARGUMENT');
  assert.throws(() => validateSpeed({ n: -1, d: 1 }), EffectsError);
  assert.throws(() => validateSpeed({ n: 1, d: 0 }), EffectsError);
  assert.throws(() => validateSpeed({ n: 32, d: 1 }), /range/); // > 16×
  assert.throws(() => validateSpeed({ n: 1, d: 64 }), /range/); // < 1/16×
  validateSpeed({ n: 1, d: 1 });
  validateSpeed({ n: MAX_SPEED, d: 1 });
  validateSpeed({ n: 1, d: 16 });
});

test('speedFactor returns float value', () => {
  assert.equal(speedFactor({ n: 1, d: 1 }), 1);
  assert.equal(speedFactor({ n: 1, d: 2 }), 0.5);
  assert.equal(speedFactor({ n: 3, d: 2 }), 1.5);
});

test('sourceTicksAt: 2× consumes source twice as fast', () => {
  const clip = { start: 0, duration: SEC, sourceIn: SEC, speed: { n: 2, d: 1 } };
  assert.equal(sourceTicksAt(clip, 0), SEC);
  // At half the timeline, 2× has consumed one full second of source.
  assert.equal(sourceTicksAt(clip, Math.floor(SEC / 2)), 2 * SEC);
  assert.equal(sourceSpanTicks(clip), 2 * SEC);
});

test('sourceTicksAt: half speed', () => {
  const clip = { start: SEC, duration: SEC, sourceIn: 0, speed: { n: 1, d: 2 } };
  assert.equal(sourceTicksAt(clip, SEC), 0);
  assert.equal(sourceTicksAt(clip, SEC + Math.floor(SEC / 2)), Math.floor(SEC / 4));
  assert.equal(sourceSpanTicks(clip), Math.floor(SEC / 2));
});

test('timelineTicksForSource inverts sourceTicksAt for 1× and 2×', () => {
  const clip = { start: 0, duration: SEC, sourceIn: 0, speed: { n: 2, d: 1 } };
  assert.equal(timelineTicksForSource(clip, 2 * SEC), SEC);
  assert.equal(sourceTicksAt(clip, timelineTicksForSource(clip, SEC)), SEC);
});

test('atempoChain decomposes factors into [0.5, 2.0] pieces', () => {
  assert.deepEqual(atempoChain(1), []);
  assert.deepEqual(atempoChain(2), [2]);
  assert.deepEqual(atempoChain(4), [2, 2]);
  assert.deepEqual(atempoChain(8), [2, 2, 2]);
  assert.deepEqual(atempoChain(0.5), [0.5]);
  assert.deepEqual(atempoChain(0.25), [0.5, 0.5]);
  assert.deepEqual(atempoChain(3), [2, 1.5]);
  assert.deepEqual(atempoChain(0.8), [0.8]);
  for (const f of [1, 4, 0.25, 3, 0.75]) {
    const product = atempoChain(f).reduce((a, b) => a * b, 1);
    assert.ok(Math.abs(product - f) < 1e-6, `chain of ${f} multiplies back`);
  }
  assert.throws(() => atempoChain(0), RangeError);
});

test('speedExportPlan: 1× is a no-op; 2× maps setpts=PTS*1/2 + atempo=2', () => {
  const none = speedExportPlan({ n: 1, d: 1 });
  assert.deepEqual(none, { video: [], audio: [], requiredFilters: [], notes: [] });

  const two = speedExportPlan({ n: 2, d: 1 });
  assert.deepEqual(two.video, ['setpts=PTS*1/2']);
  assert.deepEqual(two.audio, ['atempo=2']);
  assert.ok(two.requiredFilters.includes('setpts'));
  assert.ok(two.requiredFilters.includes('atempo'));

  const half = speedExportPlan({ n: 1, d: 2 });
  assert.deepEqual(half.video, ['setpts=PTS*2/1']);
  assert.deepEqual(half.audio, ['atempo=0.5']);
});

test('speedExportPlan notes chained audio for extreme speeds', () => {
  const plan = speedExportPlan({ n: 4, d: 1 });
  assert.equal(plan.audio.length, 2);
  assert.equal(plan.notes.length, 1);
  assert.match(plan.notes[0], /atempo/);
});
