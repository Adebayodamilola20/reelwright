/**
 * Easing curves for the contract's easing set
 * ('linear' | 'easeIn' | 'easeOut' | 'easeInOut' | 'hold').
 *
 * Semantics (Designed; proposed for the contract body — see review notes):
 * - A segment's curve is taken from the LEFT keyframe of the segment.
 * - 'hold' steps to the right keyframe's value only when the segment starts
 *   (i.e. value = left value for the whole segment, applied as a step at t=0).
 * - Curves are pure quadratics on [0,1]:
 *     linear(t)    = t
 *     easeIn(t)    = t²
 *     easeOut(t)   = 1 − (1−t)²
 *     easeInOut(t) = t < ½ ? 2t²  : 1 − 2(1−t)²
 *   All satisfy f(0)=0, f(1)=1 and are monotonic.
 */

import type { Easing } from './types.js';

export type Curve = (t: number) => number;

const clamp01 = (t: number): number => (t < 0 ? 0 : t > 1 ? 1 : t);

export const linear: Curve = (t) => clamp01(t);
export const easeIn: Curve = (t) => {
  const x = clamp01(t);
  return x * x;
};
export const easeOut: Curve = (t) => {
  const x = clamp01(t);
  return 1 - (1 - x) * (1 - x);
};
export const easeInOut: Curve = (t) => {
  const x = clamp01(t);
  return x < 0.5 ? 2 * x * x : 1 - 2 * (1 - x) * (1 - x);
};
/** 'hold' — step at the start of the segment. */
export const hold: Curve = () => 0;

const CURVES: Record<Easing, Curve> = { linear, easeIn, easeOut, easeInOut, hold };

export function easingCurve(e: Easing): Curve {
  const c = CURVES[e];
  if (!c) throw new RangeError(`easingCurve(): unknown easing "${e}"`);
  return c;
}

/** Lerp helper (unclamped t is fine — callers pass eased t ∈ [0,1]). */
export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
