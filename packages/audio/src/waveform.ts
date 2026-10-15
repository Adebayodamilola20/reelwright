/**
 * Waveform peaks: min/max pairs per bucket, computed by decoding the asset to
 * mono s16le PCM via local ffmpeg and downsampling in Node.
 *
 * Pipeline (Designed, verified by tests against ffmpeg-generated fixtures):
 *   ffprobe (duration) → ffmpeg -ac 1 -ar <decodeRate> -f s16le - → stream
 *   samples into `buckets` min/max pairs.
 *
 * A JSON sidecar caches the peaks next to the app's cache dir so the UI can
 * read a completed waveform without re-decoding; the sidecar is fingerprinted
 * on the source file's size+mtime and the bucket count, so edits to the source
 * invalidate it automatically.
 */

import { createHash } from 'node:crypto';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { AudioError } from './errors.js';
import { DEFAULT_FFMPEG, probeDurationSec, runFfmpeg } from './ffmpeg.js';

/** Default PCM decode rate for peak computation (samples/sec, mono). */
export const DEFAULT_WAVEFORM_DECODE_RATE = 8000;

export interface WaveformRequest {
  /** Number of min/max buckets to produce (≥ 1). UI typically uses 500–2000. */
  buckets: number;
  /** ffmpeg binary override (default $FFMPEG or "ffmpeg"). */
  ffmpegPath?: string;
  /** PCM decode rate; lower = faster/smaller, default 8000. */
  decodeRate?: number;
}

export interface WaveformPeaks {
  buckets: number;
  /** Decode rate the peaks were computed at (samples/sec, mono). */
  decodeRate: number;
  /** Duration of the decoded audio in seconds (from ffprobe). */
  durationSec: number;
  /** Per-bucket minimum sample, int16 range (−32768..32767). */
  min: number[];
  /** Per-bucket maximum sample, int16 range (−32768..32767). */
  max: number[];
}

/** Sidecar JSON schema (versioned; readers must reject unknown versions). */
export interface WaveformSidecar {
  version: 1;
  kind: 'waveform-peaks';
  source: { path: string; sizeBytes: number; modifiedMs: number };
  peaks: WaveformPeaks;
}

function validateRequest(req: WaveformRequest): { decodeRate: number } {
  if (!Number.isInteger(req.buckets) || req.buckets < 1 || req.buckets > 100_000) {
    throw new AudioError('INVALID_ARGUMENT', `buckets must be an integer in [1, 100000], got ${req.buckets}`);
  }
  const decodeRate = req.decodeRate ?? DEFAULT_WAVEFORM_DECODE_RATE;
  if (!Number.isInteger(decodeRate) || decodeRate < 100 || decodeRate > 192_000) {
    throw new AudioError('INVALID_ARGUMENT', `decodeRate must be an integer in [100, 192000], got ${decodeRate}`);
  }
  return { decodeRate };
}

/**
 * Compute min/max waveform peaks for an audio (or audio-bearing video) file.
 * Throws AudioError: INVALID_ARGUMENT (bad request), FFMPEG_FAILED (no audio
 * stream / decode error), FFMPEG_NOT_FOUND.
 */
export async function computeWaveform(assetPath: string, req: WaveformRequest): Promise<WaveformPeaks> {
  const { decodeRate } = validateRequest(req);
  const ffmpeg = req.ffmpegPath ?? DEFAULT_FFMPEG;
  const durationSec = await probeDurationSec(assetPath);
  const estimatedTotal = Math.max(1, Math.round(durationSec * decodeRate));

  const min = new Array<number>(req.buckets).fill(0);
  const max = new Array<number>(req.buckets).fill(0);

  let sampleIndex = 0;

  const consumeSample = (value: number): void => {
    // Clamp into bucket from estimated length; a decoded stream slightly
    // longer than the estimate (e.g. MP3 padding) folds into the last bucket.
    const b = Math.min(req.buckets - 1, Math.floor((sampleIndex * req.buckets) / estimatedTotal));
    if (value < min[b]) min[b] = value;
    if (value > max[b]) max[b] = value;
    sampleIndex += 1;
  };

  // s16le samples are 2 bytes; stream chunks can split one across boundaries,
  // so hold a one-byte carry between chunks.
  let carryHigh: number | null = null;

  const { code, stderr } = await runFfmpeg(
    ['-i', assetPath, '-map', 'a:0', '-ac', '1', '-ar', String(decodeRate), '-f', 's16le', '-'],
    {
      bin: ffmpeg,
      onStdout: (chunk: Buffer) => {
        let i = 0;
        if (carryHigh !== null && chunk.length > 0) {
          consumeSample((carryHigh | (chunk[0] << 8)) << 16 >> 16);
          carryHigh = null;
          i = 1;
        }
        for (; i + 1 < chunk.length; i += 2) {
          consumeSample(chunk.readInt16LE(i));
        }
        if ((chunk.length - i) === 1) {
          carryHigh = chunk[i];
        }
      },
    },
  );

  if (code !== 0) {
    const noAudio = /Stream #.*Audio|does not contain any stream|matches no streams/i.test(stderr);
    throw new AudioError(
      'FFMPEG_FAILED',
      `Could not decode audio from ${assetPath}: ffmpeg exit ${code}${noAudio ? ' (no audio stream?)' : ''}`,
      {
        hint: noAudio
          ? 'This file has no audio stream; only video/audio assets have waveforms.'
          : 'See details.stderr for the ffmpeg error output.',
        details: { exitCode: code, stderr: stderr.slice(-4000) },
      },
    );
  }

  return { buckets: req.buckets, decodeRate, durationSec, min, max };
}

