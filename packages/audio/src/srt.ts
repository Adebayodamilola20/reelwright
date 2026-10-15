/**
 * Sidecar SRT (SubRip) export built from the project's structured text clips.
 *
 * This is the honest alternative to capability-gated text burn-in: this
 * ffmpeg build has no libfreetype (no drawtext/subtitles/ass), so captions
 * cannot be burned into the exported video here — but they ARE structured
 * timeline data (contract: text clips with start/duration/text), so we can
 * always export a standards-compliant .srt sidecar players load alongside the
 * video. See docs/PROJECT_CONTRACT.md "Export contract" and README honesty
 * table.
 *
 * SRT timing granularity is milliseconds; contract ticks convert with
 * round-to-nearest (error < 0.5 ms — documented boundary).
 */

import { writeFile } from 'node:fs/promises';
import { AudioError } from './errors.js';
import { TICKS_PER_SECOND, type Ticks } from './time.js';

export interface SrtCue {
  startTicks: Ticks;
  endTicks: Ticks;
  /** Plain text; newlines become separate cue lines. */
  text: string;
}

export interface SrtOptions {
  /** Extend short cues to this length (ms). 0 (default) = never alter timing. */
  minDurationMs?: number;
  /** 'keep' (default) renders overlaps as-is; 'clamp' trims the earlier cue to the next start. */
  overlapPolicy?: 'keep' | 'clamp';
  /** Wrap text greedily to this many characters per line (default 42; 0 = no wrapping). */
  maxCharsPerLine?: number;
  /** Split cues whose wrapped text exceeds this many lines into sequential cues (default 0 = off). */
  splitLongCues?: number;
}

/** Ticks → SRT timestamp `HH:MM:SS,mmm` (hours ≥ 0, unbounded width). */
export function formatSrtTimestamp(ticks: Ticks): string {
  if (!Number.isFinite(ticks) || ticks < 0) {
    throw new AudioError('INVALID_ARGUMENT', `SRT timestamps must be finite ticks ≥ 0, got ${ticks}`);
  }
  const ms = Math.round((ticks * 1000) / TICKS_PER_SECOND);
  const msPart = String(ms % 1000).padStart(3, '0');
  const totalSec = Math.floor(ms / 1000);
  const s = String(totalSec % 60).padStart(2, '0');
  const m = String(Math.floor(totalSec / 60) % 60).padStart(2, '0');
  const h = String(Math.floor(totalSec / 3600)).padStart(2, '0');
  return `${h}:${m}:${s},${msPart}`;
}

