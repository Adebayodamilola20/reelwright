#!/usr/bin/env node
/**
 * verify-timebase.mjs — independent verification of the tick-timebase claims
 * made in docs/PROJECT_CONTRACT.md §"Time units (normative)".
 *
 * Runs against the REAL engine source (`packages/engine/src/time.ts`) via
 * Node's native TypeScript type-stripping (node >= 23.6). No dependencies.
 *
 * Usage:  node scripts/verify-timebase.mjs        (from repo root)
 * Exit code 0 = every claim verified; 1 = at least one claim FAILED.
 *
 * Created by Agent 1 (second team) as a non-colliding contribution; owned by
 * whoever owns `packages/engine` for fixes if a claim fails.
 */

const timeUrl = new URL('../packages/engine/src/time.ts', import.meta.url);
const T = await import(timeUrl.href);

let passed = 0;
let failed = 0;

function check(label, fn) {
  try {
    fn();
    passed += 1;
    console.log(`  ok   ${label}`);
  } catch (e) {
    failed += 1;
    console.log(`  FAIL ${label}\n       ${e.message}`);
  }
}

function assertEq(actual, expected, what) {
  if (actual !== expected) {
    throw new Error(`${what}: expected ${expected}, got ${actual}`);
  }
}

const { rat, TICKS_PER_SECOND } = T;

console.log('verify-timebase: contract claim checks\n');

// ---------------------------------------------------------------- constant
check('TICKS_PER_SECOND === 70,560,000', () =>
  assertEq(TICKS_PER_SECOND, 70_560_000, 'TPS'));

// ------------------------------------------- integer frame durations (all rates)
const CLAIMED_FRAME_RATES = [
  [24, 1], [25, 1], [30, 1], [50, 1], [60, 1], [120, 1],
  [24000, 1001], [30000, 1001], [60000, 1001], [120000, 1001],
];
for (const [n, d] of CLAIMED_FRAME_RATES) {
  check(`frameDurTicks(${n}/${d}) is an integer`, () => {
    const dur = T.frameDurTicks(rat(n, d));
    if (!Number.isInteger(dur) || dur <= 0) {
      throw new Error(`non-integer frame duration: ${dur}`);
    }
  });
}

// Exact value spot-checks from the contract text.
check('one 30000/1001 frame == 2,354,352 ticks (contract example)', () =>
  assertEq(T.frameDurTicks(rat(30000, 1001)), 2_354_352, 'ticks/frame'));
check('one 24000/1001 frame == 2,942,940 ticks', () =>
  assertEq(T.frameDurTicks(rat(24000, 1001)), 2_942_940, 'ticks/frame'));
check('one 60000/1001 frame == 1,177,176 ticks', () =>
  assertEq(T.frameDurTicks(rat(60000, 1001)), 1_177_176, 'ticks/frame'));

// ------------------------------------------- exact sample divisibility
for (const rate of [44100, 48000, 96000]) {
  check(`sample rate ${rate} Hz divides the tick rate evenly`, () => {
    if (TICKS_PER_SECOND % rate !== 0) {
      throw new Error(`remainder ${TICKS_PER_SECOND % rate}`);
    }
    if (!T.isSampleExact(rate)) throw new Error('isSampleExact() disagrees');
  });
}
check('44100 Hz: 1600 ticks/sample (contract example)', () =>
  assertEq(TICKS_PER_SECOND / 44100, 1600, 'ticks/sample'));
check('48000 Hz: 1470 ticks/sample (contract example)', () =>
  assertEq(TICKS_PER_SECOND / 48000, 1470, 'ticks/sample'));
check('96000 Hz: 735 ticks/sample (contract example)', () =>
  assertEq(TICKS_PER_SECOND / 96000, 735, 'ticks/sample'));

// Sample round-trips at exact rates (large values, no drift).
for (const rate of [44100, 48000, 96000]) {
  check(`samples<->ticks round-trip exact at ${rate} Hz (1 hour)`, () => {
    const samples = rate * 3600;
    const ticks = T.ticksFromSamples(samples, rate);
    assertEq(T.ticksToSamples(ticks, rate), samples, 'round-trip');
    assertEq(ticks, (samples / rate) * TICKS_PER_SECOND, 'exact ticks');
  });
}

