import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  assertStickerExportable,
  getSticker,
  listStickers,
  resolveStickerParams,
  stickerSvg,
  STICKERS,
} from '../stickers.js';
import { FILTER_PRESETS, getPreset, instantiatePreset, listPresets } from '../presets.js';
import { buildPreviewPlan } from '../preview.js';
import {
  applyChannelMatrix,
  channelShiftRgb,
  convolve3x3,
} from '../preview.js';
import { duotoneMatrix, sepiaChain } from '../effects/definitions.js';
import { EffectsError } from '../errors.js';

/* ---------- stickers ---------- */

test('stickers generate original self-contained SVG', () => {
  const ids = STICKERS.map((s) => s.id);
  assert.deepEqual(ids, ['star', 'burst', 'arrow', 'speechBubble', 'badge', 'sparkle']);
  for (const id of ids) {
    const svg = stickerSvg(id);
    assert.ok(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"'), `${id} svg root`);
    assert.ok(svg.includes('</svg>'));
    // No external refs (original procedural graphics only).
    assert.ok(!svg.includes('http') || svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"'));
  }
});

test('sticker param overrides: colors normalized, numbers clamped', () => {
  assert.match(stickerSvg('star', { color: '#AABBCC' }), /#aabbcc/);
  const p = resolveStickerParams('star', { points: 99 });
  assert.equal(p.points, 12); // clamped to max
  assert.throws(() => resolveStickerParams('star', { color: 'red' as never }),
    (e: unknown) => e instanceof EffectsError && e.code === 'INVALID_ARGUMENT');
  assert.throws(() => getSticker('nope'), (e: unknown) => e instanceof EffectsError && e.code === 'NOT_FOUND');
});

test('sticker export is capability-gated OFF with the real reason', () => {
  try {
    assertStickerExportable();
    assert.fail('expected UNSUPPORTED_FEATURE');
  } catch (err) {
    assert.ok(err instanceof EffectsError);
    assert.equal(err.code, 'UNSUPPORTED_FEATURE');
    assert.match(err.message, /not implemented/i);
    assert.match(err.hint ?? '', /rasteriz/i);
    assert.match(err.hint ?? '', /overlay/);
  }
});

/* ---------- presets ---------- */

test('presets instantiate into validated effect instances', () => {
  const instances = instantiatePreset('noir', (effectId) => `test-${effectId}`);
  assert.equal(instances.length, 3);
  assert.deepEqual(instances.map((i) => i.effectId), ['grayscale', 'contrast', 'vignette']);
  assert.ok(instances.every((i) => i.enabled));
  assert.equal(instances[1].params.contrast, 1.25);
  assert.equal(instances[2].params.strength, 0.55);
});

test('every preset references known effects (validated by instantiation)', () => {
  for (const preset of listPresets()) {
    assert.doesNotThrow(() => instantiatePreset(preset.id, () => `p-${preset.id}`));
  }
  assert.equal(listPresets().length, FILTER_PRESETS.length);
  assert.throws(() => getPreset('nope'), (e: unknown) => e instanceof EffectsError && e.code === 'NOT_FOUND');
});

/* ---------- preview pixel math (pure reference implementations) ---------- */

test('convolve3x3 identity kernel is a no-op; alpha preserved', () => {
  const src = new Uint8ClampedArray([10, 20, 30, 255, 40, 50, 60, 128]);
  const out = convolve3x3(src, 2, 1, [0, 0, 0, 0, 1, 0, 0, 0, 0]);
  assert.deepEqual([...out], [...src]);
});

test('convolve3x3 sharpen kernel brightens edges, keeps flat areas', () => {
  const a = 0.5;
  const kernel = [0, -a, 0, -a, 1 + 4 * a, -a, 0, -a, 0];
  // Flat image stays flat (kernel sums to 1).
  const flat = new Uint8ClampedArray(2 * 2 * 4);
  for (let i = 0; i < flat.length; i += 4) { flat[i] = 100; flat[i + 1] = 100; flat[i + 2] = 100; flat[i + 3] = 255; }
  const out = convolve3x3(flat, 2, 2, kernel);
  assert.equal(out[0], 100);
  assert.equal(out[3], 255);
  // Step edge overshoots on the bright side (sharpening signature).
  const edge = new Uint8ClampedArray(4 * 1 * 4);
  for (let x = 0; x < 4; x++) {
    const v = x < 2 ? 50 : 150;
    const o = x * 4;
    edge[o] = v; edge[o + 1] = v; edge[o + 2] = v; edge[o + 3] = 255;
  }
  const outEdge = convolve3x3(edge, 4, 1, kernel);
  assert.ok(outEdge[2 * 4] > 150, `bright-side overshoot, got ${outEdge[2 * 4]}`);
  assert.ok(outEdge[1 * 4] < 50, `dark-side undershoot, got ${outEdge[1 * 4]}`);
});

test('channelShiftRgb moves red left and blue right', () => {
  // 3px wide, middle pixel pure white
  const src = new Uint8ClampedArray(3 * 4);
  src[1 * 4] = 200; src[1 * 4 + 1] = 200; src[1 * 4 + 2] = 200; src[1 * 4 + 3] = 255;
  const out = channelShiftRgb(src, 3, 1, 1);
  assert.equal(out[0 * 4], 200); // R appears one pixel to the LEFT
  assert.equal(out[2 * 4 + 2], 200); // B appears one pixel to the RIGHT
  assert.equal(out[1 * 4], 0);
});

test('applyChannelMatrix matches duotone matrix math', () => {
  const m = duotoneMatrix('#000000', '#ffffff'); // → grayscale in disguise
  const px = new Uint8ClampedArray([120, 60, 30, 255]);
  const out = applyChannelMatrix(px, 1, 1, m);
  const y = 0.2126 * 120 + 0.7152 * 60 + 0.0722 * 30;
  assert.ok(Math.abs(out[0] - y) < 1.5 && Math.abs(out[1] - y) < 1.5 && Math.abs(out[2] - y) < 1.5);
  assert.equal(out[3], 255);
});

test('sepiaChain at amount 1 uses the standard matrix constants', () => {
  const chain = sepiaChain(1);
  assert.match(chain, /rr=0\.393/);
  assert.match(chain, /rg=0\.769/);
  assert.match(chain, /bb=0\.134/);
  assert.equal(sepiaChain(0), 'colorchannelmixer=rr=1:rg=0:rb=0:gr=0:gg=1:gb=0:br=0:bg=0:bb=1');
});

/* ---------- preview plan builder ---------- */

test('buildPreviewPlan: ops per effect + honest export availability', () => {
  const caps = {
    ffmpegPath: 'f', version: 'v', filters: new Set(['eq', 'hue']),
    xfadeTransitions: new Set<string>(), probedAt: 'now',
  };
  const plan = buildPreviewPlan(
    [
      { id: 'i1', effectId: 'contrast', params: { contrast: 1.2 }, enabled: true },
      { id: 'i2', effectId: 'blur', params: { sigma: 3 }, enabled: true },
      { id: 'i3', effectId: 'saturation', params: {}, enabled: false },
    ],
    { width: 640, height: 360 },
    caps,
  );
  assert.equal(plan.length, 2); // disabled skipped
  assert.deepEqual(plan[0].ops, [{ op: 'cssFilter', css: 'contrast(1.2)' }]);
  assert.deepEqual(plan[1].ops, [{ op: 'cssFilter', css: 'blur(3px)' }]);
  assert.equal(plan[0].available.export, true);
  assert.equal(plan[1].available.export, false); // gblur missing from caps
  assert.match(plan[1].available.reason ?? '', /gblur/);
});
