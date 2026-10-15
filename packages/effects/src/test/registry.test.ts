import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  assertEffectExportable,
  effectAvailability,
  effectsAvailability,
  getEffect,
  hasEffect,
  instanceParamsAreConstant,
  listEffects,
  resolveEffectParams,
  resolveInstanceParamsAt,
} from '../effects/registry.js';
import { EFFECT_DEFINITIONS } from '../effects/definitions.js';
import { effectProp } from '../keyframes.js';
import { EffectsError } from '../errors.js';
import type { EffectInstance, Keyframe } from '../types.js';
import { fakeCaps, testClip } from './util.js';

test('registry has the documented core effects', () => {
  for (const id of ['blur', 'sharpen', 'brightness', 'contrast', 'saturation', 'grayscale',
    'sepia', 'invert', 'vignette', 'pixelate', 'temperature', 'duotone', 'chromatic']) {
    assert.ok(hasEffect(id), `missing effect ${id}`);
  }
  assert.equal(listEffects().length, EFFECT_DEFINITIONS.length);
});

test('every definition has params, an export mapping, and a preview mapping', () => {
  for (const def of listEffects()) {
    assert.ok(def.id.length > 0);
    assert.ok(def.name.length > 0);
    assert.ok(def.description.length > 0);
    assert.ok(def.params.length > 0, `${def.id} has params`);
    assert.ok(def.export.requiredFilters.length > 0, `${def.id} declares required filters`);
    const ctx = { width: 640, height: 360 };
    const params = resolveEffectParams(def.id);
    const chain = def.export.toChain(params, ctx);
    assert.equal(typeof chain, 'string');
    const ops = def.preview(params, ctx);
    assert.ok(Array.isArray(ops) && ops.length > 0, `${def.id} preview non-empty`);
  }
});

test('getEffect/hasEffect unknown id → NOT_FOUND with known list', () => {
  assert.equal(hasEffect('nope'), false);
  try {
    getEffect('nope');
    assert.fail('expected NOT_FOUND');
  } catch (err) {
    assert.ok(err instanceof EffectsError);
    assert.equal(err.code, 'NOT_FOUND');
    assert.match(err.hint ?? '', /blur/);
  }
});

test('resolveEffectParams: defaults + clamping + unknown-key rejection', () => {
  const defaults = resolveEffectParams('blur');
  assert.equal(defaults.sigma, 8);
  const clamped = resolveEffectParams('blur', { sigma: 999 });
  assert.equal(clamped.sigma, 64); // max
  const neg = resolveEffectParams('brightness', { brightness: -5 });
  assert.equal(neg.brightness, -1); // min
  assert.throws(() => resolveEffectParams('blur', { sigm: 3 }), (e: unknown) =>
    e instanceof EffectsError && e.code === 'INVALID_ARGUMENT');
  assert.throws(() => resolveEffectParams('blur', { sigma: 'big' as never }), EffectsError);
  assert.throws(() => resolveEffectParams('invert', { on: 1 as never }), EffectsError);
  assert.throws(() => resolveEffectParams('duotone', { dark: 'red' as never }), (e: unknown) =>
    e instanceof EffectsError && /#rrggbb/.test(e.message));
});

test('keyframed instance params evaluate at time (preview path)', () => {
  const inst: EffectInstance = { id: 'i1', effectId: 'blur', params: { sigma: 4 }, enabled: true };
  const prop = effectProp('i1', 'sigma');
  const keyframes: Keyframe[] = [
    { prop, at: 0, value: 0, easing: 'linear' },
    { prop, at: 1000, value: 99, easing: 'linear' },
  ];
  const clip = testClip({ keyframes });
  assert.equal(resolveInstanceParamsAt(clip, inst, 500).sigma, 49.5);
  assert.equal(resolveInstanceParamsAt(clip, inst, 0).sigma, 0);
  // static params when no keyframes target the instance
  assert.equal(resolveInstanceParamsAt(testClip(), inst, 500).sigma, 4);
  // clamped when keyframes exceed the param range (sigma max = 64)
  assert.equal(resolveInstanceParamsAt(clip, inst, 1000).sigma, 64);
});

test('instanceParamsAreConstant distinguishes keyframed vs static', () => {
  const inst: EffectInstance = { id: 'i1', effectId: 'blur', params: {}, enabled: true };
  assert.equal(instanceParamsAreConstant(testClip(), inst), true);
  const keyed = testClip({
    keyframes: [{ prop: effectProp('i1', 'sigma'), at: 0, value: 1, easing: 'linear' }],
  });
  assert.equal(instanceParamsAreConstant(keyed, inst), false);
  // keyframes on a DIFFERENT instance do not taint this one
  const other = testClip({
    keyframes: [{ prop: effectProp('i2', 'sigma'), at: 0, value: 1, easing: 'linear' }],
  });
  assert.equal(instanceParamsAreConstant(other, inst), true);
});

test('effectAvailability: export false + reason when filters missing', () => {
  const caps = fakeCaps(['eq', 'scale', 'format', 'geq']); // no gblur!
  const blur = effectAvailability('blur', caps);
  assert.equal(blur.preview, true);
  assert.equal(blur.export, false);
  assert.deepEqual(blur.missingFilters, ['gblur']);
  assert.match(blur.reason ?? '', /gblur/);
  const eq = effectAvailability('contrast', caps);
  assert.equal(eq.export, true);

  const all = effectsAvailability(caps);
  assert.equal(all.length, listEffects().length);
  assert.ok(all.every((a) => a.preview === true));
});

test('assertEffectExportable throws UNSUPPORTED_FEATURE + hint', () => {
  const caps = fakeCaps(['eq']);
  try {
    assertEffectExportable('sharpen', caps);
    assert.fail('expected UNSUPPORTED_FEATURE');
  } catch (err) {
    assert.ok(err instanceof EffectsError);
    assert.equal(err.code, 'UNSUPPORTED_FEATURE');
    assert.match(err.hint ?? '', /unsharp/);
  }
});
