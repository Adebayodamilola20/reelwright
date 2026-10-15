/**
 * Local ffmpeg interaction: resolution, version, capability probing, and a
 * minimal process runner.
 *
 * Capability probing is the backbone of the honest-gating rule (charter): we
 * never assume a filter/encoder exists — we probe `-filters`/`-encoders` at
 * runtime and gate features with a real reason when absent. Probes are cached
 * per ffmpeg binary path for the process lifetime.
 */

import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { AudioError } from './errors.js';

const execFileP = promisify(execFile);

/** Default ffmpeg binary; overridable per call or via $FFMPEG. */
export const DEFAULT_FFMPEG = process.env['FFMPEG'] ?? 'ffmpeg';
export const DEFAULT_FFPROBE = process.env['FFPROBE'] ?? 'ffprobe';

export async function runVersion(bin: string): Promise<string> {
  try {
    const { stdout } = await execFileP(bin, ['-hide_banner', '-version'], { maxBuffer: 1 << 20 });
    const first = stdout.split('\n', 1)[0]?.trim() ?? '';
    return first || 'unknown';
  } catch (err) {
    throw new AudioError('FFMPEG_NOT_FOUND', `Could not run ${bin} -version`, {
      hint: 'Install ffmpeg or set $FFMPEG to its absolute path.',
      details: (err as Error).message,
    });
  }
}

/** Parse the name column of `ffmpeg -filters` / `-encoders` output. */
function parseNameColumn(output: string): Set<string> {
  const names = new Set<string>();
  for (const line of output.split('\n')) {
    // Filter lines look like:  " TS afftdn   A->A   Denoise audio samples using FFT."
    // Encoder lines look like: " A....D aac   AAC (Advanced Audio Coding) (codec aac)"
    const match = /^\s{1,2}[A-Z.]{1,7}\s+(\S+)/.exec(line);
    if (match) names.add(match[1]);
  }
  return names;
}

const filtersCache = new Map<string, Set<string>>();
const encodersCache = new Map<string, Set<string>>();

/** Names of every filter this ffmpeg build supports (cached per binary). */
export async function probeFilters(bin: string = DEFAULT_FFMPEG): Promise<Set<string>> {
  const cached = filtersCache.get(bin);
  if (cached) return cached;
  let out: string;
  try {
    ({ stdout: out } = await execFileP(bin, ['-hide_banner', '-filters'], { maxBuffer: 8 << 20 }));
  } catch (err) {
    throw new AudioError('FFMPEG_NOT_FOUND', `Could not run ${bin} -filters`, {
      hint: 'Install ffmpeg or set $FFMPEG to its absolute path.',
      details: (err as Error).message,
    });
  }
  const names = parseNameColumn(out);
  filtersCache.set(bin, names);
  return names;
}

/** Names of every encoder this ffmpeg build supports (cached per binary). */
export async function probeEncoders(bin: string = DEFAULT_FFMPEG): Promise<Set<string>> {
  const cached = encodersCache.get(bin);
  if (cached) return cached;
  let out: string;
  try {
    ({ stdout: out } = await execFileP(bin, ['-hide_banner', '-encoders'], { maxBuffer: 8 << 20 }));
  } catch (err) {
    throw new AudioError('FFMPEG_NOT_FOUND', `Could not run ${bin} -encoders`, {
      hint: 'Install ffmpeg or set $FFMPEG to its absolute path.',
      details: (err as Error).message,
    });
  }
  const names = parseNameColumn(out);
  encodersCache.set(bin, names);
  return names;
}

/** Audio-relevant capability snapshot for UI honest-gating. */
export interface AudioCapabilities {
  ffmpegPath: string;
  ffmpegVersion: string;
  filters: {
    volume: boolean;
    afade: boolean;
    atrim: boolean;
    amix: boolean;
    highpass: boolean;
    lowpass: boolean;
    bandreject: boolean;
    afftdn: boolean;
    anlmdn: boolean;
    adeclip: boolean;
  };
  encoders: { aac: boolean; libmp3lame: boolean; pcm_s16le: boolean };
}

