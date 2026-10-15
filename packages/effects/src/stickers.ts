/**
 * Stickers — ORIGINAL procedural SVG graphics (no copied assets; every shape
 * is generated from first principles here). Params are simple scalars/colors.
 *
 * Availability (honest): preview works today (the UI renders the SVG string
 * in the renderer). EXPORT is capability-gated OFF in v1 — the engine has no
 * SVG rasterizer and ffmpeg has no SVG input, so burning a sticker into an
 * export would need a rasterization path (e.g. renderer-rasterized PNG fed to
 * overlay). Until that lands, `assertStickerExportable` throws
 * UNSUPPORTED_FEATURE with that exact hint — the control must show as
 * unavailable, never silently drop the sticker.
 */

import { fail } from './errors.js';
import { fmt } from './ticks.js';
import type { ResolvedParams, StickerDef } from './types.js';

const PALETTE = {
  sun: '#ffb703',
  coral: '#fb8500',
  mint: '#2a9d8f',
  ink: '#264653',
  cream: '#fefae0',
  rose: '#e63946',
  sky: '#4ea8de',
};

function polygon(points: Array<[number, number]>): string {
  return points.map(([x, y], i) => `${i === 0 ? 'M' : 'L'} ${fmt(x)} ${fmt(y)}`).join(' ') + ' Z';
}

