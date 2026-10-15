/**
 * Exact time utilities — the normative time model of the editor.
 *
 * Canonical unit: integer TICKS where TICKS_PER_SECOND = 70,560,000.
 * The rate was chosen so that common frame rates (24/25/30/50/60/120 and
 * NTSC 24000/1001, 30000/1001, 60000/1001) and audio sample rates
 * (44100, 48000, 96000) divide it evenly — see docs/PROJECT_CONTRACT.md.
 */

export const TICKS_PER_SECOND = 70_560_000;

/** Integer count of ticks (1/70,560,000 s each). */
export type Ticks = number;

/** Exact rational number n/d, d > 0. Used for frame rates and speed. */
export interface Rational {
  readonly n: number;
  readonly d: number;
}

function gcd(a: number, b: number): number {
  a = Math.abs(a);
  b = Math.abs(b);
  while (b !== 0) {
    const t = b;
    b = a % b;
    a = t;
  }
  return a;
}

/** Build a reduced Rational; throws on invalid input. */
export function rat(n: number, d = 1): Rational {
  if (!Number.isInteger(n) || !Number.isInteger(d) || d <= 0) {
    throw new RangeError(`rat(): expected integers with d > 0, got ${n}/${d}`);
  }
  const g = gcd(n, d) || 1;
  return { n: n / g, d: d / g };
}

/** Common frame rates, used to parse user-facing values like 29.97 exactly. */
const KNOWN_RATES: Rational[] = [
  rat(24000, 1001), rat(30000, 1001), rat(60000, 1001),
  rat(120000, 1001),
  rat(24), rat(25), rat(30), rat(50), rat(60), rat(120), rat(15), rat(10),
];

/**
 * Parse a frame rate given as a float (e.g. 29.97) into an exact Rational.
 * Falls back to integer rounding when no known rate is within tolerance.
 */
export function ratFromFrameRateFloat(v: number, tolerance = 0.01): Rational {
  if (!Number.isFinite(v) || v <= 0) throw new RangeError(`ratFromFrameRateFloat(): invalid rate ${v}`);
  let best: Rational | null = null;
  let bestDiff = Infinity;
  for (const r of KNOWN_RATES) {
    const diff = Math.abs(r.n / r.d - v);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = r;
    }
  }
  if (best && bestDiff <= tolerance) return best;
  return rat(Math.round(v));
}

export function ratValue(r: Rational): number {
  return r.n / r.d;
}

export function ratEquals(a: Rational, b: Rational): boolean {
  return a.n * b.d === b.n * a.d;
}

export function ratToString(r: Rational): string {
  return `${r.n}/${r.d}`;
}

export function secFromTicks(t: Ticks): number {
  return t / TICKS_PER_SECOND;
}

export function ticksFromSec(s: number): Ticks {
  return Math.round(s * TICKS_PER_SECOND);
}

/**
 * Seconds formatted for ffmpeg arguments with sub-microsecond precision.
 * (ffmpeg parses fractional seconds as doubles; 1e-9 s resolution is ample.)
 */
export function fsec(t: Ticks): string {
  return (t / TICKS_PER_SECOND).toFixed(9);
}

/** Ticks for one frame at the given rate (integer for all supported rates). */
export function frameDurTicks(fps: Rational): number {
  return (fps.d * TICKS_PER_SECOND) / fps.n;
}

function ticksPerFrameExact(fps: Rational): number {
  return (fps.d * TICKS_PER_SECOND) / fps.n;
}

/** Convert ticks to a fractional frame index. */
export function ticksToFrameIndex(t: Ticks, fps: Rational): number {
  return (t * fps.n) / (fps.d * TICKS_PER_SECOND);
}

/** Frame count (rounded) for a tick span. */
export function ticksToFrames(t: Ticks, fps: Rational): number {
  return Math.round(ticksToFrameIndex(t, fps));
}

/** Ticks at an exact frame boundary. */
export function framesToTicks(frames: number, fps: Rational): Ticks {
  return Math.round(frames * ticksPerFrameExact(fps));
}

/** Largest frame-boundary tick ≤ t. */
export function frameFloor(t: Ticks, fps: Rational): Ticks {
  return framesToTicks(Math.floor(ticksToFrameIndex(t, fps) + 1e-9), fps);
}

/** Smallest frame-boundary tick ≥ t. */
export function frameCeil(t: Ticks, fps: Rational): Ticks {
  return framesToTicks(Math.ceil(ticksToFrameIndex(t, fps) - 1e-9), fps);
}

/** Sample index for a tick position (rounded; exact for 44100/48000/96000 Hz). */
export function ticksToSamples(t: Ticks, sampleRate: number): number {
  return Math.round((t * sampleRate) / TICKS_PER_SECOND);
}

/** Ticks for a sample index (exact for 44100/48000/96000 Hz). */
export function ticksFromSamples(samples: number, sampleRate: number): Ticks {
  return Math.round((samples * TICKS_PER_SECOND) / sampleRate);
}

/** True when one sample lands on an exact tick boundary at this rate. */
export function isSampleExact(sampleRate: number): boolean {
  return (TICKS_PER_SECOND % sampleRate) === 0;
}

/**
 * Non-drop-frame timecode HH:MM:SS:FF. Frame index is computed against the
 * nominal integer/nominalized rate (e.g. 30000/1001 displays as 29.97 "30").
 */
export function formatTimecode(t: Ticks, fps: Rational): string {
  const frameIdx = Math.max(0, Math.floor(ticksToFrameIndex(t, fps)));
  const nominal = Math.round(ratValue(fps));
  const ff = frameIdx % nominal;
  const totalSec = Math.floor(frameIdx / nominal);
  const ss = totalSec % 60;
  const mm = Math.floor(totalSec / 60) % 60;
  const hh = Math.floor(totalSec / 3600);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(hh)}:${p(mm)}:${p(ss)}:${p(ff)}`;
}

/** Parse "HH:MM:SS:FF" (or "MM:SS:FF" / "SS:FF") into ticks. */
export function parseTimecode(tc: string, fps: Rational): Ticks {
  const parts = tc.split(':').map((s) => s.trim());
  if (parts.length < 1 || parts.length > 4) {
    throw new RangeError(`parseTimecode(): bad timecode "${tc}"`);
  }
  const nums = parts.map((s) => {
    const n = Number(s);
    if (!Number.isInteger(n) || n < 0) throw new RangeError(`parseTimecode(): bad segment "${s}"`);
    return n;
  });
  while (nums.length < 4) nums.unshift(0);
  const [hh, mm, ss, ff] = nums;
  // NTSC rates (e.g. 30000/1001) must convert using the NOMINAL rate that
  // formatTimecode() displays with (30), not the exact rational — otherwise
  // round-trips drift (parse('...:29') formatted back as '...:27').
  const nominal = Math.round(ratValue(fps));
  if (ff >= nominal) {
    throw new RangeError(
      `parseTimecode(): frame "${ff}" out of range for ${nominal}-fps timecode`,
    );
  }
  const totalFrames = (hh * 3600 + mm * 60 + ss) * nominal + ff;
  return framesToTicks(totalFrames, fps);
}
