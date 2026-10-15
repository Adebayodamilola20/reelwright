/**
 * Clip audio → ffmpeg filter-chain mapping (volume, fadeIn, fadeOut).
 *
 * The contract stores per-clip audio as data (`Clip.audio`: linear `volume`,
 * `fadeIn`/`fadeOut` in ticks, `muted`, reserved `pan`) — it is NOT rendered
 * until the export layer maps it to ffmpeg filters. This module is that
 * mapping; Agent 1's export plan builder consumes it (proposal in
 * docs/PROJECT_CONTRACT.md "Contract review notes (Agent 3)").
 *
 * Mode (normative, Designed): the returned chain assumes it is applied AFTER
 * an `atrim` that isolates the clip's source span, so afade `st` times are
 * relative to the clip head. Engine builds per-clip:
 *   [atrim=...], <this chain>, [resample/concat/mix downstream]
 */

import { AudioError } from './errors.js';
import { formatFfmpegSeconds, type Rational, type Ticks } from './time.js';

export interface ClipAudioInput {
  /** Timeline duration of the clip (ticks, > 0). */
  durationTicks: Ticks;
  /** Clip speed; v1 contract supports only 1/1 — anything else is rejected honestly. */
  speed?: Rational;
  audio: {
    volume: number; // linear gain, 1 = unity
    fadeIn: Ticks; // 0 = none
    fadeOut: Ticks;
    muted: boolean;
    pan: number; // reserved; not rendered (engine rejects pan ≠ 0 at export)
  };
}

export interface ClipAudioPlan {
  /** True when the clip contributes no audio at all (engine may drop the input). */
  skip: boolean;
  /** Human-readable reason when `skip` is true. */
  reason?: string;
  /** Filter fragments in application order, applied after atrim (post-trim stream). */
  filters: string[];
}

/** Format a linear gain for ffmpeg (e.g. 1.5, 0.75); strips float-noise digits. */
export function formatGain(volume: number): string {
  return String(Number(volume.toFixed(6)));
}

/**
 * Map a clip's audio data to ffmpeg filter fragments.
 * Throws AudioError on data the export cannot honestly honor:
 *  - INVALID_ARGUMENT: negative volume, negative fades, fades exceeding the
 *    clip duration, non-finite values.
 *  - UNSUPPORTED_FEATURE: speed ≠ 1/1 (fades are timeline-time; speed
 *    stretching is not implemented, and silently wrong fades would violate
 *    the honest-capability rule).
 */
export function planClipAudio(clip: ClipAudioInput): ClipAudioPlan {
  const { durationTicks, audio } = clip;

  if (!Number.isFinite(durationTicks) || durationTicks <= 0) {
    throw new AudioError('INVALID_ARGUMENT', `clip duration must be > 0 ticks, got ${durationTicks}`);
  }
  if (clip.speed && (clip.speed.n !== 1 || clip.speed.d !== 1)) {
    throw new AudioError(
      'UNSUPPORTED_FEATURE',
      `audio mapping for speed ${clip.speed.n}/${clip.speed.d} is not implemented`,
      'Speed-ramped audio (atempo chains) is Planned; export currently rejects speed ≠ 1/1 (contract Export contract).',
    );
  }
  if (!Number.isFinite(audio.volume) || audio.volume < 0) {
    throw new AudioError('INVALID_ARGUMENT', `volume must be a finite number ≥ 0, got ${audio.volume}`);
  }
  for (const [name, value] of [['fadeIn', audio.fadeIn], ['fadeOut', audio.fadeOut]] as const) {
    if (!Number.isInteger(value) || value < 0) {
      throw new AudioError('INVALID_ARGUMENT', `${name} must be an integer tick count ≥ 0, got ${value}`);
    }
  }
  if (audio.fadeIn + audio.fadeOut > durationTicks) {
    throw new AudioError(
      'INVALID_ARGUMENT',
      `fadeIn + fadeOut (${audio.fadeIn} + ${audio.fadeOut} ticks) exceeds clip duration (${durationTicks} ticks)`,
      'Clamp fades to the clip length before export (timeline ops should prevent this state).',
    );
  }

  if (audio.muted) {
    return { skip: true, reason: 'clip audio is muted', filters: [] };
  }
  if (audio.volume === 0) {
    return { skip: true, reason: 'clip volume is 0', filters: [] };
  }

  const filters: string[] = [];
  if (audio.volume !== 1) {
    filters.push(`volume=${formatGain(audio.volume)}`);
  }
  if (audio.fadeIn > 0) {
    filters.push(`afade=t=in:st=0:d=${formatFfmpegSeconds(audio.fadeIn)}`);
  }
  if (audio.fadeOut > 0) {
    const fadeOutStart = durationTicks - audio.fadeOut;
    filters.push(`afade=t=out:st=${formatFfmpegSeconds(fadeOutStart)}:d=${formatFfmpegSeconds(audio.fadeOut)}`);
  }

  return { skip: false, filters };
}

/**
 * Same as planClipAudio but returns a non-throwing result — convenient for
 * preflight checks that must list problems instead of failing mid-export.
 */
export type ClipAudioPlanResult =
  | { ok: true; plan: ClipAudioPlan }
  | { ok: false; error: ReturnType<AudioError['toShape']> };

export function tryPlanClipAudio(clip: ClipAudioInput): ClipAudioPlanResult {
  try {
    return { ok: true, plan: planClipAudio(clip) };
  } catch (err) {
    if (err instanceof AudioError) return { ok: false, error: err.toShape() };
    throw err;
  }
}
