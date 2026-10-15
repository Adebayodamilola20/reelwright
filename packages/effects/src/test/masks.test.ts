import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildMaskChain,
  assertMaskExportable,
  maskAlphaExpression,
  maskPreview,
  MASK_PRESETS,
  validateMask,
} from '../masks.js';
import { EffectsError } from '../errors.js';
import type { MaskSpec } from '../types.js';
import { fakeCaps } from './util.js';

const ctx = { width: 1920, height: 1080 };

const ellipse: MaskSpec = { shape: 'ellipse', cx: 0.5, cy: 0.5, rx: 0.4, ry: 0.4, feather: 0.2, invert: false };
const rect: MaskSpec = { shape: 'rect', cx: 0.5, cy: 0.5, rx: 0.3, ry: 0.2, feather: 0, invert: false };

test('validateMask rejects bad shapes/ranges', () => {
  assert.throws(() => validateMask({ ...ellipse, shape: 'triangle' as never }), (e: unknown) => e instanceof EffectsError && e.code === 'INVALID_ARGUMENT');
  assert.throws(() => validateMask({ ...ellipse, rx: 0 }), /radii/);
  assert.throws(() => validateMask({ ...ellipse, cx: 1.5 }), /center/);
  assert.throws(() => validateMask({ ...ellipse, feather: 2 }), /feather/);
  assert.equal(validateMask({ ...ellipse, invert: undefined as never }).invert, false);
});

test('feathered ellipse expression shape (probe-verified formula)', () => {
  const expr = maskAlphaExpression(ellipse);
  assert.match(expr, /255\*min\(1,max\(0,\(1-sqrt\(pow\(/);
  assert.match(expr, /\/0\.2\)/);
  assert.ok(!expr.includes('255-(')); // not inverted
});

test('hard rect uses between(); feathered rect uses max(abs(...))', () => {
  const hard = maskAlphaExpression(rect);
  assert.match(hard, /if\(between\(X\/W,/);
  assert.match(hard, /between\(Y\/H,/);
  const soft = maskAlphaExpression({ ...rect, feather: 0.1 });
  assert.match(soft, /max\(abs\(X\/W-0\.5\)\/0\.3,abs\(Y\/H-0\.5\)\/0\.2\)/);
});

test('hard ellipse uses lte(pow..)', () => {
  const expr = maskAlphaExpression({ ...ellipse, feather: 0 });
  assert.match(expr, /if\(lte\(pow\(/);
});

test('invert wraps the expression in 255-(...)', () => {
  const expr = maskAlphaExpression({ ...ellipse, invert: true });
  assert.ok(expr.startsWith('255-('));
  assert.ok(expr.endsWith(')'));
});

test('buildMaskChain: format+geq with rgb identity', () => {
  const built = buildMaskChain(ellipse, ctx);
  assert.ok(built.chain.startsWith('format=rgba,geq='));
  assert.ok(built.chain.includes("r='p(X,Y)':g='p(X,Y)':b='p(X,Y)'"));
  assert.ok(built.chain.includes("a='"));
  assert.deepEqual(built.requiredFilters, ['format', 'geq']);
});

test('maskPreview: svg path + feather px', () => {
  const p = maskPreview(ellipse, ctx);
  assert.ok(p.svgPath.startsWith('M '));
  assert.match(p.svgPath, /A /); // arcs for ellipse
  assert.ok(Math.abs(p.featherPx - 0.2 * 0.4 * 1080) < 1e-6); // min(rxPx, ryPx) × feather
  const r = maskPreview(rect, ctx);
  assert.ok(r.svgPath.includes('H') && r.svgPath.includes('V'));
  assert.equal(r.featherPx, 0);
});

test('assertMaskExportable gates on missing geq/format', () => {
  assert.doesNotThrow(() => assertMaskExportable(ellipse, fakeCaps()));
  const noGeq = fakeCaps(['format', 'eq']);
  try {
    assertMaskExportable(ellipse, noGeq);
    assert.fail('expected UNSUPPORTED_FEATURE');
  } catch (err) {
    assert.ok(err instanceof EffectsError);
    assert.equal(err.code, 'UNSUPPORTED_FEATURE');
    assert.match(err.message, /geq/);
  }
});

test('MASK_PRESETS are valid', () => {
  for (const m of Object.values(MASK_PRESETS)) {
    assert.doesNotThrow(() => validateMask(m));
  }
});
