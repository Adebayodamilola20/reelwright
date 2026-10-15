import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planClipAudio, tryPlanClipAudio, formatGain, AudioError, TICKS_PER_SECOND } from '../index.js';

const ONE_SEC = TICKS_PER_SECOND;
const DEFAULT_AUDIO = { volume: 1, fadeIn: 0, fadeOut: 0, muted: false, pan: 0 };
const clipWith = (over: { durationTicks?: number; speed?: { n: number; d: number }; audio?: Partial<typeof DEFAULT_AUDIO> } = {}) => ({
  durationTicks: over.durationTicks ?? 2 * ONE_SEC,
  speed: over.speed,
  audio: { ...DEFAULT_AUDIO, ...over.audio },
});

test('unity gain + no fades → empty chain (identity)', () => {
  const plan = planClipAudio(clipWith());
  assert.equal(plan.skip, false);
  assert.deepEqual(plan.filters, []);
});

test('volume maps to the volume filter with clean formatting', () => {
  assert.deepEqual(planClipAudio(clipWith({ audio: { volume: 0.5, fadeIn: 0, fadeOut: 0, muted: false, pan: 0 } })).filters, [
    'volume=0.5',
  ]);
  assert.equal(formatGain(1.5), '1.5');
  assert.equal(formatGain(2 / 3), '0.666667');
});

test('fades map to afade with tick-exact seconds; volume precedes fades', () => {
  const plan = planClipAudio(
    clipWith({
      durationTicks: 2 * ONE_SEC,
      audio: { volume: 1.5, fadeIn: ONE_SEC / 2, fadeOut: ONE_SEC / 4, muted: false, pan: 0 },
    }),
  );
  assert.deepEqual(plan.filters, [
    'volume=1.5',
    'afade=t=in:st=0:d=0.5',
    'afade=t=out:st=1.75:d=0.25',
  ]);
});

test('muted clip or zero volume → skip with reason', () => {
  const muted = planClipAudio(clipWith({ audio: { volume: 1, fadeIn: 0, fadeOut: 0, muted: true, pan: 0 } }));
  assert.equal(muted.skip, true);
  assert.ok(muted.reason?.includes('muted'));
  const zero = planClipAudio(clipWith({ audio: { volume: 0, fadeIn: 0, fadeOut: 0, muted: false, pan: 0 } }));
  assert.equal(zero.skip, true);
  assert.ok(zero.reason?.includes('volume'));
});

test('fadeIn + fadeOut exceeding clip duration → INVALID_ARGUMENT', () => {
  assert.throws(
    () => planClipAudio(clipWith({ durationTicks: ONE_SEC, audio: { volume: 1, fadeIn: ONE_SEC / 2, fadeOut: ONE_SEC, muted: false, pan: 0 } })),
    (err: unknown) => err instanceof AudioError && err.code === 'INVALID_ARGUMENT',
  );
});

test('speed ≠ 1/1 → UNSUPPORTED_FEATURE (honest, not silently wrong fades)', () => {
  assert.throws(
    () => planClipAudio(clipWith({ speed: { n: 2, d: 1 } })),
    (err: unknown) => err instanceof AudioError && err.code === 'UNSUPPORTED_FEATURE',
  );
});

test('invalid gains/fades rejected', () => {
  for (const bad of [-1, NaN, Infinity]) {
    assert.throws(
      () => planClipAudio(clipWith({ audio: { volume: bad, fadeIn: 0, fadeOut: 0, muted: false, pan: 0 } })),
      (err: unknown) => err instanceof AudioError && err.code === 'INVALID_ARGUMENT',
      `volume ${bad}`,
    );
  }
  assert.throws(
    () => planClipAudio(clipWith({ audio: { volume: 1, fadeIn: -1, fadeOut: 0, muted: false, pan: 0 } })),
    (err: unknown) => err instanceof AudioError && err.code === 'INVALID_ARGUMENT',
  );
  assert.throws(
    () => planClipAudio(clipWith({ audio: { volume: 1, fadeIn: 1.5, fadeOut: 0, muted: false, pan: 0 } })),
    (err: unknown) => err instanceof AudioError && err.code === 'INVALID_ARGUMENT',
  );
});

test('tryPlanClipAudio: returns error shape instead of throwing (preflight-friendly)', () => {
  const bad = tryPlanClipAudio(clipWith({ speed: { n: 2, d: 1 } }));
  assert.equal(bad.ok, false);
  if (!bad.ok) {
    assert.equal(bad.error.code, 'UNSUPPORTED_FEATURE');
    assert.ok(bad.error.hint);
  }
  const good = tryPlanClipAudio(clipWith());
  assert.equal(good.ok, true);
});
