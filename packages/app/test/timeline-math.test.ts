/**
 * Unit tests for timeline view math (pure functions).
 * Run: node --test packages/app/test/
 * No build step required — Node ≥ 22.6 strips types natively.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import * as M from "../src/ui/features/timeline/timeline-math.ts";

const FPS30 = { n: 30, d: 1 };
const FPS_NTSC = { n: 30000, d: 1001 };

test("formatTimecode renders HH:MM:SS:FF", () => {
  assert.equal(M.formatTimecode(0, FPS30), "00:00:00:00");
  assert.equal(M.formatTimecode(65.5, FPS30), "00:01:05:15");
  assert.equal(M.formatTimecode(3661, FPS30), "01:01:01:00");
  // guards
  assert.equal(M.formatTimecode(-5, FPS30), "00:00:00:00");
  assert.equal(M.formatTimecode(Number.NaN, FPS30), "00:00:00:00");
});

test("roundToFrame snaps to the frame grid", () => {
  assert.equal(M.roundToFrame(0.016, FPS30), 0); // below half a frame
  assert.equal(M.roundToFrame(0.017, FPS30), 1 / 30); // above half a frame
  assert.equal(M.roundToFrame(0, FPS30), 0);
  // NTSC: frame duration is non-terminating in decimal — still exact enough
  const fd = M.frameDurationSec(FPS_NTSC);
  assert.ok(Math.abs(M.roundToFrame(fd * 3 + 1e-9, FPS_NTSC) - fd * 3) < 1e-9);
});

test("rulerStepSec picks a readable step at any zoom", () => {
  assert.ok(M.rulerStepSec(80) * 80 >= 72, "80px/s → labels ≥ 72px apart");
  assert.ok(M.rulerStepSec(4) * 4 >= 72, "4px/s → labels ≥ 72px apart");
  assert.ok(M.rulerStepSec(800) * 800 >= 72, "800px/s → labels ≥ 72px apart");
  // At default zoom the ladder should land on whole seconds.
  assert.ok(M.rulerStepSec(80) >= 1);
});

test("snapClipStart snaps head edge to nearest candidate", () => {
  const r = M.snapClipStart({
    proposedStart: 1.03,
    duration: 4,
    candidates: [0, 1.0, 9.5],
    thresholdSec: 0.12,
    fps: FPS30,
    enabled: true,
  });
  assert.equal(r.start, 1.0);
  assert.equal(r.guide, 1.0);
});

test("snapClipStart snaps tail edge when closer", () => {
  // clip of 4s at 5.02 → tail at 9.02; candidate 9.0 → head moves to 5.0
  const r = M.snapClipStart({
    proposedStart: 5.02,
    duration: 4,
    candidates: [9.0, 20],
    thresholdSec: 0.12,
    fps: FPS30,
    enabled: true,
  });
  assert.equal(r.start, 5.0);
  assert.equal(r.guide, 9.0);
});

test("snapClipStart frames the value when nothing snaps", () => {
  const r = M.snapClipStart({
    proposedStart: 1.017,
    duration: 2,
    candidates: [50],
    thresholdSec: 0.05,
    fps: FPS30,
    enabled: true,
  });
  assert.equal(r.guide, null);
  assert.ok(Math.abs(r.start - Math.round(1.017 * 30) / 30) < 1e-9);
});

test("snapClipStart disabled → frame rounding only, no guide", () => {
  const r = M.snapClipStart({
    proposedStart: 2.01,
    duration: 1,
    candidates: [2.0],
    thresholdSec: 1,
    fps: FPS30,
    enabled: false,
  });
  assert.equal(r.guide, null);
  assert.ok(Math.abs(r.start - 2) < 1e-9);
});

test("snapClipStart never returns negative start", () => {
  const r = M.snapClipStart({
    proposedStart: -0.4,
    duration: 1,
    candidates: [0],
    thresholdSec: 1,
    fps: FPS30,
    enabled: true,
  });
  assert.ok(r.start >= 0);
});

test("collectSnapCandidates excludes moving clips, includes playhead and 0", () => {
  const c = M.collectSnapCandidates({
    clips: [
      { id: "a", start: 0, duration: 2 },
      { id: "b", start: 4, duration: 3 },
      { id: "m", start: 10, duration: 1 },
    ],
    movingIds: new Set(["m"]),
    playheadSec: 6,
  });
  assert.deepEqual(c, [0, 6, 0, 2, 4, 7]);
});

test("previewHeadTrim clamps to min duration and neighbours", () => {
  const tooMuch = M.previewHeadTrim({
    start: 2, duration: 4, deltaSec: 100, minStart: 1, maxEnd: 100,
  });
  assert.equal(tooMuch.start + tooMuch.duration <= 100 + 1e-9, true);
  assert.ok(tooMuch.duration >= M.MIN_CLIP_SEC - 1e-9);

  const beforeNeighbour = M.previewHeadTrim({
    start: 2, duration: 4, deltaSec: -5, minStart: 1, maxEnd: 100,
  });
  assert.equal(beforeNeighbour.start, 1);
  assert.ok(Math.abs(beforeNeighbour.duration - 5) < 1e-9);
});

test("previewTrim clamps end against next neighbour and min duration", () => {
  const r = M.previewTrim({
    start: 0, duration: 3, deltaSec: 50, minStart: 0, maxEnd: 6,
  });
  assert.ok(Math.abs(r.duration - 6) < 1e-9);
  const shrink = M.previewTrim({
    start: 0, duration: 3, deltaSec: -10, minStart: 0, maxEnd: 6,
  });
  assert.equal(shrink.duration, M.MIN_CLIP_SEC);
});

test("zoom clamp + step stay within bounds", () => {
  assert.equal(M.clampZoom(0.001), M.MIN_ZOOM_PX_PER_SEC);
  assert.equal(M.clampZoom(1e9), M.MAX_ZOOM_PX_PER_SEC);
  let z = M.DEFAULT_ZOOM_PX_PER_SEC;
  for (let i = 0; i < 30; i++) z = M.stepZoom(z, 2);
  assert.equal(z, M.MAX_ZOOM_PX_PER_SEC);
  for (let i = 0; i < 60; i++) z = M.stepZoom(z, 0.5);
  assert.equal(z, M.MIN_ZOOM_PX_PER_SEC);
});

test("coordinate mapping is inverse", () => {
  const z = 73.5;
  const s = 12.3456;
  assert.ok(Math.abs(M.pxToSec(M.secToPx(s, z), z) - s) < 1e-9);
});

test("formatRulerLabel and formatDuration read sanely", () => {
  assert.equal(M.formatRulerLabel(65, 1), "1:05");
  assert.equal(M.formatRulerLabel(3725, 60), "1:02:05");
  assert.equal(M.formatDuration(4.04), "4.0s");
  assert.equal(M.formatDuration(72), "1m12s");
});
