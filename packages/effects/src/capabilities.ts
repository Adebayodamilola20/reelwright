/**
 * ffmpeg capability probing — the honest-availability backbone.
 *
 * Nothing in this package trusts a hardcoded filter list: every export
 * mapping declares the filters it needs, and `assertFiltersAvailable`
 * compares that against a runtime probe of the ACTUAL local ffmpeg
 * (`ffmpeg -filters`, plus `ffmpeg -h filter=xfade` for transition names).
 * A missing filter fails the export with UNSUPPORTED_FEATURE + hint —
 * never a silent drop (contract rule).
 *
 * Probe evidence in this environment (Observed, 2026-10-15, ffmpeg 8.1.1):
 * present — gblur, boxblur, unsharp, eq, hue, colorchannelmixer (incl. aa),
 * colorbalance, colortemperature, vignette, negate, scale, rgbashift, geq,
 * format, fade, xfade (incl. fade, fadeblack, fadewhite, wipeleft/right/up/down),
 * setpts, atempo, acrossfade, concat, overlay, color, trim, atrim, amix,
 * afade, volume, pad, crop, rotate; absent — drawtext/subtitles/ass and the
 * standalone wipe* filters (wipes go through xfade).
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fail } from './errors.js';

const execFileP = promisify(execFile);

export interface FfmpegCapabilities {
  ffmpegPath: string;
  version: string;
  filters: Set<string>;
  /** Transition names supported by the local xfade filter (empty if absent). */
  xfadeTransitions: Set<string>;
  probedAt: string;
}

/** Parse `ffmpeg -filters` output into a set of filter names. */
export function parseFfmpegFilters(text: string): Set<string> {
  const out = new Set<string>();
  // Lines look like: " T. eq                 V->V       Adjust ..."
  //                   " TS colorchannelmixer V->V       Adjust ..."
  // The flags column is 1–3 of [TSC.] (space-padded); the direction column
  // looks like V->V, N->A, |->V, N->N, VV->V ...
  const re = /^\s*(?:[TSC.]{1,3}\s)?([A-Za-z][A-Za-z0-9_]*)\s+([A-Z|]+->[A-Z|]+)\s+\S/;
  for (const line of text.split('\n')) {
    const m = re.exec(line);
    if (m) out.add(m[1]);
  }
  return out;
}

/** Parse `ffmpeg -h filter=xfade` output into supported transition names. */
export function parseXfadeTransitions(text: string): Set<string> {
  const out = new Set<string>();
  for (const line of text.split('\n')) {
    // "    fadeblack          12          ..FV....... ..."
    const m = /^\s{2,}([a-z][a-z0-9]*)\s+-?\d+\s+\.\./.exec(line);
    if (m) out.add(m[1]);
  }
  return out;
}

/** Probe the local ffmpeg. Throws FFMPEG_NOT_FOUND when the binary is absent. */
export async function probeFfmpegCapabilities(ffmpegPath = 'ffmpeg'): Promise<FfmpegCapabilities> {
  let version = '';
  let filtersText = '';
  let xfadeText = '';
  try {
    const v = await execFileP(ffmpegPath, ['-version'], { maxBuffer: 1 << 20 });
    version = v.stdout.split('\n')[0] ?? '';
    const f = await execFileP(ffmpegPath, ['-hide_banner', '-filters'], { maxBuffer: 8 << 20 });
    filtersText = f.stdout;
  } catch (err) {
    fail('FFMPEG_NOT_FOUND', `Could not run "${ffmpegPath}" (${(err as Error).message}).`,
      'Set the correct ffmpeg path or install ffmpeg (e.g. `brew install ffmpeg`).');
  }
  try {
    const x = await execFileP(ffmpegPath, ['-hide_banner', '-h', 'filter=xfade'], { maxBuffer: 1 << 20 });
    xfadeText = x.stdout;
  } catch {
    // xfade help failing just means no transition names — the filter itself
    // is judged by its presence in `filters`.
  }
  return {
    ffmpegPath,
    version,
    filters: parseFfmpegFilters(filtersText),
    xfadeTransitions: parseXfadeTransitions(xfadeText),
    probedAt: new Date().toISOString(),
  };
}

export function missingFilters(
  required: readonly string[],
  caps: FfmpegCapabilities,
): string[] {
  return required.filter((f) => !caps.filters.has(f));
}

/**
 * Gate: throw UNSUPPORTED_FEATURE + actionable hint when any required filter
 * is missing from the probed ffmpeg. This is the single choke point every
 * export mapping goes through (honest-capability rule).
 */
export function assertFiltersAvailable(
  required: readonly string[],
  caps: FfmpegCapabilities,
  featureLabel: string,
): void {
  const missing = missingFilters(required, caps);
  if (missing.length > 0) {
    fail(
      'UNSUPPORTED_FEATURE',
      `${featureLabel} cannot be exported: this ffmpeg build lacks the ${missing.join(', ')} filter${missing.length > 1 ? 's' : ''}.`,
      `Install an ffmpeg build with ${missing.join(', ')} (e.g. \`brew install ffmpeg\`), or remove ${featureLabel} before exporting. Preview still shows it.`,
      { missing, ffmpegPath: caps.ffmpegPath },
    );
  }
}

/** Gate for xfade transition names specifically. */
export function assertXfadeTransitionAvailable(
  transition: string,
  caps: FfmpegCapabilities,
  featureLabel: string,
): void {
  assertFiltersAvailable(['xfade'], caps, featureLabel);
  if (!caps.xfadeTransitions.has(transition)) {
    fail(
      'UNSUPPORTED_FEATURE',
      `${featureLabel} cannot be exported: this ffmpeg's xfade filter has no "${transition}" transition.`,
      'Choose a different transition (fade is universally available) or update ffmpeg.',
      { transition, ffmpegPath: caps.ffmpegPath },
    );
  }
}