/** Normalize cue text: strip CR, trim lines, collapse runs of blank lines. */
function normalizeText(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Greedy word wrap to `maxChars` per line. Long words are kept intact. */
export function wrapText(text: string, maxChars: number): string {
  const paragraphs = normalizeText(text).split('\n');
  const out: string[] = [];
  for (const para of paragraphs) {
    if (para === '') {
      out.push('');
      continue;
    }
    if (maxChars <= 0) {
      out.push(para);
      continue;
    }
    let line = '';
    for (const word of para.split(/\s+/)) {
      if (line === '') {
        line = word;
      } else if (line.length + 1 + word.length <= maxChars) {
        line += ` ${word}`;
      } else {
        out.push(line);
        line = word;
      }
    }
    if (line !== '') out.push(line);
  }
  return out.join('\n');
}

export interface CueWarning {
  message: string;
  cueIndex?: number;
}

/**
 * Derive SRT cues from text-bearing timeline clips (contract `Clip` shape:
 * `start`, `duration`, optional `text: TextContent`, `enabled`; text clips may
 * also resolve text from their asset — pass `resolveText` for that case).
 * Non-text clips, disabled clips, empty text, and non-positive durations are
 * skipped with warnings — nothing is silently dropped.
 */
export function cuesFromClips(
  clips: ReadonlyArray<{
    id?: string;
    start: Ticks;
    duration: Ticks;
    enabled?: boolean;
    text?: { text: string } | string;
  }>,
  opts: { resolveText?: (clip: { id?: string }) => string | null | undefined } = {},
): { cues: SrtCue[]; warnings: CueWarning[] } {
  const cues: SrtCue[] = [];
  const warnings: CueWarning[] = [];
  clips.forEach((clip, i) => {
    const resolved =
      typeof clip.text === 'string' ? clip.text : clip.text?.text ?? opts.resolveText?.(clip) ?? null;
    if (resolved === null || resolved === undefined) return; // not a text clip
    if (clip.enabled === false) {
      warnings.push({ message: `clip ${clip.id ?? i} is disabled — excluded`, cueIndex: i });
      return;
    }
    if (!Number.isFinite(clip.duration) || clip.duration <= 0) {
      warnings.push({ message: `clip ${clip.id ?? i} has non-positive duration — excluded`, cueIndex: i });
      return;
    }
    const text = normalizeText(typeof resolved === 'string' ? resolved : '');
    if (text === '') {
      warnings.push({ message: `clip ${clip.id ?? i} has empty text — excluded`, cueIndex: i });
      return;
    }
    cues.push({ startTicks: clip.start, endTicks: clip.start + clip.duration, text });
  });
  return { cues, warnings };
}

/**
 * Derive cues from a project-shaped object (tracks → clips), honoring the
 * contract's track flags: clips on `hidden` video tracks are excluded (hidden
 * = excluded from render). `muted` does NOT exclude captions.
 */
export function cuesFromProject(
  project: {
    tracks: ReadonlyArray<{
      kind: string;
      hidden?: boolean;
      clips: ReadonlyArray<{
        id?: string;
        start: Ticks;
        duration: Ticks;
        enabled?: boolean;
        text?: { text: string } | string;
      }>;
    }>;
  },
  opts: { resolveText?: (clip: { id?: string }) => string | null | undefined } = {},
): { cues: SrtCue[]; warnings: CueWarning[] } {
  const clips: Array<{
    id?: string;
    start: Ticks;
    duration: Ticks;
    enabled?: boolean;
    text?: { text: string } | string;
  }> = [];
  const warnings: CueWarning[] = [];
  for (const track of project.tracks) {
    if (track.hidden === true) {
      for (const clip of track.clips) {
        const hasText =
          (typeof clip.text === 'string' && clip.text !== '') ||
          (typeof clip.text === 'object' && clip.text !== null) ||
          opts.resolveText?.(clip) != null;
        if (hasText) warnings.push({ message: `clip ${clip.id ?? '?'} is on a hidden track — excluded` });
      }
      continue;
    }
    clips.push(...track.clips);
  }
  const result = cuesFromClips(clips, opts);
  return { cues: result.cues, warnings: [...warnings, ...result.warnings] };
}

/** Split a cue's text into chunks of at most `maxLines * maxChars` chars, timing allocated proportionally by character weight. */
function splitCue(cue: SrtCue, maxLines: number, maxChars: number): SrtCue[] {
  const lines = wrapText(cue.text, maxChars).split('\n');
  if (lines.length <= maxLines || maxLines <= 0 || maxChars <= 0) return [cue];
  const chunks: string[] = [];
  for (let i = 0; i < lines.length; i += maxLines) {
    chunks.push(lines.slice(i, i + maxLines).join('\n'));
  }
  const totalChars = chunks.reduce((sum, c) => sum + Math.max(1, c.replace(/\s/g, '').length), 0);
  const span = cue.endTicks - cue.startTicks;
  const out: SrtCue[] = [];
  let cursor = cue.startTicks;
  chunks.forEach((chunk, i) => {
    const weight = Math.max(1, chunk.replace(/\s/g, '').length) / totalChars;
    const end = i === chunks.length - 1 ? cue.endTicks : cursor + Math.round(span * weight);
    out.push({ startTicks: cursor, endTicks: Math.max(cursor + 1, end), text: chunk });
    cursor = end;
  });
  return out;
}

/**
 * Build a SubRip document from cues. Deterministic pipeline:
 * drop empty-text cues → enforce minDurationMs → overlap clamp (optional) →
 * split long cues (optional) → render.
 */
export function buildSrt(cues: ReadonlyArray<SrtCue>, opts: SrtOptions = {}): string {
  const minDurationMs = opts.minDurationMs ?? 0;
  const overlapPolicy = opts.overlapPolicy ?? 'keep';
  const maxCharsPerLine = opts.maxCharsPerLine ?? 42;
  const splitLongCues = opts.splitLongCues ?? 0;

  if (!Number.isFinite(minDurationMs) || minDurationMs < 0) {
    throw new AudioError('INVALID_ARGUMENT', `minDurationMs must be ≥ 0, got ${minDurationMs}`);
  }

  // Stable sort by (start, end, original order).
  const sorted = cues
    .map((cue, i) => ({ cue, i }))
    .sort((a, b) => a.cue.startTicks - b.cue.startTicks || a.cue.endTicks - b.cue.endTicks || a.i - b.i)
    .map(({ cue }) => ({ ...cue, text: normalizeText(cue.text) }))
    .filter((cue) => cue.text !== '');

  // Enforce minimum duration (extend end; never touches cues with end ≤ start which are dropped).
  if (minDurationMs > 0) {
    const minTicks = Math.round((minDurationMs * TICKS_PER_SECOND) / 1000);
    for (const cue of sorted) {
      if (cue.endTicks - cue.startTicks < minTicks) cue.endTicks = cue.startTicks + minTicks;
    }
  }

  // Overlap clamp: trim earlier cue's end to the next cue's start.
  if (overlapPolicy === 'clamp') {
    for (let i = 0; i + 1 < sorted.length; i++) {
      if (sorted[i].endTicks > sorted[i + 1].startTicks) {
        sorted[i].endTicks = Math.max(sorted[i].startTicks, sorted[i + 1].startTicks);
      }
    }
  }

  // Drop degenerate cues (end ≤ start) — SRT requires a positive duration.
  const valid = sorted.filter((cue) => cue.endTicks > cue.startTicks);

  const finalCues = splitLongCues > 0
    ? valid.flatMap((cue) => splitCue(cue, splitLongCues, maxCharsPerLine))
    : valid;

  const parts: string[] = [];
  finalCues.forEach((cue, i) => {
    const body = maxCharsPerLine > 0 ? wrapText(cue.text, maxCharsPerLine) : cue.text;
    parts.push(
      `${i + 1}\n${formatSrtTimestamp(cue.startTicks)} --> ${formatSrtTimestamp(cue.endTicks)}\n${body}\n`,
    );
  });
  return parts.join('\n');
}

/** Convenience: cues + options → .srt file written atomically. Returns cue count. */
export async function writeSrtFile(
  outPath: string,
  cues: ReadonlyArray<SrtCue>,
  opts: SrtOptions = {},
): Promise<{ cueCount: number; bytes: number }> {
  const srt = buildSrt(cues, opts);
  const tmp = `${outPath}.tmp-${process.pid}`;
  await writeFile(tmp, srt, 'utf8');
  const { rename } = await import('node:fs/promises');
  await rename(tmp, outPath);
  const cueCount = srt === '' ? 0 : srt.trimEnd().split(/\n\n+/).length;
  return { cueCount, bytes: Buffer.byteLength(srt, 'utf8') };
}
