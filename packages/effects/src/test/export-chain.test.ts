import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildClipVideoChain,
  buildEffectChain,
  buildTransformChain,
  clipExportBlockers,
} from '../export-chain.js';
import { effectProp } from '../keyframes.js';
import { EffectsError } from '../errors.js';
import type { EffectInstance, Keyframe } from '../types.js';
import { fakeCaps, testClip } from './util.js';

const ctx = { width: 1920, height: 1080 };
const NO_KEYFRAMES: Keyframe[] = [];

const inst = (id: string, effectId: string, params: Record<string, number | boolean | string> = {}, enabled = true): EffectInstance =>
  ({ id, effectId, params, enabled });

test('single effect chain', () => {
  const built = buildEffectChain([inst('i1', 'blur', { sigma: 5 })], NO_KEYFRAMES, ctx, fakeCaps());
  assert.equal(built.chain, 'gblur=sigma=5');
  assert.deepEqual(built.requiredFilters, ['gblur']);
});

test('eq-family effects merge into one eq call', () => {
  const built = buildEffectChain([
    inst('i1', 'brightness', { brightness: 0.1 }),
    inst('i2', 'contrast', { contrast: 1.2 }),
    inst('i3', 'saturation', { saturation: 0.8 }),
  ], NO_KEYFRAMES, ctx, fakeCaps());
  assert.equal(built.chain, 'eq=brightness=0.1:contrast=1.2:saturation=0.8');
  assert.deepEqual(built.requiredFilters, ['eq']);
});

test('merge only applies to CONSECUTIVE same-mergeKey instances', () => {
  const built = buildEffectChain([
    inst('i1', 'brightness', { brightness: 0.1 }),
    inst('i2', 'blur', { sigma: 2 }),
    inst('i3', 'contrast', { contrast: 1.2 }),
  ], NO_KEYFRAMES, ctx, fakeCaps());
  assert.equal(built.chain, 'eq=brightness=0.1,gblur=sigma=2,eq=contrast=1.2');
});

test('disabled instances are skipped (inert by data)', () => {
  const built = buildEffectChain([
    inst('i1', 'blur', { sigma: 5 }, false),
    inst('i2', 'invert', {}, true),
  ], NO_KEYFRAMES, ctx, fakeCaps());
  assert.equal(built.chain, 'negate');
});

test('missing filter → UNSUPPORTED_FEATURE + actionable hint', () => {
  const caps = fakeCaps(['eq', 'concat', 'scale', 'format', 'geq']);
  try {
    buildEffectChain([inst('i1', 'vignette')], NO_KEYFRAMES, ctx, caps);
    assert.fail('expected UNSUPPORTED_FEATURE');
  } catch (err) {
    assert.ok(err instanceof EffectsError);
    assert.equal(err.code, 'UNSUPPORTED_FEATURE');
    assert.match(err.message, /Vignette/);
    assert.match(err.hint ?? '', /vignette/);
  }
});

test('keyframed effect params block export honestly (preview still animates)', () => {
  const prop = effectProp('i1', 'sigma');
  const keyframes: Keyframe[] = [{ prop, at: 0, value: 2, easing: 'linear' }];
  try {
    buildEffectChain([inst('i1', 'blur')], keyframes, ctx, fakeCaps());
    assert.fail('expected UNSUPPORTED_FEATURE');
  } catch (err) {
    assert.ok(err instanceof EffectsError);
    assert.equal(err.code, 'UNSUPPORTED_FEATURE');
    assert.match(err.hint ?? '', /Blur\.Strength/);
  }
});

test('mask chain orders after effects; required filters union', () => {
  const clip = testClip({
    effects: [inst('i1', 'contrast', { contrast: 1.1 })],
    mask: { shape: 'ellipse', cx: 0.5, cy: 0.5, rx: 0.3, ry: 0.3, feather: 0.1, invert: false },
  });
  const built = buildClipVideoChain(clip, ctx, fakeCaps());
  assert.ok(built.chain.startsWith('eq=contrast=1.1,'));
  assert.ok(built.chain.includes('format=rgba,geq='));
  assert.ok(built.requiredFilters.includes('eq'));
  assert.ok(built.requiredFilters.includes('geq'));
});

test('no effects + no mask → empty passthrough chain', () => {
  const built = buildClipVideoChain(testClip(), ctx, fakeCaps());
  assert.equal(built.chain, '');
  assert.deepEqual(built.requiredFilters, []);
});

test('buildTransformChain: identity is passthrough; rotation/scale/opacity gated + mapped', () => {
  const caps = fakeCaps();
  const identity = buildTransformChain(
    { x: 0, y: 0, scale: 1, rotationDeg: 0, opacity: 1 }, caps);
  assert.equal(identity.chain, '');
  assert.deepEqual(identity.requiredFilters, []);
  assert.equal(identity.position.xExpr, '(main_w-overlay_w)/2+0');

  const full = buildTransformChain(
    { x: 100, y: -50, scale: 1.5, rotationDeg: 90, opacity: 0.5 }, caps);
  assert.ok(full.chain.includes('rotate=a=1.570796'));
  assert.ok(full.chain.includes('scale=iw*1.5:ih*1.5'));
  assert.ok(full.chain.endsWith('colorchannelmixer=aa=0.5'));
  assert.equal(full.position.yExpr, '(main_h-overlay_h)/2+-50');

  const noRotate = fakeCaps(['scale', 'format', 'colorchannelmixer']);
  assert.throws(
    () => buildTransformChain({ x: 0, y: 0, scale: 1, rotationDeg: 45, opacity: 1 }, noRotate),
    (err: unknown) => err instanceof EffectsError && err.code === 'UNSUPPORTED_FEATURE',
  );
});

test('clipExportBlockers: non-throwing preflight list', () => {
  const caps = fakeCaps(['eq']); // lacks gblur, unsharp, hue, etc.
  const blockers = clipExportBlockers(
    testClip({
      effects: [inst('i1', 'blur'), inst('i2', 'contrast', { contrast: 1.1 }), inst('i3', 'invert', {}, false)],
      mask: { shape: 'rect', cx: 0.5, cy: 0.5, rx: 0.5, ry: 0.5, feather: 0, invert: false },
    }),
    caps,
  );
  const features = blockers.map((b) => b.feature);
  assert.ok(features.includes('effect:blur'));
  assert.ok(!features.includes('effect:contrast')); // eq present → ok
  assert.ok(!features.includes('effect:invert')); // disabled → skipped
  assert.ok(features.includes('mask')); // geq missing
  assert.ok(blockers.every((b) => b.code === 'UNSUPPORTED_FEATURE' && b.reason.length > 0));
});

test('clipExportBlockers flags keyframed effect params', () => {
  const prop = effectProp('i1', 'sigma');
  const blockers = clipExportBlockers(
    testClip({
      effects: [inst('i1', 'blur')],
      keyframes: [{ prop, at: 0, value: 3, easing: 'linear' }],
    }),
    fakeCaps(),
  );
  assert.ok(blockers.some((b) => b.feature === 'keyframed-effect:i1'));
});
