/**
 * Noise cleanup profiles backed by local ffmpeg filters.
 *
 * Every profile is expressed as filter stages; each stage declares the ffmpeg
 * filter it needs. Availability is probed at runtime (`ffmpeg -filters`) — a
 * missing filter is reported as UNSUPPORTED_FEATURE with the real reason,
 * never silently skipped (charter honest-capability rule).
 *
 * Observed on the local build (2026-10-15): highpass, lowpass, bandreject,
 * afftdn, anlmdn, adeclip all present — but the code never assumes this.
 */

import { AudioError } from './errors.js';
import { audioCapabilities, DEFAULT_FFMPEG, runFfmpegOrThrow } from './ffmpeg.js';

export type NoiseProfileId = 'light' | 'hum-removal' | 'standard' | 'strong';

interface NoiseStage {
  filter: string;
  /** Filter args without the name, e.g. `f=90`. */
  args: string;
  note: string;
}

const PROFILES: Record<NoiseProfileId, { label: string; description: string; stages: NoiseStage[] }> = {
  'light': {
    label: 'Light cleanup',
    description: 'High-pass rumble removal + gentle low-pass; safest profile, no denoiser needed.',
    stages: [
      { filter: 'highpass', args: 'f=90', note: 'removes rumble below 90 Hz' },
      { filter: 'lowpass', args: 'f=15500', note: 'softens hiss above 15.5 kHz' },
    ],
  },
  'hum-removal': {
    label: 'Mains hum removal',
    description: 'Band-rejects 50 Hz and 60 Hz mains hum and their immediate neighbourhood.',
    stages: [
      { filter: 'bandreject', args: 'f=50:w=4', note: 'rejects 50 Hz mains hum' },
      { filter: 'bandreject', args: 'f=60:w=4', note: 'rejects 60 Hz mains hum' },
    ],
  },
  'standard': {
    label: 'Standard denoise',
    description: 'High-pass + FFT denoise (afftdn, moderate reduction) — typical voiceover cleanup.',
    stages: [
      { filter: 'highpass', args: 'f=90', note: 'removes rumble below 90 Hz' },
      { filter: 'afftdn', args: 'nr=12:tn=1', note: 'FFT denoise, 12 dB reduction, trace noise on' },
    ],
  },
  'strong': {
    label: 'Strong denoise',
    description: 'Aggressive FFT denoise + bandwidth limit — last resort; may add artifacts.',
    stages: [
      { filter: 'highpass', args: 'f=100', note: 'removes rumble below 100 Hz' },
      { filter: 'afftdn', args: 'nr=30:tn=1', note: 'FFT denoise, 30 dB reduction (artifacts possible)' },
      { filter: 'lowpass', args: 'f=14000', note: 'limits denoise ringing above 14 kHz' },
    ],
  },
};

export interface NoiseProfileInfo {
  id: NoiseProfileId;
  label: string;
  description: string;
}

export function listNoiseProfiles(): NoiseProfileInfo[] {
  return (Object.keys(PROFILES) as NoiseProfileId[]).map((id) => ({
    id,
    label: PROFILES[id].label,
    description: PROFILES[id].description,
  }));
}

export type NoisePlan =
  | { ok: true; profile: NoiseProfileId; filters: string[]; notes: string[] }
  | { ok: false; profile: NoiseProfileId; code: 'UNSUPPORTED_FEATURE'; missing: string[]; reason: string };

/** Resolve a profile against a set of available filter names (from probeFilters). */
export function planNoiseCleanup(profile: NoiseProfileId, available: ReadonlySet<string>): NoisePlan {
  const def = PROFILES[profile];
  if (!def) {
    throw new AudioError('INVALID_ARGUMENT', `unknown noise profile '${profile}'`, `Known: ${Object.keys(PROFILES).join(', ')}`);
  }
  const missing = def.stages.filter((s) => !available.has(s.filter)).map((s) => s.filter);
  if (missing.length > 0) {
    return {
      ok: false,
      profile,
      code: 'UNSUPPORTED_FEATURE',
      missing,
      reason: `This ffmpeg build lacks the filter(s) ${missing.join(', ')} required by the '${def.label}' profile.`,
    };
  }
  return {
    ok: true,
    profile,
    filters: def.stages.map((s) => `${s.filter}=${s.args}`),
    notes: def.stages.map((s) => `${s.filter}: ${s.note}`),
  };
}

export interface NoiseCleanupResult {
  outputPath: string;
  filters: string[];
  profile: NoiseProfileId;
}

/**
 * Apply a noise-cleanup profile to an audio file, writing `outputPath`
 * (format chosen from the extension; defaults to WAV pcm_s16le for .wav).
 * Throws UNSUPPORTED_FEATURE with the missing filters when the local build
 * cannot honor the profile.
 */
export async function runNoiseCleanup(
  inputPath: string,
  outputPath: string,
  profile: NoiseProfileId,
  opts: { ffmpegPath?: string; sampleRate?: number; bitrateKbps?: number } = {},
): Promise<NoiseCleanupResult> {
  const ffmpeg = opts.ffmpegPath ?? DEFAULT_FFMPEG;
  const caps = await audioCapabilities(ffmpeg);
  const plan = planNoiseCleanup(profile, new Set(Object.entries(caps.filters).filter(([, v]) => v).map(([k]) => k)));
  if (!plan.ok) {
    throw new AudioError('UNSUPPORTED_FEATURE', plan.reason, {
      hint: `Pick another profile (${listNoiseProfiles().map((p) => p.id).join(', ')}) or install an ffmpeg build with ${plan.missing.join(', ')}.`,
      details: { profile, missing: plan.missing },
    });
  }

  const args = ['-i', inputPath, '-af', plan.filters.join(','), '-ac', '2'];
  if (opts.sampleRate) args.push('-ar', String(opts.sampleRate));
  if (outputPath.endsWith('.mp3')) {
    args.push('-c:a', 'libmp3lame', '-b:a', `${opts.bitrateKbps ?? 192}k`);
  } else {
    args.push('-c:a', 'pcm_s16le');
  }
  args.push('-y', outputPath);

  await runFfmpegOrThrow(args, { bin: ffmpeg, what: `noise cleanup (${profile})` });
  return { outputPath, filters: plan.filters, profile };
}
