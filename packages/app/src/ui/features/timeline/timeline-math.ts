/**
 * Timeline view math — pure functions, no DOM, no engine.
 * Owner: Agent 2 (second team). Unit-testable with plain node.
 *
 * Time is handled in **seconds (float)** at the UI layer because the current
 * UI service boundary (`services.ts`) is seconds-based; the engine contract's
 * canonical unit is integer ticks and the bridge adapter converts once at the
 * boundary (see PROJECT_CONTRACT → "Contract review notes (Agent 2)" #2).
 * All *commits* to the engine go through `roundToFrame` first so the engine
 * receives frame-aligned values regardless of float drift.
 */

export interface FrameRate {
  n: number;
  d: number;
}

export const DEFAULT_FPS: FrameRate = { n: 30, d: 1 };

export function fpsToNumber(fps: FrameRate): number {
  return fps.n / fps.d;
}

/** Frame duration in seconds (e.g. 30000/1001 → 0.0333667). */
export function frameDurationSec(fps: FrameRate): number {
  return fps.d / fps.n;
}

/** Round a time to the nearest frame boundary (half away from zero). */
export function roundToFrame(sec: number, fps: FrameRate): number {
  const fd = frameDurationSec(fps);
  if (sec === 0) return 0;
  return Math.round(sec / fd) * fd;
}

/** Floor to frame boundary — used for ruler ticks (never display-only labels). */
export function floorToFrame(sec: number, fps: FrameRate): number {
  const fd = frameDurationSec(fps);
  if (sec === 0) return 0;
  return Math.floor(sec / fd + 1e-9) * fd;
}

/** Clamp helper used by drags and trims. */
export function clamp(value: number, min: number, max: number): number {
  if (max < min) return min;
  return value < min ? min : value > max ? max : value;
}

/* ------------------------------------------------------------------ *
 * Timecode / ruler labels (derived display — contract §4)
 * ------------------------------------------------------------------ */

function pad(n: number, width = 2): string {
  const s = Math.abs(Math.trunc(n)).toString().padStart(width, "0");
  return s;
}

/**
 * HH:MM:SS:FF timecode at the given rate. Negative/NaN guards keep the UI
 * from ever rendering "NaN:NaN".
 */
export function formatTimecode(sec: number, fps: FrameRate = DEFAULT_FPS): string {
  if (!Number.isFinite(sec) || sec < 0) sec = 0;
  const fd = frameDurationSec(fps);
  const totalFrames = Math.round(sec / fd);
  const fpsInt = Math.round(fpsToNumber(fps));
  const frames = totalFrames % fpsInt;
  const totalSeconds = Math.floor(totalFrames / fpsInt);
  const s = totalSeconds % 60;
  const m = Math.floor(totalSeconds / 60) % 60;
  const h = Math.floor(totalSeconds / 3600);
  return `${pad(h)}:${pad(m)}:${pad(s)}:${pad(frames)}`;
}

/** Compact ruler label: "1:05", "1:05:30" — shortest unambiguous form. */
export function formatRulerLabel(sec: number, stepSec: number): string {
  if (!Number.isFinite(sec) || sec < 0) sec = 0;
  const total = Math.round(sec);
  const s = total % 60;
  const m = Math.floor(total / 60) % 60;
  const h = Math.floor(total / 3600);
  if (h > 0 || stepSec >= 60) return `${h}:${pad(m)}:${pad(s)}`;
  return `${m}:${pad(s)}`;
}

