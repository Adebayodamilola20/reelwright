/**
 * Minimal tick-time helpers (mirror of the contract's time model).
 *
 * These duplicate two formulas from `@ve/engine/src/time.ts` on purpose so
 * this package stays standalone; they are covered by unit tests against the
 * contract's normative claims (integer frame durations for standard and NTSC
 * rates). If the contract review accepts convergence, these become re-exports.
 */

import { TICKS_PER_SECOND, type Rational, type Ticks } from './types.js';

/** Exact seconds from ticks (float; display/export boundaries only). */
export function secFromTicks(ticks: Ticks): number {
  return ticks / TICKS_PER_SECOND;
}

/** Ticks from float seconds (rounded to nearest integer tick). */
export function ticksFromSec(sec: number): Ticks {
  return Math.round(sec * TICKS_PER_SECOND);
}

/**
 * Duration of one frame in ticks for a rational frame rate.
 * Integer for every rate the contract guarantees (24/25/30/50/60/120 and NTSC
 * 24000/1001, 30000/1001, 60000/1001); rounded otherwise (documented boundary).
 */
export function frameDurTicks(fps: Rational): Ticks {
  return Math.round((TICKS_PER_SECOND * fps.d) / fps.n);
}

/** Rational value as float (speed factors, frame rates). */
export function ratValue(r: Rational): number {
  return r.n / r.d;
}

/** Reduced rational from integers (throws on invalid input). */
export function rat(n: number, d = 1): Rational {
  if (!Number.isInteger(n) || !Number.isInteger(d) || d <= 0) {
    throw new RangeError(`rat(): expected integers with d > 0, got ${n}/${d}`);
  }
  const g = gcd(Math.abs(n), Math.abs(d)) || 1;
  return { n: n / g, d: d / g };
}

function gcd(a: number, b: number): number {
  while (b !== 0) {
    const t = b;
    b = a % b;
    a = t;
  }
  return a;
}

/** Format a number for ffmpeg filter args: ≤4 decimals, no trailing zeros. */
export function fmt(n: number): string {
  if (!Number.isFinite(n)) throw new RangeError(`fmt(): non-finite number ${n}`);
  return String(Number(n.toFixed(4)));
}
