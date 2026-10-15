/** Shared test helpers. */

import type { FfmpegCapabilities } from '../capabilities.js';
import type { ClipLike } from '../types.js';

export const ALL_KNOWN_FILTERS = [
  'gblur', 'boxblur', 'unsharp', 'eq', 'hue', 'colorchannelmixer', 'colorbalance',
  'colortemperature', 'vignette', 'negate', 'scale', 'rgbashift', 'chromashift',
  'geq', 'format', 'fade', 'xfade', 'setpts', 'atempo', 'acrossfade', 'concat',
  'overlay', 'color', 'trim', 'atrim', 'amix', 'afade', 'volume', 'pad', 'crop', 'rotate',
];

export const ALL_XFADE_TRANSITIONS = [
  'fade', 'fadeblack', 'fadewhite', 'dissolve', 'wipeleft', 'wiperight', 'wipeup', 'wipedown',
];

export function fakeCaps(
  filters: string[] = ALL_KNOWN_FILTERS,
  xfade: string[] = ALL_XFADE_TRANSITIONS,
): FfmpegCapabilities {
  return {
    ffmpegPath: '/usr/local/bin/ffmpeg',
    version: 'ffmpeg fake',
    filters: new Set(filters),
    xfadeTransitions: new Set(xfade),
    probedAt: '2026-10-15T00:00:00.000Z',
  };
}

export function testClip(overrides: Partial<ClipLike> = {}): ClipLike {
  return {
    id: 'c1',
    start: 0,
    duration: 1000,
    sourceIn: 0,
    speed: { n: 1, d: 1 },
    keyframes: [],
    ...overrides,
  };
}
