/**
 * Tick-time mirror of the project contract's time model.
 *
 * The canonical unit is integer ticks at TICKS_PER_SECOND = 70,560,000
 * (docs/PROJECT_CONTRACT.md "Time units"). This file intentionally mirrors
 * `@ve/engine`'s `time.ts` instead of importing it, so `@ve/audio` builds and
 * tests standalone with no cross-package coupling (see README "Design
 * decisions"). Structural typing means engine values are assignable here.
 */

export const TICKS_PER_SECOND = 70_560_000;

/** Integer count of ticks (1/70,560,000 s each). */
export type Ticks = number;

/** Exact rational number n/d, d > 0. Used for frame rates and speed. */
export interface Rational {
  readonly n: number;
  readonly d: number;
}

/** Ticks → seconds (float; exact for values on the contract's supported grid). */
export function secFromTicks(ticks: Ticks): number {
  return ticks / TICKS_PER_SECOND;
}

/** Seconds (float) → integer ticks (nearest). */
export function ticksFromSec(sec: number): Ticks {
  return Math.round(sec * TICKS_PER_SECOND);
}

/**
 * Exact conversion of a sample count to ticks at `sampleRate`.
 * Exact (integer) for the contract's supported rates 44100/48000/96000, which
 * all divide TICKS_PER_SECOND evenly (1600/1470/735 ticks per sample).
 * Other rates round to the nearest tick — documented precision loss < 1 tick.
 */
export function ticksFromSamples(sampleCount: number, sampleRate: number): Ticks {
  if (!Number.isInteger(sampleCount) || sampleCount < 0) {
    throw new RangeError(`ticksFromSamples(): sampleCount must be a non-negative integer, got ${sampleCount}`);
  }
  if (!Number.isInteger(sampleRate) || sampleRate <= 0) {
    throw new RangeError(`ticksFromSamples(): sampleRate must be a positive integer, got ${sampleRate}`);
  }
  return Math.round((sampleCount * TICKS_PER_SECOND) / sampleRate);
}

/**
 * Render ticks as an ffmpeg-friendly seconds literal (e.g. `0.5`, `1.25`).
 * Rounded to nanosecond precision (1e-9 s) to strip float-noise digits while
 * staying far below one audio sample (≈2e-5 s at 48 kHz).
 */
export function formatFfmpegSeconds(ticks: Ticks): string {
  if (!Number.isFinite(ticks)) throw new RangeError(`formatFfmpegSeconds(): invalid ticks ${ticks}`);
  return String(Number((ticks / TICKS_PER_SECOND).toFixed(9)));
}
