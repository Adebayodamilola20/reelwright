/**
 * Speed changes — pure time-remap math + export filter planning.
 *
 * Contract model: `Clip.speed` is a Rational; the source span consumed by a
 * clip of timeline duration D is D * speed. Constant speed per clip (v1);
 * speed RAMPING is Planned (feature matrix) — the ramp would live here as a
 * piecewise remap without changing this API surface.
 *
 * Export mappings (Observed present in local ffmpeg 8.1.1: setpts, atempo;
 * runtime-probed anyway for honest gating):
 * - video: `setpts=PTS*d/n` (faster playback = smaller PTS deltas)
 * - audio: `atempo=n/d` chained — atempo only supports [0.5, 2.0] per instance,
 *   so factors outside the range decompose into a chain (4× → atempo=2,atempo=2).
 */

import { fail } from './errors.js';
import { ratValue } from './ticks.js';
import type { Rational, Ticks } from './types.js';

/** Contract-sane speed bounds: (0, 16] after reduction; integers only. */
export const MIN_SPEED = 1 / 16;
export const MAX_SPEED = 16;

export interface SpeedClipLike {
  start: Ticks;
  duration: Ticks;
  sourceIn: Ticks;
  speed: Rational;
}

export function validateSpeed(speed: Rational): void {
  if (!Number.isInteger(speed.n) || !Number.isInteger(speed.d) || speed.d <= 0 || speed.n <= 0) {
    fail('INVALID_ARGUMENT', `Speed must be a positive rational, got ${speed.n}/${speed.d}.`,
      'Use a positive numerator and denominator (e.g. 1/2 for half speed).');
  }
  const v = ratValue(speed);
  if (v < MIN_SPEED || v > MAX_SPEED) {
    fail('INVALID_ARGUMENT', `Speed ${v}× is outside the supported range (${MIN_SPEED}×–${MAX_SPEED}×).`,
      'Clamp the speed into the supported range.');
  }
}

export function speedFactor(speed: Rational): number {
  validateSpeed(speed);
  return ratValue(speed);
}

/**
 * Source tick corresponding to timeline tick `at` for this clip
 * (i.e. which source frame is showing). Not clamped to the asset — callers
 * enforce media bounds as the engine ops do.
 */
export function sourceTicksAt(clip: SpeedClipLike, at: Ticks): Ticks {
  const f = speedFactor(clip.speed);
  return clip.sourceIn + Math.round((at - clip.start) * f);
}

/** Source span consumed by the clip (D * speed, rounded to integer ticks). */
export function sourceSpanTicks(clip: SpeedClipLike): Ticks {
  return Math.round(clip.duration * speedFactor(clip.speed));
}

/** Timeline duration needed to present a given source span at this speed. */
export function timelineTicksForSource(clip: SpeedClipLike, sourceTicks: Ticks): Ticks {
  const f = speedFactor(clip.speed);
  return Math.round(sourceTicks / f);
}

/**
 * Decompose a tempo factor into atempo chain values within [0.5, 2.0].
 * e.g. 4 → [2, 2]; 0.25 → [0.5, 0.5]; 3 → [2, 1.5]; 1 → [].
 */
export function atempoChain(factor: number): number[] {
  if (!Number.isFinite(factor) || factor <= 0) {
    throw new RangeError(`atempoChain(): invalid factor ${factor}`);
  }
  let f = factor;
  const out: number[] = [];
  while (f > 2) {
    out.push(2);
    f /= 2;
  }
  while (f < 0.5) {
    out.push(0.5);
    f /= 0.5;
  }
  if (Math.abs(f - 1) > 1e-9) out.push(Number(f.toFixed(6)));
  return out;
}

export interface SpeedExportPlan {
  video: string[];
  audio: string[];
  requiredFilters: string[];
  /** Human-readable notes for the export preflight UI. */
  notes: string[];
}

/**
 * Filter plan for a constant speed change. Returns empty chains for 1× so
 * callers can skip the mapping entirely.
 */
export function speedExportPlan(speed: Rational): SpeedExportPlan {
  validateSpeed(speed);
  const v = ratValue(speed);
  if (Math.abs(v - 1) < 1e-9) {
    return { video: [], audio: [], requiredFilters: [], notes: [] };
  }
  const video = [`setpts=PTS*${speed.d}/${speed.n}`];
  const audio = atempoChain(v).map((f) => `atempo=${f}`);
  const notes: string[] = [];
  if (audio.length > 1) {
    notes.push(`${v}× audio tempo chained through ${audio.length} atempo filters (ffmpeg limit 0.5–2.0 each).`);
  }
  return {
    video,
    audio,
    requiredFilters: ['setpts', 'atempo'],
    notes,
  };
}
