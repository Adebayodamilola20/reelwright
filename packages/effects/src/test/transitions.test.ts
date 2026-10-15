import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildTransitionExportPlan,
  transitionAvailability,
  transitionWindow,
  validateTransition,
} from '../transitions.js';
import { EffectsError } from '../errors.js';
import { TICKS_PER_SECOND, type Transition } from '../types.js';
import { secFromTicks } from '../ticks.js';
import { fakeCaps } from './util.js';

const D = Math.round(TICKS_PER_SECOND / 2); // half a second in ticks
const outgoing = { start: 0, duration: 2 * TICKS_PER_SECOND };
const incoming = { start: 2 * TICKS_PER_SECOND, duration: 2 * TICKS_PER_SECOND };

test('cut: zero window, concat strategies', () => {
  const w = transitionWindow(outgoing, incoming, { kind: 'cut', duration: 0 });
  assert.equal(w.programLoss, 0);
  assert.equal(w.regionStart, w.regionEnd);
  const plan = buildTransitionExportPlan(outgoing, incoming, { kind: 'cut', duration: 0 }, fakeCaps());
  assert.equal(plan.video.strategy, 'concat');
  assert.equal(plan.audio.strategy, 'concat');
  assert.deepEqual(plan.requiredFilters, ['concat']);
});

test('fade: region is the D-long tail before the boundary; xfade offset 0', () => {
  const t: Transition = { kind: 'fade', duration: D };
  const w = transitionWindow(outgoing, incoming, t);
  assert.equal(w.regionEnd, 2 * TICKS_PER_SECOND);
  assert.equal(w.regionStart, 2 * TICKS_PER_SECOND - D);
  assert.equal(w.outgoingTail.start, 2 * TICKS_PER_SECOND - D);
  assert.equal(w.incomingHead.end, 2 * TICKS_PER_SECOND + D);
  assert.equal(w.programLoss, D);

  const plan = buildTransitionExportPlan(outgoing, incoming, t, fakeCaps());
  assert.equal(plan.video.strategy, 'xfade');
  assert.deepEqual(plan.video.xfade, { transition: 'fade', durationSec: secFromTicks(D), offsetSec: 0 });
  assert.equal(plan.audio.strategy, 'acrossfade');
  assert.equal(plan.audio.durationSec, secFromTicks(D));
  assert.ok(plan.requiredFilters.includes('xfade'));
  assert.ok(plan.requiredFilters.includes('acrossfade'));
});

test('wipe maps directions to xfade wipe names', () => {
  const caps = fakeCaps();
  for (const [dir, name] of [
    ['left', 'wipeleft'], ['right', 'wiperight'], ['up', 'wipeup'], ['down', 'wipedown'],
  ] as const) {
    const plan = buildTransitionExportPlan(
      outgoing, incoming, { kind: 'wipe', duration: D, direction: dir }, caps);
    assert.equal(plan.video.xfade?.transition, name);
  }
  // default direction is left
  const dflt = buildTransitionExportPlan(outgoing, incoming, { kind: 'wipe', duration: D }, caps);
  assert.equal(dflt.video.xfade?.transition, 'wipeleft');
});

test('dipToColor: black→fadeblack, white→fadewhite, other colors blocked honestly', () => {
  const caps = fakeCaps();
  const black = buildTransitionExportPlan(
    outgoing, incoming, { kind: 'dipToColor', duration: D, color: '#000000' }, caps);
  assert.equal(black.video.xfade?.transition, 'fadeblack');
  const white = buildTransitionExportPlan(
    outgoing, incoming, { kind: 'dipToColor', duration: D, color: '#FFFFFF' }, caps);
  assert.equal(white.video.xfade?.transition, 'fadewhite');
  try {
    buildTransitionExportPlan(
      outgoing, incoming, { kind: 'dipToColor', duration: D, color: '#ff8800' }, caps);
    assert.fail('expected UNSUPPORTED_FEATURE');
  } catch (err) {
    assert.ok(err instanceof EffectsError);
    assert.equal(err.code, 'UNSUPPORTED_FEATURE');
    assert.match(err.hint ?? '', /black or white/);
  }
});

test('non-abutting clips rejected with INVALID_ARGUMENT + hint', () => {
  const gap = { start: 2 * TICKS_PER_SECOND + 100, duration: TICKS_PER_SECOND };
  try {
    transitionWindow(outgoing, gap, { kind: 'fade', duration: D });
    assert.fail('expected error');
  } catch (err) {
    assert.ok(err instanceof EffectsError);
    assert.equal(err.code, 'INVALID_ARGUMENT');
    assert.match(err.message, /abut/);
  }
});

test('transition longer than a clip rejected', () => {
  const shortIn = { start: 2 * TICKS_PER_SECOND, duration: Math.floor(D / 2) };
  assert.throws(
    () => transitionWindow(outgoing, shortIn, { kind: 'fade', duration: D }),
    (err: unknown) => err instanceof EffectsError && err.code === 'INVALID_ARGUMENT',
  );
});

test('validation: cut must be 0; others positive integer ticks', () => {
  assert.throws(() => validateTransition({ kind: 'cut', duration: 5 }), /zero duration/);
  assert.throws(() => validateTransition({ kind: 'fade', duration: 0 }), EffectsError);
  assert.throws(() => validateTransition({ kind: 'fade', duration: 1.5 }), /integer/);
  assert.throws(() => validateTransition({ kind: 'wipe', duration: 5, direction: 'sideways' as never }), /direction/);
  assert.throws(() => validateTransition({ kind: 'dipToColor', duration: 5, color: 'red' }), EffectsError);
});

test('missing filters → UNSUPPORTED_FEATURE + hint (honest gating)', () => {
  const noXfade = fakeCaps(['eq', 'scale', 'concat', 'acrossfade']);
  try {
    buildTransitionExportPlan(outgoing, incoming, { kind: 'fade', duration: D }, noXfade);
    assert.fail('expected UNSUPPORTED_FEATURE');
  } catch (err) {
    assert.ok(err instanceof EffectsError);
    assert.equal(err.code, 'UNSUPPORTED_FEATURE');
    assert.match(err.message, /xfade/);
  }
  const noAcrossfade = fakeCaps(undefined, undefined);
  noAcrossfade.filters.delete('acrossfade');
  assert.throws(
    () => buildTransitionExportPlan(outgoing, incoming, { kind: 'fade', duration: D }, noAcrossfade),
    (err: unknown) => err instanceof EffectsError && err.code === 'UNSUPPORTED_FEATURE',
  );
});

test('missing xfade transition name gated separately', () => {
  const caps = fakeCaps(undefined, ['fade']); // e.g. an old xfade without wipes
  try {
    buildTransitionExportPlan(outgoing, incoming, { kind: 'wipe', duration: D, direction: 'up' }, caps);
    assert.fail('expected UNSUPPORTED_FEATURE');
  } catch (err) {
    assert.ok(err instanceof EffectsError);
    assert.equal(err.code, 'UNSUPPORTED_FEATURE');
    assert.match(err.message, /wipeup/);
  }
});

test('transitionAvailability never throws; reports reason', () => {
  const ok = transitionAvailability({ kind: 'fade', duration: D }, fakeCaps());
  assert.equal(ok.available, true);
  const bad = transitionAvailability(
    { kind: 'fade', duration: D }, fakeCaps(['eq'], []));
  assert.equal(bad.available, false);
  assert.ok(bad.reason && bad.reason.length > 0);
});
