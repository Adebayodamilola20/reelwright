import { test } from 'node:test';
import assert from 'node:assert/strict';
import { easeIn, easeInOut, easeOut, easingCurve, hold, lerp, linear } from '../easing.js';

test('curves satisfy f(0)=0 and f(1)=1', () => {
  for (const name of ['linear', 'easeIn', 'easeOut', 'easeInOut'] as const) {
    const f = easingCurve(name);
    assert.equal(f(0), 0, `${name}(0)`);
    assert.equal(f(1), 1, `${name}(1)`);
  }
});

test('hold always steps to 0 (left value)', () => {
  assert.equal(hold(0), 0);
  assert.equal(hold(0.5), 0);
  assert.equal(hold(1), 0);
});

test('curves are monotonic on [0,1]', () => {
  for (const name of ['linear', 'easeIn', 'easeOut', 'easeInOut'] as const) {
    const f = easingCurve(name);
    let prev = -1;
    for (let t = 0; t <= 1.0001; t += 0.01) {
      const v = f(t);
      assert.ok(v >= prev - 1e-12, `${name} monotonic at t=${t}`);
      prev = v;
    }
  }
});

test('ease curves differ from linear in the middle but agree at ends', () => {
  assert.ok(easeIn(0.5) < linear(0.5));
  assert.ok(easeOut(0.5) > linear(0.5));
  assert.equal(easeInOut(0.5), 0.5);
});

test('out-of-range t is clamped', () => {
  assert.equal(linear(-1), 0);
  assert.equal(linear(2), 1);
  assert.equal(easeIn(-0.5), 0);
  assert.equal(easeOut(1.5), 1);
});

test('unknown easing throws', () => {
  assert.throws(() => easingCurve('bounce' as never), RangeError);
});

test('lerp basics', () => {
  assert.equal(lerp(0, 10, 0.25), 2.5);
  assert.equal(lerp(5, 5, 0.9), 5);
});