/** Human duration for tooltips: "4.0s", "1m12s". */
export function formatDuration(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) sec = 0;
  if (sec < 60) return `${sec.toFixed(sec < 10 ? 1 : 0)}s`;
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m}m${s.toString().padStart(2, "0")}s`;
}

/* ------------------------------------------------------------------ *
 * Zoom / coordinate mapping
 * ------------------------------------------------------------------ */

export const MIN_ZOOM_PX_PER_SEC = 4;
export const MAX_ZOOM_PX_PER_SEC = 800;
export const DEFAULT_ZOOM_PX_PER_SEC = 80;

export function secToPx(sec: number, pxPerSec: number): number {
  return sec * pxPerSec;
}

export function pxToSec(px: number, pxPerSec: number): number {
  return pxPerSec <= 0 ? 0 : px / pxPerSec;
}

export function clampZoom(pxPerSec: number): number {
  return clamp(pxPerSec, MIN_ZOOM_PX_PER_SEC, MAX_ZOOM_PX_PER_SEC);
}

/** Multiplicative zoom step (wheel / +− keys), anchored at 4≈…≈800. */
export function stepZoom(currentPxPerSec: number, factor: number): number {
  return clampZoom(currentPxPerSec * factor);
}

/**
 * Pick a "nice" major ruler step so labels are ≥ minLabelPx apart at the
 * current zoom, from a human-friendly ladder.
 */
export function rulerStepSec(pxPerSec: number, minLabelPx = 72): number {
  const ladder = [
    1 / 30, 1 / 15, 1 / 5, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1800,
    3600,
  ];
  for (const step of ladder) {
    if (step * pxPerSec >= minLabelPx) return step;
  }
  return ladder[ladder.length - 1];
}

/** Minor tick subdivision of a major step (4 divisions default). */
export function rulerMinorStepSec(majorSec: number): number {
  if (majorSec >= 1) return majorSec / 4;
  return majorSec / 3;
}

/* ------------------------------------------------------------------ *
 * Snapping
 * ------------------------------------------------------------------ */

export interface SnapResult {
  /** Frame-snapped, candidate-snapped start time to commit/preview. */
  start: number;
  /** Candidate time the clip snapped to (null = nothing near). */
  guide: number | null;
}

/**
 * Resolve a proposed clip start against snap candidates.
 *
 * @param proposedStart clip head position (seconds)
 * @param duration      clip length (seconds)
 * @param candidates    other clip edges, playhead, 0, markers…
 * @param thresholdSec  snap radius (usually 8px / pxPerSec)
 * @param fps           frame rate for grid rounding when nothing snaps
 * @param enabled       snapping toggle (N); when false only frame rounding
 *                      is applied so values stay frame-aligned anyway
 *
 * Both the head and tail edge participate: if the *tail* is closer to a
 * candidate, the start is moved so the tail lands on it. When two candidates
 * tie, the head edge wins (predictable while dragging).
 */
export function snapClipStart(params: {
  proposedStart: number;
  duration: number;
  candidates: number[];
  thresholdSec: number;
  fps: FrameRate;
  enabled: boolean;
}): SnapResult {
  const { proposedStart, duration, candidates, thresholdSec, fps, enabled } =
    params;
  let start = Math.max(0, proposedStart);
  if (!enabled) {
    return { start: roundToFrame(start, fps), guide: null };
  }

  let bestDist = thresholdSec;
  let bestStart = start;
  let bestGuide: number | null = null;

  for (const cand of candidates) {
    // head edge → cand
    const headDist = Math.abs(cand - start);
    if (headDist < bestDist) {
      bestDist = headDist;
      bestStart = cand;
      bestGuide = cand;
    }
    // tail edge → cand (start = cand - duration)
    const tailStart = cand - duration;
    if (tailStart >= 0) {
      const tailDist = Math.abs(cand - (start + duration));
      if (tailDist < bestDist) {
        bestDist = tailDist;
        bestStart = tailStart;
        bestGuide = cand;
      }
    }
  }

  if (bestGuide === null) {
    return { start: roundToFrame(start, fps), guide: null };
  }
  return { start: Math.max(0, roundToFrame(bestStart, fps)), guide: bestGuide };
}

/**
 * Snap candidates for a drag: every other clip's head/tail, the playhead,
 * project start, plus markers. Moving clip ids are excluded.
 */
export function collectSnapCandidates(params: {
  clips: Array<{ id: string; start: number; duration: number }>;
  movingIds: Set<string>;
  playheadSec: number;
  markers?: number[];
}): number[] {
  const out: number[] = [0];
  if (Number.isFinite(params.playheadSec) && params.playheadSec > 0) {
    out.push(params.playheadSec);
  }
  for (const c of params.clips) {
    if (params.movingIds.has(c.id)) continue;
    out.push(c.start, c.start + c.duration);
  }
  if (params.markers) out.push(...params.markers.filter((m) => m >= 0));
  return out;
}

/* ------------------------------------------------------------------ *
 * Trim helpers (preview clamping; engine re-validates on commit)
 * ------------------------------------------------------------------ */

/**
 * Clamp a trim for preview: never below MIN_CLIP_SEC, never before the
 * previous neighbour's end, never after the next neighbour's start.
 * Returns the *new duration and start* for head trims, duration for tail.
 */
export const MIN_CLIP_SEC = 0.05;

export function previewTrim(params: {
  start: number;
  duration: number;
  deltaSec: number; // >0 extends (tail) / shortens-from-head handled by caller
  minStart?: number;
  maxEnd?: number;
}): { start: number; duration: number } {
  const { start, duration, deltaSec } = params;
  const minStart = params.minStart ?? 0;
  const maxEnd = params.maxEnd ?? Number.POSITIVE_INFINITY;
  let newStart = start;
  let newDur = duration + deltaSec;
  if (newDur < MIN_CLIP_SEC) newDur = MIN_CLIP_SEC;
  if (newStart + newDur > maxEnd) newDur = Math.max(MIN_CLIP_SEC, maxEnd - newStart);
  return { start: newStart, duration: newDur };
}

/** Head-trim preview: start and duration both move. */
export function previewHeadTrim(params: {
  start: number;
  duration: number;
  deltaSec: number; // >0 shortens (start moves right)
  minStart?: number;
  maxEnd?: number;
}): { start: number; duration: number } {
  const { start, duration, deltaSec } = params;
  const minStart = params.minStart ?? 0;
  const maxEnd = params.maxEnd ?? Number.POSITIVE_INFINITY;
  const end = start + duration; // head trims keep the tail anchored
  let newStart = start + deltaSec;
  const startMax = Math.min(
    end - MIN_CLIP_SEC,
    Number.isFinite(maxEnd) ? maxEnd - MIN_CLIP_SEC : Number.POSITIVE_INFINITY,
  );
  newStart = clamp(newStart, minStart, startMax);
  const newDur = Math.max(MIN_CLIP_SEC, end - newStart);
  return { start: newStart, duration: newDur };
}