/** N-point star polygon centered at (r,r) with outer/inner radii. */
function starPoints(n: number, cx: number, cy: number, rOuter: number, rInner: number, rot = -Math.PI / 2): string {
  const pts: Array<[number, number]> = [];
  for (let i = 0; i < n * 2; i++) {
    const r = i % 2 === 0 ? rOuter : rInner;
    const a = rot + (i * Math.PI) / n;
    pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  return polygon(pts);
}

export const STICKERS: StickerDef[] = [
  {
    id: 'star',
    name: 'Star',
    description: 'Five-point star.',
    params: [
      { id: 'color', label: 'Fill', type: 'color', default: PALETTE.sun },
      { id: 'points', label: 'Points', type: 'number', min: 4, max: 12, step: 1, default: 5 },
    ],
    toSvg: (p) => {
      const color = String(p.color);
      const n = Math.round(Number(p.points));
      return (
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">` +
        `<path d="${starPoints(n, 50, 50, 48, 20)}" fill="${color}"/></svg>`
      );
    },
  },
  {
    id: 'burst',
    name: 'Burst',
    description: 'Spiky radial burst.',
    params: [
      { id: 'color', label: 'Fill', type: 'color', default: PALETTE.coral },
      { id: 'spikes', label: 'Spikes', type: 'number', min: 8, max: 24, step: 1, default: 14 },
    ],
    toSvg: (p) => {
      const color = String(p.color);
      const n = Math.round(Number(p.spikes));
      return (
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">` +
        `<path d="${starPoints(n, 50, 50, 49, 30)}" fill="${color}"/></svg>`
      );
    },
  },
  {
    id: 'arrow',
    name: 'Arrow',
    description: 'Block arrow pointing right.',
    params: [
      { id: 'color', label: 'Fill', type: 'color', default: PALETTE.mint },
    ],
    toSvg: (p) => {
      const color = String(p.color);
      const d =
        'M 6 38 L 58 38 L 58 18 L 94 50 L 58 82 L 58 62 L 6 62 Z';
      return (
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">` +
        `<path d="${d}" fill="${color}" stroke="${PALETTE.ink}" stroke-width="3" stroke-linejoin="round"/></svg>`
      );
    },
  },
  {
    id: 'speechBubble',
    name: 'Speech bubble',
    description: 'Rounded speech bubble with tail.',
    params: [
      { id: 'color', label: 'Fill', type: 'color', default: PALETTE.cream },
      { id: 'outline', label: 'Outline', type: 'color', default: PALETTE.ink },
    ],
    toSvg: (p) => {
      const fill = String(p.color);
      const line = String(p.outline);
      return (
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">` +
        `<path d="M 14 12 H 86 A 10 10 0 0 1 96 22 V 58 A 10 10 0 0 1 86 68 H 44 L 24 88 L 28 68 H 14 A 10 10 0 0 1 4 58 V 22 A 10 10 0 0 1 14 12 Z" ` +
        `fill="${fill}" stroke="${line}" stroke-width="3" stroke-linejoin="round"/></svg>`
      );
    },
  },
  {
    id: 'badge',
    name: 'Badge',
    description: 'Scalloped stamp badge with inner ring.',
    params: [
      { id: 'color', label: 'Fill', type: 'color', default: PALETTE.rose },
      { id: 'ring', label: 'Ring', type: 'color', default: PALETTE.cream },
      { id: 'scallops', label: 'Scallops', type: 'number', min: 8, max: 20, step: 1, default: 12 },
    ],
    toSvg: (p) => {
      const color = String(p.color);
      const ring = String(p.ring);
      const n = Math.round(Number(p.scallops));
      const scallop = starPoints(n, 50, 50, 49, 42);
      return (
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">` +
        `<path d="${scallop}" fill="${color}"/>` +
        `<circle cx="50" cy="50" r="33" fill="none" stroke="${ring}" stroke-width="4"/></svg>`
      );
    },
  },
  {
    id: 'sparkle',
    name: 'Sparkle',
    description: 'Four-point sparkle.',
    params: [
      { id: 'color', label: 'Fill', type: 'color', default: PALETTE.sky },
    ],
    toSvg: (p) => {
      const color = String(p.color);
      return (
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">` +
        `<path d="${starPoints(4, 50, 50, 48, 8)}" fill="${color}"/></svg>`
      );
    },
  },
];

const BY_ID = new Map(STICKERS.map((s) => [s.id, s]));

export function getSticker(id: string): StickerDef {
  const s = BY_ID.get(id);
  if (!s) fail('NOT_FOUND', `Unknown sticker "${id}".`, `Known stickers: ${[...BY_ID.keys()].join(', ')}`);
  return s;
}

export function listStickers(): StickerDef[] {
  return [...STICKERS];
}

/** Resolve sticker params (color strings validated, numbers clamped/rounded). */
export function resolveStickerParams(
  id: string,
  overrides: Record<string, string | number | boolean> = {},
): ResolvedParams {
  const def = getSticker(id);
  const out: ResolvedParams = {};
  for (const p of def.params) {
    const raw = Object.prototype.hasOwnProperty.call(overrides, p.id) ? overrides[p.id] : p.default;
    if (p.type === 'color') {
      if (typeof raw !== 'string' || !/^#?[0-9a-fA-F]{6}$/.test(raw.trim())) {
        fail('INVALID_ARGUMENT', `Sticker "${id}" param "${p.id}" must be a "#rrggbb" color.`);
      }
      out[p.id] = raw.trim().toLowerCase();
    } else if (p.type === 'number') {
      if (typeof raw !== 'number' || !Number.isFinite(raw)) {
        fail('INVALID_ARGUMENT', `Sticker "${id}" param "${p.id}" must be a finite number.`);
      }
      const clamped = Math.min(p.max ?? Infinity, Math.max(p.min ?? -Infinity, raw));
      out[p.id] = p.step === 1 ? Math.round(clamped) : clamped;
    } else {
      out[p.id] = !!raw;
    }
  }
  return out;
}

export function stickerSvg(id: string, overrides: Record<string, string | number | boolean> = {}): string {
  const def = getSticker(id);
  return def.toSvg(resolveStickerParams(id, overrides));
}

/**
 * Export gate (v1): sticker rasterization is not implemented, so export of
 * sticker overlays fails loudly with the reason and the planned path.
 */
export function assertStickerExportable(): void {
  fail('UNSUPPORTED_FEATURE',
    'Sticker burn-in on export is not implemented in v1.',
    'Stickers preview in the editor, but the export pipeline has no SVG rasterizer yet (planned: renderer-rasterized PNG via the overlay filter). Remove the sticker before exporting, or wait for that release — it will not be silently dropped.');
}

export { PALETTE as STICKER_PALETTE };
