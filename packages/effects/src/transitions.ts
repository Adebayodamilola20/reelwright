/**
 * Transitions — clip-boundary data model + timing math + export planning.
 *
 * v1 model (Designed):
 * - A transition belongs at the boundary between a clip and the PREVIOUS
 *   clip on the same track (proposed as `Clip.transitionIn`). The two clips
 *   must ABUT exactly (outgoing.end === incoming.start); the contract forbids
 *   overlap on a track, so this is the only representable geometry in v1.
 * - The transition occupies a `duration`-long region ending at the boundary:
 *   the outgoing clip's LAST `duration` ticks and the incoming clip's FIRST
 *   `duration` ticks are blended into one `duration`-long output region.
 *   Net program duration = sum(clip durations) − transition.duration.
 *
 *   timeline (pre):   [---- outgoing ----][---- incoming ----]
 *   output:           [.. outgoing ..][ blend ][.. incoming ..]
 *                                    ^ regionStart   regionEnd = boundary
 *
 * Export mapping (all probed Observed on local ffmpeg 8.1.1, runtime-gated):
 * - cut      → concat
 * - fade     → xfade transition=fade    (offset 0 on a D-long tail input)
 * - wipe     → xfade wipeleft|wiperight|wipeup|wipedown by direction
 * - dipToColor → xfade fadeblack / fadewhite (black/white only on export;
 *              any color previews fine — export of other colors fails with
 *              UNSUPPORTED_FEATURE + hint, per the honest-capability rule)
 * Audio: cut → concat; everything else → acrossfade=d=D.
 */

import {
  assertFiltersAvailable,
  assertXfadeTransitionAvailable,
  type FfmpegCapabilities,
} from './capabilities.js';
import { fail } from './errors.js';
import { secFromTicks } from './ticks.js';
import type { ClipLike, Ticks, Transition } from './types.js';

export interface TransitionWindow {
  /** Output-timeline region occupied by the blend: [regionStart, regionEnd). */
  regionStart: Ticks;
  regionEnd: Ticks;
  /** Outgoing source span blended into the region (its last `duration` ticks). */
  outgoingTail: { start: Ticks; end: Ticks };
  /** Incoming source span blended into the region (its first `duration` ticks). */
  incomingHead: { start: Ticks; end: Ticks };
  /** Program duration saved vs. abutting clips (== duration). */
  programLoss: Ticks;
}

const DIRECTIONS = ['left', 'right', 'up', 'down'] as const;
export type WipeDirection = (typeof DIRECTIONS)[number];

const WIPE_XFADE: Record<WipeDirection, string> = {
  left: 'wipeleft',
  right: 'wiperight',
  up: 'wipeup',
  down: 'wipedown',
};

/** Validate a transition value; returns it normalized. */
export function validateTransition(t: Transition): Transition {
  if (t.kind === 'cut') {
    if (t.duration !== 0) {
      fail('INVALID_ARGUMENT', 'A cut transition has zero duration.',
        'Set duration to 0 for cuts, or pick fade/dipToColor/wipe.');
    }
    return { kind: 'cut', duration: 0 };
  }
  if (!Number.isInteger(t.duration) || t.duration <= 0) {
    fail('INVALID_ARGUMENT', `Transition duration must be a positive integer tick count, got ${t.duration}.`,
      'Pick a transition length (e.g. half a second) before applying.');
  }
  if (t.kind === 'wipe') {
    const dir = t.direction ?? 'left';
    if (!DIRECTIONS.includes(dir)) {
      fail('INVALID_ARGUMENT', `Unknown wipe direction "${dir}".`,
        `Use one of: ${DIRECTIONS.join(', ')}.`);
    }
    return { kind: 'wipe', duration: t.duration, direction: dir };
  }
  if (t.kind === 'dipToColor') {
    const color = (t.color ?? '#000000').toLowerCase();
    if (!/^#[0-9a-f]{6}$/.test(color)) {
      fail('INVALID_ARGUMENT', `Invalid dip-to-color "${t.color}" (expected "#rrggbb").`);
    }
    return { kind: 'dipToColor', duration: t.duration, color };
  }
  return { kind: 'fade', duration: t.duration };
}

/**
 * Compute the blend window for a boundary. Throws INVALID_ARGUMENT when the
 * clips don't abut or the transition is longer than either clip.
 */