export async function audioCapabilities(bin: string = DEFAULT_FFMPEG): Promise<AudioCapabilities> {
  const [version, filters, encoders] = await Promise.all([
    runVersion(bin),
    probeFilters(bin),
    probeEncoders(bin),
  ]);
  return {
    ffmpegPath: bin,
    ffmpegVersion: version,
    filters: {
      volume: filters.has('volume'),
      afade: filters.has('afade'),
      atrim: filters.has('atrim'),
      amix: filters.has('amix'),
      highpass: filters.has('highpass'),
      lowpass: filters.has('lowpass'),
      bandreject: filters.has('bandreject'),
      afftdn: filters.has('afftdn'),
      anlmdn: filters.has('anlmdn'),
      adeclip: filters.has('adeclip'),
    },
    encoders: {
      aac: encoders.has('aac'),
      libmp3lame: encoders.has('libmp3lame'),
      pcm_s16le: encoders.has('pcm_s16le'),
    },
  };
}

export interface FfmpegRunResult {
  code: number;
  stderr: string;
}

/**
 * Run ffmpeg with `args`, resolving with exit code + stderr.
 * Non-zero exits resolve (not reject) so callers can inspect stderr; only a
 * spawn failure (binary missing) rejects with FFMPEG_NOT_FOUND.
 */
export function runFfmpeg(
  args: string[],
  opts: { bin?: string; signal?: AbortSignal; onStdout?: (chunk: Buffer) => void } = {},
): Promise<FfmpegRunResult> {
  const bin = opts.bin ?? DEFAULT_FFMPEG;
  return new Promise((resolve, reject) => {
    const child = spawn(bin, ['-hide_banner', '-v', 'error', ...args], { signal: opts.signal });
    let stderr = '';
    child.stderr.on('data', (d: Buffer) => {
      stderr += d.toString('utf8');
    });
    if (opts.onStdout) {
      child.stdout.on('data', opts.onStdout);
    } else {
      child.stdout.resume();
    }
    child.on('error', (err: NodeJS.ErrnoException) => {
      reject(
        new AudioError('FFMPEG_NOT_FOUND', `Could not run ${bin}`, {
          hint: 'Install ffmpeg or set $FFMPEG to its absolute path.',
          details: err.message,
        }),
      );
    });
    child.on('close', (code) => resolve({ code: code ?? -1, stderr }));
  });
}

/** Run ffmpeg and throw FFMPEG_FAILED with the stderr tail on non-zero exit. */
export async function runFfmpegOrThrow(
  args: string[],
  opts: { bin?: string; signal?: AbortSignal; onStdout?: (chunk: Buffer) => void; what?: string } = {},
): Promise<void> {
  const { code, stderr } = await runFfmpeg(args, opts);
  if (code !== 0) {
    throw new AudioError('FFMPEG_FAILED', `ffmpeg failed${opts.what ? ` (${opts.what})` : ''}: exit ${code}`, {
      hint: 'See details.stderr for the ffmpeg error output.',
      details: { exitCode: code, stderr: stderr.slice(-4000) },
    });
  }
}

/** Probe an asset's audio duration in seconds via ffprobe (format-level). */
export async function probeDurationSec(path: string, ffprobeBin: string = DEFAULT_FFPROBE): Promise<number> {
  let stdout: string;
  try {
    ({ stdout } = await execFileP(
      ffprobeBin,
      ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', path],
      { maxBuffer: 1 << 20 },
    ));
  } catch (err) {
    throw new AudioError('FFMPEG_FAILED', `ffprobe failed on ${path}`, {
      hint: 'Is ffprobe installed alongside ffmpeg?',
      details: (err as Error).message,
    });
  }
  const sec = Number.parseFloat(stdout.trim());
  if (!Number.isFinite(sec) || sec < 0) {
    throw new AudioError('FFMPEG_FAILED', `Could not determine audio duration of ${path}`, {
      hint: 'The file may have no audio stream, or ffprobe returned no duration.',
      details: { ffprobeStdout: stdout },
    });
  }
  return sec;
}
