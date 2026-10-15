/**
 * Masks — normalized rect/ellipse masks with feather + invert.
 *
 * Export mapping (probed Observed on local ffmpeg 8.1.1, runtime-gated):
 *   format=rgba,geq=r='p(X,Y)':g='p(X,Y)':b='p(X,Y)':a='<alpha expr>'
 * - geq REQUIRES an rgb/luma expression even when only alpha changes; the
 *   identity `p(X,Y)` per channel preserves RGB (verified by probe).
 * - Feather is a linear falloff over `feather` × radius from the mask edge:
 *   a = 255·clamp((1 − d)/feather, 0, 1) with d = normalized edge distance.
 * - Verified by raw-frame probe: feathered ellipse alpha 255 at center, 0 at
 *   corners, monotonic falloff; rect via between() (Observed 2026-10-15).
 *
 * Preview mapping: an SVG path over the program frame + featherPx; the UI
 * renders the path as a clip-path/mask and approximates feather with a blur.
 */

import { assertFiltersAvailable, type FfmpegCapabilities } from './capabilities.js';
import { fail } from './errors.js';
import { fmt } from './ticks.js';
import type { EffectContext, MaskSpec } from './types.js';

export function validateMask(mask: MaskSpec): MaskSpec {
  if (mask.shape !== 'rect' && mask.shape !== 'ellipse') {
    fail('INVALID_ARGUMENT', `Unknown mask shape "${mask.shape}".`, 'Use "rect" or "ellipse".');
  }
  const { cx, cy, rx, ry, feather } = mask;
  for (const [k, v] of Object.entries({ cx, cy, rx, ry, feather })) {
    if (!Number.isFinite(v)) fail('INVALID_ARGUMENT', `Mask "${k}" must be a finite number.`);
  }
  if (rx <= 0 || rx > 4 || ry <= 0 || ry > 4) {
    fail('INVALID_ARGUMENT', `Mask radii must be in (0, 4], got rx=${rx} ry=${ry}.`,
      'Radii are fractions of the frame (1 = full frame).');
  }
  if (cx < 0 || cx > 1 || cy < 0 || cy > 1) {
    fail('INVALID_ARGUMENT', `Mask center must be within the frame (0..1), got (${cx}, ${cy}).`);
  }
  if (feather < 0 || feather > 1) {
    fail('INVALID_ARGUMENT', `Mask feather must be in [0, 1], got ${feather}.`);
  }
  return { ...mask, invert: !!mask.invert };
}

const GEQ_IDENTITY = "r='p(X,Y)':g='p(X,Y)':b='p(X,Y)'";

/**
 * The `a=` alpha expression for a mask (exported for tests + reuse).
 * Expression functions used (if/lte/between/min/max/abs/pow/sqrt) are all in
 * ffmpeg's expression evaluator (Observed via working probes).
 */
export function maskAlphaExpression(mask: MaskSpec): string {
  const { cx, cy, rx, ry, feather, shape } = mask;
  let expr: string;
  if (shape === 'rect') {
    const dx = `abs(X/W-${fmt(cx)})/${fmt(rx)}`;
    const dy = `abs(Y/H-${fmt(cy)})/${fmt(ry)}`;
    if (feather > 0) {
      expr = `255*min(1,max(0,(1-max(${dx},${dy}))/${fmt(feather)}))`;
    } else {
      expr =
        `if(between(X/W,${fmt(cx - rx)},${fmt(cx + rx)})*` +
        `between(Y/H,${fmt(cy - ry)},${fmt(cy + ry)}),255,0)`;
    }
  } else {
    const dx = `(X/W-${fmt(cx)})/${fmt(rx)}`;
    const dy = `(Y/H-${fmt(cy)})/${fmt(ry)}`;
    if (feather > 0) {
      expr = `255*min(1,max(0,(1-sqrt(pow(${dx},2)+pow(${dy},2)))/${fmt(feather)}))`;
    } else {
      expr = `if(lte(pow(${dx},2)+pow(${dy},2),1),255,0)`;
    }
  }
  return mask.invert ? `255-(${expr})` : expr;
}

export interface BuiltMaskChain {
  chain: string;
  requiredFilters: string[];
}

/** Full single-stream filter chain applying the mask (effects run BEFORE it). */
export function buildMaskChain(mask: MaskSpec, _ctx?: EffectContext): BuiltMaskChain {
  const m = validateMask(mask);
  const chain = `format=rgba,geq=${GEQ_IDENTITY}:a='${maskAlphaExpression(m)}'`;
  return { chain, requiredFilters: ['format', 'geq'] };
}

/** Gate wrapper: throws UNSUPPORTED_FEATURE when geq/format are absent. */
export function assertMaskExportable(mask: MaskSpec, caps: FfmpegCapabilities): void {
  assertFiltersAvailable(['format', 'geq'], caps, 'Mask');
}

export interface MaskPreview {
  svgPath: string;
  /** Feather width in pixels for the preview blur approximation. */
  featherPx: number;
  invert: boolean;
}

/**
 * SVG path over the program frame — the preview renders this as a mask/
 * clip-path. Feather is conveyed as featherPx (UI applies a blur to the mask).
 */
export function maskPreview(mask: MaskSpec, ctx: EffectContext): MaskPreview {
  const m = validateMask(mask);
  const W = ctx.width;
  const H = ctx.height;
  const cx = m.cx * W;
  const cy = m.cy * H;
  const rx = m.rx * W;
  const ry = m.ry * H;
  let svgPath: string;
  if (m.shape === 'rect') {
    const x0 = cx - rx;
    const y0 = cy - ry;
    svgPath =
      `M ${fmt(x0)} ${fmt(y0)} H ${fmt(cx + rx)} V ${fmt(cy + ry)} H ${fmt(x0)} Z`;
  } else {
    // Two half-ellipse arcs.
    svgPath =
      `M ${fmt(cx - rx)} ${fmt(cy)} ` +
      `A ${fmt(rx)} ${fmt(ry)} 0 1 0 ${fmt(cx + rx)} ${fmt(cy)} ` +
      `A ${fmt(rx)} ${fmt(ry)} 0 1 0 ${fmt(cx - rx)} ${fmt(cy)} Z`;
  }
  return { svgPath, featherPx: m.feather * Math.min(rx, ry), invert: m.invert };
}

/* ---------- common presets (original defaults) ---------- */

export const MASK_PRESETS: Record<string, MaskSpec> = {
  circleCenter: { shape: 'ellipse', cx: 0.5, cy: 0.5, rx: 0.4, ry: 0.4, feather: 0.15, invert: false },
  ovalFace: { shape: 'ellipse', cx: 0.5, cy: 0.42, rx: 0.22, ry: 0.3, feather: 0.2, invert: false },
  rectFull: { shape: 'rect', cx: 0.5, cy: 0.5, rx: 0.5, ry: 0.5, feather: 0, invert: false },
};