export function transitionWindow(
  outgoing: Pick<ClipLike, 'start' | 'duration'>,
  incoming: Pick<ClipLike, 'start' | 'duration'>,
  transition: Transition,
): TransitionWindow {
  const t = validateTransition(transition);
  if (t.kind === 'cut') {
    const boundary = outgoing.start + outgoing.duration;
    return {
      regionStart: boundary,
      regionEnd: boundary,
      outgoingTail: { start: boundary, end: boundary },
      incomingHead: { start: boundary, end: boundary },
      programLoss: 0,
    };
  }
  const boundary = outgoing.start + outgoing.duration;
  if (incoming.start !== boundary) {
    fail('INVALID_ARGUMENT',
      'Transitions require the two clips to abut exactly (v1 model).',
      `Outgoing ends at tick ${boundary}, incoming starts at tick ${incoming.start}. Close the gap or split/trim first; overlapping-clip transitions are planned.`,
      { boundary, incomingStart: incoming.start });
  }
  if (t.duration > outgoing.duration || t.duration > incoming.duration) {
    fail('INVALID_ARGUMENT',
      `Transition duration (${t.duration} ticks) exceeds ${t.duration > outgoing.duration ? 'the outgoing' : 'the incoming'} clip's length.`,
      'Shorten the transition or lengthen the clips.',
      { duration: t.duration, outgoingDur: outgoing.duration, incomingDur: incoming.duration });
  }
  return {
    regionStart: boundary - t.duration,
    regionEnd: boundary,
    outgoingTail: { start: boundary - t.duration, end: boundary },
    incomingHead: { start: boundary, end: boundary + t.duration },
    programLoss: t.duration,
  };
}

export interface TransitionExportPlan {
  window: TransitionWindow;
  durationSec: number;
  video: {
    strategy: 'concat' | 'xfade';
    /** Present when strategy === 'xfade'; feed as xfade=transition=…:duration=…:offset=… */
    xfade?: { transition: string; durationSec: number; offsetSec: number };
  };
  audio: { strategy: 'concat' | 'acrossfade'; durationSec?: number };
  requiredFilters: string[];
}

/**
 * Plan the ffmpeg mapping for one transition between two abutting clips.
 * Availability is checked against probed capabilities; anything unavailable
 * throws UNSUPPORTED_FEATURE + hint (honest-capability rule).
 */
export function buildTransitionExportPlan(
  outgoing: Pick<ClipLike, 'start' | 'duration'>,
  incoming: Pick<ClipLike, 'start' | 'duration'>,
  transition: Transition,
  caps: FfmpegCapabilities,
): TransitionExportPlan {
  const t = validateTransition(transition);
  const window = transitionWindow(outgoing, incoming, t);
  const durationSec = secFromTicks(t.duration);

  if (t.kind === 'cut') {
    assertFiltersAvailable(['concat'], caps, 'Cut (clip concat)');
    return {
      window,
      durationSec: 0,
      video: { strategy: 'concat' },
      audio: { strategy: 'concat' },
      requiredFilters: ['concat'],
    };
  }

  let xfadeName: string;
  let required: string[];
  if (t.kind === 'fade') {
    xfadeName = 'fade';
    required = ['xfade'];
    assertXfadeTransitionAvailable('fade', caps, 'Fade transition');
  } else if (t.kind === 'wipe') {
    xfadeName = WIPE_XFADE[t.direction ?? 'left'];
    required = ['xfade'];
    assertXfadeTransitionAvailable(xfadeName, caps, 'Wipe transition');
  } else {
    // dipToColor → fadeblack/fadewhite; other colors are preview-only (v1).
    const color = t.color ?? '#000000';
    if (color === '#000000') xfadeName = 'fadeblack';
    else if (color === '#ffffff') xfadeName = 'fadewhite';
    else {
      fail('UNSUPPORTED_FEATURE',
        `Dip-to-color ${color} cannot be exported by this build's plan (v1 supports black and white only).`,
        'Choose black or white for the dip color, or use a fade/wipe transition. Other colors preview correctly but would be silently wrong on export, so they are blocked here.',
        { color });
    }
    required = ['xfade'];
    assertXfadeTransitionAvailable(xfadeName, caps, 'Dip-to-color transition');
  }

  assertFiltersAvailable(['acrossfade'], caps, 'Transition audio crossfade');
  return {
    window,
    durationSec,
    video: {
      strategy: 'xfade',
      // input 0 = the D-long outgoing tail ⇒ the blend starts at offset 0.
      xfade: { transition: xfadeName, durationSec, offsetSec: 0 },
    },
    audio: { strategy: 'acrossfade', durationSec },
    requiredFilters: [...required, 'acrossfade'],
  };
}

/** Availability probe for the UI (no throw). */
export function transitionAvailability(
  transition: Transition,
  caps: FfmpegCapabilities,
): { transition: string; available: boolean; reason?: string } {
  try {
    const t = validateTransition(transition);
    if (t.kind === 'cut') {
      assertFiltersAvailable(['concat'], caps, 'Cut');
      return { transition: 'cut', available: true };
    }
    const fake = { start: 0, duration: Number.MAX_SAFE_INTEGER / 2 };
    buildTransitionExportPlan(fake, { start: fake.duration, duration: fake.duration }, t, caps);
    return { transition: t.kind, available: true };
  } catch (err) {
    return {
      transition: transition.kind,
      available: false,
      reason: err instanceof Error ? err.message : String(err),
    };
  }
}