/** Deterministic sidecar filename for an asset + request (content-addressed on path). */
export function waveformSidecarName(assetPath: string, req: Pick<WaveformRequest, 'buckets' | 'decodeRate'>): string {
  const decodeRate = req.decodeRate ?? DEFAULT_WAVEFORM_DECODE_RATE;
  const hash = createHash('sha256').update(path.resolve(assetPath)).digest('hex').slice(0, 16);
  return `waveform-${hash}-${req.buckets}b-${decodeRate}hz.json`;
}

interface Fingerprint {
  sizeBytes: number;
  modifiedMs: number;
}

async function fingerprintOf(assetPath: string): Promise<Fingerprint> {
  const st = await stat(assetPath);
  return { sizeBytes: st.size, modifiedMs: st.mtimeMs };
}

/** Read + validate a sidecar; returns null when missing, corrupt, or stale version. */
export async function readWaveformSidecar(sidecarPath: string): Promise<WaveformSidecar | null> {
  let raw: string;
  try {
    raw = await readFile(sidecarPath, 'utf8');
  } catch {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as WaveformSidecar;
    if (parsed?.version !== 1 || parsed.kind !== 'waveform-peaks') return null;
    if (!Array.isArray(parsed.peaks?.min) || !Array.isArray(parsed.peaks?.max)) return null;
    if (parsed.peaks.min.length !== parsed.peaks.buckets || parsed.peaks.max.length !== parsed.peaks.buckets) return null;
    return parsed;
  } catch {
    return null;
  }
}

async function writeWaveformSidecar(
  sidecarPath: string,
  assetPath: string,
  peaks: WaveformPeaks,
  fingerprint: Fingerprint,
): Promise<void> {
  const sidecar: WaveformSidecar = {
    version: 1,
    kind: 'waveform-peaks',
    source: { path: path.resolve(assetPath), ...fingerprint },
    peaks,
  };
  await mkdir(path.dirname(sidecarPath), { recursive: true });
  const tmp = `${sidecarPath}.tmp-${process.pid}`;
  await writeFile(tmp, JSON.stringify(sidecar), 'utf8');
  const { rename } = await import('node:fs/promises');
  await rename(tmp, sidecarPath); // atomic, same dir
}

export interface CachedWaveformResult {
  peaks: WaveformPeaks;
  sidecarPath: string;
  cacheHit: boolean;
}

/**
 * Waveform with JSON-sidecar caching. On a cache miss (no sidecar, stale
 * fingerprint, or different bucket count) the peaks are recomputed and the
 * sidecar written atomically.
 */
export async function waveformCached(
  assetPath: string,
  cacheDir: string,
  req: WaveformRequest,
): Promise<CachedWaveformResult> {
  const { decodeRate } = validateRequest(req);
  const sidecarPath = path.join(cacheDir, waveformSidecarName(assetPath, { buckets: req.buckets, decodeRate }));
  const fingerprint = await fingerprintOf(assetPath).catch((err: Error) => {
    throw new AudioError('IO_ERROR', `Cannot stat ${assetPath}: ${err.message}`, {
      hint: 'The asset file is missing or unreadable; relink it in the media bin.',
    });
  });

  const existing = await readWaveformSidecar(sidecarPath);
  if (
    existing &&
    existing.source.sizeBytes === fingerprint.sizeBytes &&
    existing.source.modifiedMs === fingerprint.modifiedMs &&
    existing.peaks.buckets === req.buckets &&
    existing.peaks.decodeRate === decodeRate
  ) {
    return { peaks: existing.peaks, sidecarPath, cacheHit: true };
  }

  const peaks = await computeWaveform(assetPath, req);
  await writeWaveformSidecar(sidecarPath, assetPath, peaks, fingerprint);
  return { peaks, sidecarPath, cacheHit: false };
}
