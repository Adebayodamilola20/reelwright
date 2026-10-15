/**
 * Preview-side helpers.
 *
 * The UI (Agent 2) executes PreviewOp plans with CSS filters or canvas. The
 * pixel-math functions here are pure Node-testable reference implementations
 * the renderer can use directly (no DOM in this package by design).
 */

import { effectAvailability, getEffect, resolveEffectParams } from './effects/registry.js';
import type { FfmpegCapabilities } from './capabilities.js';
import type {
  EffectContext,
  EffectInstance,
  PreviewOp,
} from './types.js';

/* ---------- pure pixel-math reference implementations ---------- */

/**
 * 3×3 convolution over RGB (alpha passthrough), clamp-to-edge borders.
 * `kernel` is row-major over the RGBA byte layout's RGB triplets
 * (9 numbers, L→R, T→B).
 */
export function convolve3x3(
  src: Uint8ClampedArray,
  width: number,
  height: number,
  kernel: number[],
  divisor = 1,
  bias = 0,
): Uint8ClampedArray {
  if (kernel.length !== 9) throw new RangeError('convolve3x3: kernel must have 9 numbers');
  const out = new Uint8ClampedArray(src.length);
  const sample = (x: number, y: number, c: number): number => {
    const cx = x < 0 ? 0 : x >= width ? width - 1 : x;
    const cy = y < 0 ? 0 : y >= height ? height - 1 : y;
    return src[(cy * width + cx) * 4 + c];
  };
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      for (let c = 0; c < 3; c++) {
        let acc = 0;
        for (let ky = -1; ky <= 1; ky++) {
          for (let kx = -1; kx <= 1; kx++) {
            acc += sample(x + kx, y + ky, c) * kernel[(ky + 1) * 3 + (kx + 1)];
          }
        }
        out[o + c] = acc / divisor + bias;
      }
      out[o + 3] = src[o + 3];
    }
  }
  return out;
}

/**
 * Horizontal channel shift (chromatic aberration reference): red channel
 * content moved −dx pixels (left), blue +dx (right), green untouched;
 * edge pixels clamp.
 */
export function channelShiftRgb(
  src: Uint8ClampedArray,
  width: number,
  height: number,
  dx: number,
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(src);
  const clampedX = (x: number): number => (x < 0 ? 0 : x >= width ? width - 1 : x);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      out[o] = src[(y * width + clampedX(x + dx)) * 4]; // R ← red content moves left
      out[o + 2] = src[(y * width + clampedX(x - dx)) * 4 + 2]; // B ← blue content moves right
    }
  }
  return out;
}

/** Apply a 3×3 RGB channel matrix (row-major) to RGB; alpha passthrough. */
export function applyChannelMatrix(
  src: Uint8ClampedArray,
  width: number,
  height: number,
  matrix: number[],
): Uint8ClampedArray {
  if (matrix.length !== 9) throw new RangeError('applyChannelMatrix: matrix must have 9 numbers');
  const out = new Uint8ClampedArray(src.length);
  for (let i = 0; i < src.length; i += 4) {
    const r = src[i];
    const g = src[i + 1];
    const b = src[i + 2];
    out[i] = matrix[0] * r + matrix[1] * g + matrix[2] * b;
    out[i + 1] = matrix[3] * r + matrix[4] * g + matrix[5] * b;
    out[i + 2] = matrix[6] * r + matrix[7] * g + matrix[8] * b;
    out[i + 3] = src[i + 3];
  }
  return out;
}

/* ---------- plan builders (what the UI consumes) ---------- */

export interface PreviewPlanEntry {
  instanceId: string;
  effectId: string;
  name: string;
  available: { preview: true; export: boolean; reason?: string };
  ops: PreviewOp[];
}

/**
 * Preview plan for a clip's enabled effects (order = instance order).
 * Every entry reports its export availability so the UI can annotate honestly
 * (e.g. "shows in preview; not exportable on this machine").
 */
export function buildPreviewPlan(
  instances: readonly EffectInstance[],
  ctx: EffectContext,
  caps?: FfmpegCapabilities,
): PreviewPlanEntry[] {
  const out: PreviewPlanEntry[] = [];
  for (const inst of instances) {
    if (!inst.enabled) continue;
    const def = getEffect(inst.effectId);
    const params = resolveEffectParams(inst.effectId, inst.params);
    out.push({
      instanceId: inst.id,
      effectId: def.id,
      name: def.name,
      available: caps
        ? { preview: true, ...pickAvailability(effectAvailability(def.id, caps)) }
        : { preview: true, export: true },
      ops: def.preview(params, ctx),
    });
  }
  return out;
}

function pickAvailability(a: { export: boolean; reason?: string }): {
  export: boolean;
  reason?: string;
} {
  return a.reason !== undefined ? { export: a.export, reason: a.reason } : { export: a.export };
}
