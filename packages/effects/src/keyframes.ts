/**
 * Keyframe evaluator — produces per-parameter value streams from a clip's
 * stored `Keyframe[]` (contract v1 stores keyframes but the engine does not
 * evaluate them yet; this is the evaluator the export path can consume).
 *
 * Semantics (Designed — proposed for the contract body):
 * - Keyframes of one prop are sorted by `at` (stable; duplicates: last wins).
 * - Value is CLAMPED: at/before the first keyframe → first value;
 *   at/after the last keyframe → last value.
 * - Between keyframes k[i] → k[i+1], the curve comes from k[i].easing
 *   (left keyframe), applied to t = (at − k[i].at) / (k[i+1].at − k[i].at).
 * - Unknown props simply evaluate to the caller-supplied base value, which
 *   makes the evaluator generic over the proposed `effect.<id>.<param>` props.
 */

import { easingCurve, lerp } from './easing.js';
import { frameDurTicks } from './ticks.js';
import type { ClipLike, Keyframe, Rational, Ticks, Transform } from './types.js';

export function sortKeyframes(kfs: readonly Keyframe[], prop?: string): Keyframe[] {
  const filtered = prop === undefined ? kfs.slice() : kfs.filter((k) => k.prop === prop);
  // Stable sort by `at`; Array.prototype.sort is stable per spec.
  return filtered.sort((a, b) => a.at - b.at);
}

/**
 * Evaluate `prop` at timeline tick `at` (clip-local ticks for clip props).
 * Returns `base` when the prop has no keyframes.
 */
export function evaluatePropAt(
  keyframes: readonly Keyframe[],
  prop: string,
  at: Ticks,
  base: number,
): number {
  const kfs = sortKeyframes(keyframes, prop);
  if (kfs.length === 0) return base;
  if (at < kfs[0].at) return kfs[0].value;
  const last = kfs[kfs.length - 1];
  if (at >= last.at) return last.value; // exact match on a (possibly duplicate) last keyframe: last wins

  let i = 0;
  while (i + 1 < kfs.length && kfs[i + 1].at <= at) i++;
  const left = kfs[i];
  const right = kfs[i + 1];
  if (right.at === left.at) return right.value; // duplicate times: last wins
  const t = (at - left.at) / (right.at - left.at);
  return lerp(left.value, right.value, easingCurve(left.easing)(t));
}

export interface ParamSample {
  /** Frame index within the clip, 0-based. */
  frame: number;
  /** Timeline tick of the frame start. */
  at: Ticks;
  value: number;
}

export interface StreamSpec {
  keyframes: readonly Keyframe[];
  prop: string;
  /** Value when the prop has no keyframes (the clip's stored base). */
  base: number;
  fps: Rational;
  /** Timeline ticks of the first frame (usually clip.start). */
  start: Ticks;
  /** Timeline length to sample. */
  duration: Ticks;
}

/**
 * Sample the parameter's value at every frame start — the per-frame stream
 * an export plan or preview compositor consumes. Frame boundaries use the
 * integer tick frame duration (exact for all contract-guaranteed rates).
 */
export function sampleParamStream(spec: StreamSpec): ParamSample[] {
  const frameDur = frameDurTicks(spec.fps);
  const out: ParamSample[] = [];
  const frames = Math.max(0, Math.ceil(spec.duration / frameDur));
  for (let frame = 0; frame < frames; frame++) {
    const at = spec.start + frame * frameDur;
    out.push({ frame, at, value: evaluatePropAt(spec.keyframes, spec.prop, at, spec.base) });
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Clip-level resolution                                               */
/* ------------------------------------------------------------------ */

export const DEFAULT_TRANSFORM: Required<Transform> = {
  x: 0,
  y: 0,
  scale: 1,
  rotationDeg: 0,
  opacity: 1,
};

export const TRANSFORM_PROPS = [
  'transform.x',
  'transform.y',
  'transform.scale',
  'transform.rotationDeg',
  'transform.opacity',
] as const;

export interface ResolvedClipParams {
  x: number;
  y: number;
  scale: number;
  rotationDeg: number;
  opacity: number;
  /** Clip audio gain (keyframed via 'audio.volume' prop). */
  volume: number;
}

/**
 * Fully keyframe-evaluated transform + volume for a clip at tick `at`
 * (absolute timeline ticks). Base values come from `clip.transform` /
 * `clip.audio.volume`, falling back to contract defaults.
 */
export function resolveClipParamsAt(clip: ClipLike, at: Ticks): ResolvedClipParams {
  const t = clip.transform ?? DEFAULT_TRANSFORM;
  const kf = clip.keyframes;
  return {
    x: evaluatePropAt(kf, 'transform.x', at, t.x),
    y: evaluatePropAt(kf, 'transform.y', at, t.y),
    scale: evaluatePropAt(kf, 'transform.scale', at, t.scale),
    rotationDeg: evaluatePropAt(kf, 'transform.rotationDeg', at, t.rotationDeg),
    opacity: evaluatePropAt(kf, 'transform.opacity', at, t.opacity),
    volume: evaluatePropAt(kf, 'audio.volume', at, clip.audio?.volume ?? 1),
  };
}

/** True when the clip has at least one keyframe on any transform/volume prop. */
export function hasAnimatedParams(clip: ClipLike): boolean {
  return clip.keyframes.some(
    (k) => (TRANSFORM_PROPS as readonly string[]).includes(k.prop) || k.prop === 'audio.volume',
  );
}

/* ------------------------------------------------------------------ */
/* Effect-param prop paths (proposed contract extension)               */
/* ------------------------------------------------------------------ */

const EFFECT_PROP_PREFIX = 'effect.';

/** Prop path targeting one effect-instance param, e.g. 'effect.i1.blur.sigma'. */
export function effectProp(instanceId: string, paramId: string): string {
  if (!instanceId || instanceId.includes('.')) {
    throw new RangeError(`effectProp(): invalid instance id "${instanceId}" (no dots)`);
  }
  return `${EFFECT_PROP_PREFIX}${instanceId}.${paramId}`;
}

/** Parse an effect prop path back into its parts (null when not one). */
export function parseEffectProp(prop: string): { instanceId: string; paramId: string } | null {
  if (!prop.startsWith(EFFECT_PROP_PREFIX)) return null;
  const rest = prop.slice(EFFECT_PROP_PREFIX.length);
  const dot = rest.indexOf('.');
  if (dot <= 0 || dot === rest.length - 1) return null;
  return { instanceId: rest.slice(0, dot), paramId: rest.slice(dot + 1) };
}
