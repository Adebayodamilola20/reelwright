import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  TICKS_PER_SECOND,
  frameCeil,
  frameDurTicks,
  frameFloor,
  formatTimecode,
  framesToTicks,
  isSampleExact,
  parseTimecode,
  rat,
  ratFromFrameRateFloat,
  ticksFromSamples,
  ticksFromSec,
  ticksToFrames,
  ticksToSamples,
} from '../time.js';

test('tick rate makes NTSC frame durations exact integers', () => {
  for (const fps of [rat(30000, 1001), rat(24000, 1001), rat(60000, 1001), rat(30), rat(25), rat(24), rat(60)]) {
    const dur = frameDurTicks(fps);
    assert.ok(Number.isInteger(dur), `frame duration for ${fps.n}/${fps.d} must be integer, got ${dur}`);
  }
  assert.equal(frameDurTicks(rat(30000, 1001)), 2352 * 1001);
});

test('audio sample placement is exact for common rates', () => {
  for (const rate of [44100, 48000, 96000]) {
    assert.ok(isSampleExact(rate), `${rate} must divide the tick rate`);
    const oneSec = ticksFromSamples(rate, rate);
    assert.equal(oneSec, TICKS_PER_SECOND);
  }
  assert.equal(TICKS_PER_SECOND % 48000, 0);
});

test('frameFloor/frameCeil bracket partial frames', () => {
  const fps = rat(30);
  const fd = frameDurTicks(fps);
  assert.equal(frameFloor(fd - 1, fps), 0);
  assert.equal(frameCeil(1, fps), fd);
  assert.equal(frameFloor(fd, fps), fd);
  assert.equal(frameCeil(fd, fps), fd);
  assert.equal(ticksToFrames(fd * 10, fps), 10);
  assert.equal(framesToTicks(10, fps), fd * 10);
});

test('seconds round trip', () => {
  assert.equal(ticksFromSec(1), TICKS_PER_SECOND);
  assert.equal(ticksFromSec(0.5) * 2, TICKS_PER_SECOND);
});

test('ratFromFrameRateFloat recovers NTSC rates exactly', () => {
  assert.deepEqual(ratFromFrameRateFloat(29.97), rat(30000, 1001));
  assert.deepEqual(ratFromFrameRateFloat(23.976), rat(24000, 1001));
  assert.deepEqual(ratFromFrameRateFloat(59.94), rat(60000, 1001));
  assert.deepEqual(ratFromFrameRateFloat(30), rat(30));
});

test('timecode format + parse round trip', () => {
  const fps = rat(30);
  const t = framesToTicks(((1 * 3600 + 2 * 60 + 3) * 30) + 7, fps);
  assert.equal(formatTimecode(t, fps), '01:02:03:07');
  assert.equal(parseTimecode('01:02:03:07', fps), t);
  assert.equal(formatTimecode(0, fps), '00:00:00:00');
});
