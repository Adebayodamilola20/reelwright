import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_TRANSFORM,
  effectProp,
  evaluatePropAt,
  hasAnimatedParams,
  parseEffectProp,
  resolveClipParamsAt,
  sampleParamStream,
  sortKeyframes,
} from '../keyframes.js';
import { TICKS_PER_SECOND, type Keyframe } from '../types.js';
import { frameDurTicks } from '../ticks.js';
import { rat } from '../ticks.js';
import { testClip } from './util.js';

const FPS30 = rat(30, 1);
const FPS2997 = rat(30000, 1001);

function kf(prop: string, at: number, value: number, easing: Keyframe['easing'] = 'linear'): Keyframe {
  return { prop, at, value, easing };
}

test('no keyframes → base value', () => {
  assert.equal(evaluatePropAt([], 'transform.opacity', 500, 0.7), 0.7);
});

test('clamp before first and after last keyframe', () => {
  const kfs = [kf('transform.opacity', 100, 0.2), kf('transform.opacity', 900, 0.8)];
  assert.equal(evaluatePropAt(kfs, 'transform.opacity', 0, 0.5), 0.2);
  assert.equal(evaluatePropAt(kfs, 'transform.opacity', 100, 0.5), 0.2);
  assert.equal(evaluatePropAt(kfs, 'transform.opacity', 900, 0.5), 0.8);
  assert.equal(evaluatePropAt(kfs, 'transform.opacity', 5000, 0.5), 0.8);
});

test('linear interpolation midpoints', () => {
  const kfs = [kf('transform.x', 0, 0), kf('transform.x', 1000, 100)];
  assert.equal(evaluatePropAt(kfs, 'transform.x', 250, 999), 25);
  assert.equal(evaluatePropAt(kfs, 'transform.x', 500, 999), 50);
});

test('unsorted input is tolerated (sorted internally)', () => {
  const kfs = [kf('transform.y', 1000, 100), kf('transform.y', 0, 0)];
  assert.equal(evaluatePropAt(kfs, 'transform.y', 500, 0), 50);
  const sorted = sortKeyframes(kfs, 'transform.y');
  assert.deepEqual(sorted.map((k) => k.at), [0, 1000]);
});

test('segment easing comes from the LEFT keyframe', () => {
  // hold on the left keyframe → step stays at 10 until 1000, then jumps to 20
  const kfs = [kf('transform.scale', 0, 10, 'hold'), kf('transform.scale', 1000, 20)];
  assert.equal(evaluatePropAt(kfs, 'transform.scale', 999, 0), 10);
  assert.equal(evaluatePropAt(kfs, 'transform.scale', 1000, 0), 20);
  // easeIn on the left keyframe → quadratic ramp
  const kfs2 = [kf('transform.scale', 0, 0, 'easeIn'), kf('transform.scale', 1000, 100)];
  assert.equal(evaluatePropAt(kfs2, 'transform.scale', 500, 0), 25);
});

test('easeOut/easeInOut midpoints', () => {
  const eo = [kf('a.b', 0, 0, 'easeOut'), kf('a.b', 100, 100)];
  assert.equal(evaluatePropAt(eo, 'a.b', 50, 0), 75);
  const ei = [kf('a.b', 0, 0, 'easeInOut'), kf('a.b', 100, 100)];
  assert.equal(evaluatePropAt(ei, 'a.b', 50, 0), 50);
  assert.equal(evaluatePropAt(ei, 'a.b', 25, 0), 12.5); // 2·(0.25²)·100
});

test('duplicate keyframe times: last wins', () => {
  const kfs = [kf('t.v', 100, 1), kf('t.v', 100, 2)];
  assert.equal(evaluatePropAt(kfs, 't.v', 100, 0), 2);
  assert.equal(evaluatePropAt(kfs, 't.v', 50, 0), 1);
});

test('other props are filtered out', () => {
  const kfs = [kf('transform.x', 0, 42), kf('transform.y', 0, 7)];
  assert.equal(evaluatePropAt(kfs, 'transform.x', 500, 0), 42);
  assert.equal(evaluatePropAt(kfs, 'transform.opacity', 500, 1), 1);
});

test('sampleParamStream: frame count and tick spacing (30 fps)', () => {
  const stream = sampleParamStream({
    keyframes: [kf('transform.opacity', 0, 0), kf('transform.opacity', TICKS_PER_SECOND, 1)],
    prop: 'transform.opacity',
    base: 0,
    fps: FPS30,
    start: 0,
    duration: TICKS_PER_SECOND, // 1 s → 30 frames
  });
  assert.equal(stream.length, 30);
  assert.equal(stream[0].frame, 0);
  assert.equal(stream[1].at - stream[0].at, frameDurTicks(FPS30));
  assert.equal(stream[0].value, 0);
  assert.ok(Math.abs(stream[29].value - 29 / 30) < 1e-9);
});

test('sampleParamStream: NTSC 30000/1001 frame duration is integer ticks', () => {
  const dur = frameDurTicks(FPS2997);
  assert.equal(dur, 2_354_352); // contract claim: 2352 × 1001
  const stream = sampleParamStream({
    keyframes: [],
    prop: 'transform.scale',
    base: 1,
    fps: FPS2997,
    start: 0,
    duration: TICKS_PER_SECOND,
  });
  assert.equal(stream.length, 30);
  assert.ok(stream.every((s) => s.value === 1));
});

test('resolveClipParamsAt: defaults + keyframe overrides', () => {
  const clip = testClip({
    transform: { x: 5, y: -3, scale: 2, rotationDeg: 10, opacity: 0.5 },
    audio: { volume: 0.8 },
    keyframes: [kf('transform.opacity', 0, 0), kf('transform.opacity', 1000, 1)],
  });
  const mid = resolveClipParamsAt(clip, 500);
  assert.equal(mid.x, 5);
  assert.equal(mid.y, -3);
  assert.equal(mid.scale, 2);
  assert.equal(mid.rotationDeg, 10);
  assert.equal(mid.opacity, 0.5);
  assert.equal(mid.volume, 0.8);
});

test('resolveClipParamsAt: missing transform falls back to defaults', () => {
  const clip = testClip();
  const p = resolveClipParamsAt(clip, 0);
  assert.deepEqual(p, { ...DEFAULT_TRANSFORM, volume: 1 });
});

test('hasAnimatedParams detects transform + volume animation only', () => {
  assert.equal(hasAnimatedParams(testClip()), false);
  assert.equal(hasAnimatedParams(testClip({ keyframes: [kf('transform.x', 0, 1)] })), true);
  assert.equal(hasAnimatedParams(testClip({ keyframes: [kf('audio.volume', 0, 1)] })), true);
  assert.equal(hasAnimatedParams(testClip({ keyframes: [kf('effect.i1.sigma', 0, 1)] })), false);
});

test('effect prop paths round-trip', () => {
  const prop = effectProp('i1', 'sigma');
  assert.equal(prop, 'effect.i1.sigma');
  assert.deepEqual(parseEffectProp(prop), { instanceId: 'i1', paramId: 'sigma' });
  assert.equal(parseEffectProp('transform.x'), null);
  assert.equal(parseEffectProp('effect.bad'), null);
  assert.throws(() => effectProp('a.b', 'sigma'), RangeError);
});