// ---------------------------------------------------------------- frame grid
for (const [n, d] of CLAIMED_FRAME_RATES) {
  const fps = rat(n, d);
  const dur = T.frameDurTicks(fps);
  check(`frames<->ticks round-trip exact at ${n}/${d} fps`, () => {
    for (const frames of [0, 1, 29, 30, 2997, 107_892]) {
      const ticks = T.framesToTicks(frames, fps);
      assertEq(T.ticksToFrames(ticks, fps), frames, `round-trip @${frames}`);
      assertEq(ticks % dur, 0, `on grid @${frames}`);
    }
  });
}

// floor/ceil bracketing on and off grid.
check('frameFloor/frameCeil bracket arbitrary ticks (30000/1001)', () => {
  const fps = rat(30000, 1001);
  const dur = T.frameDurTicks(fps);
  const mid = dur * 100 + Math.floor(dur / 3);
  assertEq(T.frameFloor(mid, fps), dur * 100, 'floor');
  assertEq(T.frameCeil(mid, fps), dur * 101, 'ceil');
  assertEq(T.frameFloor(dur * 100, fps), dur * 100, 'floor on grid');
  assertEq(T.frameCeil(dur * 100, fps), dur * 100, 'ceil on grid');
});

// --------------------------------------------------- NTSC timecode sanity
// Classic DF/NDF relationship: exactly 107,892 frames span one hour of
// DROP-frame 29.97 timecode; non-drop display for that frame count is
// 00:59:56:12 (NDF runs ~3s 22f behind real time per hour by design).
check('107,892 frames of 29.97 NDF timecode displays 00:59:56:12', () =>
  assertEq(
    T.formatTimecode(T.framesToTicks(107_892, rat(30000, 1001)), rat(30000, 1001)),
    '00:59:56:12', 'timecode'));
check('timecode parse/format round-trip at 25 fps', () => {
  const fps = rat(25);
  for (const tc of ['00:00:00:00', '00:01:00:00', '01:23:45:12']) {
    assertEq(T.formatTimecode(T.parseTimecode(tc, fps), fps), tc, tc);
  }
});
// KNOWN ENGINE BUG (reported to packages/engine owner in TEAM_STATUS):
// parseTimecode() converts HH:MM:SS:FF → frames with fps.n/fps.d (29.97…)
// instead of the NOMINAL rate (30) that formatTimecode() displays with.
// For NTSC rates the round-trip therefore lands ~2 frames early
// ('00:00:59:29' → ticks → '00:00:59:27'). Proposed fix in parseTimecode():
//   const nominal = Math.round(ratValue(fps));
//   const totalFrames = ((hh * 3600 + mm * 60 + ss) * nominal) + ff;
// Integer rates are unaffected. This check stays red until fixed.
check('timecode parse/format round-trip at 30000/1001 (NTSC)', () => {
  const fps = rat(30000, 1001);
  for (const tc of ['00:00:59:29', '00:10:00:00', '10:00:00:00']) {
    assertEq(T.formatTimecode(T.parseTimecode(tc, fps), fps), tc, tc);
  }
});

// --------------------------------------------------- rational parsing claims
check('ratFromFrameRateFloat(29.97) -> 30000/1001 exactly', () => {
  const r = T.ratFromFrameRateFloat(29.97);
  assertEq(`${r.n}/${r.d}`, '30000/1001', 'parsed rate');
});
check('rat() reduces 60000/1001-style inputs and rejects d<=0', () => {
  const r = T.rat(60000, 2002);
  assertEq(`${r.n}/${r.d}`, '30000/1001', 'reduced');
  let threw = false;
  try { T.rat(30, 0); } catch { threw = true; }
  if (!threw) throw new Error('rat(30,0) did not throw');
});

// --------------------------------------------------- documented safe range
check('safe integer range is ~4 years of project time (contract claim)', () => {
  const seconds = Number.MAX_SAFE_INTEGER / TICKS_PER_SECOND;
  const years = seconds / (365.2425 * 86400);
  if (!(years > 3.9 && years < 4.2)) {
    throw new Error(`computed ${years.toFixed(2)} years, contract says ~4`);
  }
  // And realistic long timelines stay exact:
  const oneYear = TICKS_PER_SECOND * 365.2425 * 86400;
  if (!Number.isSafeInteger(oneYear)) {
    throw new Error('one year of ticks is not a safe integer');
  }
});

// --------------------------------------------------- float-seconds hazards
check('fsec() output parses back within 1 ns (ffmpeg arg boundary)', () => {
  const ticks = T.framesToTicks(12345, rat(30000, 1001));
  const back = Math.round(Number(T.fsec(ticks)) * TICKS_PER_SECOND);
  if (Math.abs(back - ticks) > 1) {
    throw new Error(`drift of ${back - ticks} ticks`);
  }
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
