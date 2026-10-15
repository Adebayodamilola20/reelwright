/**
 * Effect definitions — every effect is an original implementation with THREE
 * kept-honest parts:
 *   1. preview  — a serializable PreviewOp plan (CSS filter or pure canvas
 *                 math; reference implementations in preview.ts, no DOM here)
 *   2. export   — an ffmpeg filter-chain segment + the filters it requires
 *   3. gating   — required-filter checks at export time (capabilities.ts);
 *                 unavailable → UNSUPPORTED_FEATURE + hint, never a silent drop
 *
 * Mapping evidence: all ffmpeg filters below were probed present in the local
 * ffmpeg 8.1.1 (Observed 2026-10-15) — gblur, unsharp, eq, hue,
 * colorchannelmixer, colortemperature, vignette, negate, scale, rgbashift —
 * but the runtime probe still decides, per machine.
 */

import { fail } from '../errors.js';
import type {
  EffectDefinition,
  PreviewOp,
  ResolvedParams,
} from '../types.js';
import { fmt } from '../ticks.js';

/* ---------- param access helpers ---------- */

export function paramNum(params: ResolvedParams, id: string): number {
  const v = params[id];
  if (typeof v !== 'number' || !Number.isFinite(v)) {
    fail('INTERNAL', `Effect param "${id}" expected a finite number, got ${JSON.stringify(v)}`);
  }
  return v;
}

export function paramBool(params: ResolvedParams, id: string): boolean {
  const v = params[id];
  if (typeof v !== 'boolean') {
    fail('INTERNAL', `Effect param "${id}" expected a boolean, got ${JSON.stringify(v)}`);
  }
  return v;
}

export function paramStr(params: ResolvedParams, id: string): string {
  const v = params[id];
  if (typeof v !== 'string') {
    fail('INTERNAL', `Effect param "${id}" expected a string, got ${JSON.stringify(v)}`);
  }
  return v;
}

/** Parse '#rrggbb' into 0..1 RGB triple. */
export function parseHexColor(hex: string): [number, number, number] {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex.trim());
  if (!m) {
    fail('INVALID_ARGUMENT', `Invalid color "${hex}" (expected "#rrggbb").`,
      'Use a 6-digit hex color like #ff8800.');
  }
  const int = parseInt(m![1], 16);
  return [((int >> 16) & 255) / 255, ((int >> 8) & 255) / 255, (int & 255) / 255];
}

const cssNum = (n: number): string => String(Number(n.toFixed(4)));

/* ---------- the registry ---------- */

/** Shared renderer for the eq-based family (brightness/contrast/saturation).
 * Emits whichever of its params are present, in fixed order — merged groups
 * therefore render as ONE `eq=a=…:b=…:c=…` call. */
export function eqChain(params: ResolvedParams): string {
  const parts: string[] = [];
  if ('brightness' in params) parts.push(`brightness=${fmt(paramNum(params, 'brightness'))}`);
  if ('contrast' in params) parts.push(`contrast=${fmt(paramNum(params, 'contrast'))}`);
  if ('saturation' in params) parts.push(`saturation=${fmt(paramNum(params, 'saturation'))}`);
  return parts.length > 0 ? `eq=${parts.join(':')}` : '';
}

export const EFFECT_DEFINITIONS: EffectDefinition[] = [
  {
    id: 'blur',
    name: 'Blur',
    description: 'Gaussian blur. Preview: CSS blur (same σ semantics). Export: gblur.',
    category: 'blur',
    params: [
      { id: 'sigma', label: 'Strength', type: 'number', min: 0, max: 64, step: 0.1, default: 8 },
    ],
    export: {
      requiredFilters: ['gblur'],
      toChain: (p) => `gblur=sigma=${fmt(paramNum(p, 'sigma'))}`,
    },
    preview: (p): PreviewOp[] => [{ op: 'cssFilter', css: `blur(${cssNum(paramNum(p, 'sigma'))}px)` }],
  },
  {
    id: 'sharpen',
    name: 'Sharpen',
    description: 'Unsharp-mask sharpening. Preview: 3×3 unsharp kernel on canvas (approximation of ffmpeg unsharp).',
    category: 'sharpen',
    params: [
      { id: 'amount', label: 'Amount', type: 'number', min: 0, max: 3, step: 0.05, default: 0.5 },
    ],
    export: {
      requiredFilters: ['unsharp'],
      toChain: (p) => {
        const a = fmt(paramNum(p, 'amount'));
        return `unsharp=5:5:${a}:5:5:0.0`;
      },
    },
    preview: (p): PreviewOp[] => {
      const a = paramNum(p, 'amount');
      // Classic unsharp kernel: center 1+4a, neighbors −a.
      return [{
        op: 'convolve',
        kernel: [0, -a, 0, -a, 1 + 4 * a, -a, 0, -a, 0],
        divisor: 1,
        bias: 0,
      }];
    },
  },
  {
    id: 'brightness',
    name: 'Brightness',
    description: 'Linear brightness offset. Export: eq=brightness (−1..1). Preview: CSS brightness(1+2×level) — designed approximation of the additive eq scale.',
    category: 'color',
    mergeKey: 'eq',
    params: [
      { id: 'brightness', label: 'Brightness', type: 'number', min: -1, max: 1, step: 0.01, default: 0 },
    ],
    export: {
      requiredFilters: ['eq'],
      toChain: (p) => eqChain(p),
    },
    preview: (p): PreviewOp[] => [
      { op: 'cssFilter', css: `brightness(${cssNum(Math.max(0, 1 + 2 * paramNum(p, 'brightness')))})` },
    ],
  },
  {
    id: 'contrast',
    name: 'Contrast',
    description: 'Contrast around mid-gray. Export: eq=contrast; preview CSS contrast() (identical formula).',
    category: 'color',
    mergeKey: 'eq',
    params: [
      { id: 'contrast', label: 'Contrast', type: 'number', min: 0, max: 3, step: 0.01, default: 1 },
    ],
    export: {
      requiredFilters: ['eq'],
      toChain: (p) => eqChain(p),
    },
    preview: (p): PreviewOp[] => [{ op: 'cssFilter', css: `contrast(${cssNum(paramNum(p, 'contrast'))})` }],
  },
  {
    id: 'saturation',
    name: 'Saturation',
    description: 'Color saturation. Export: eq=saturation; preview CSS saturate() (1:1).',
    category: 'color',
    mergeKey: 'eq',
    params: [
      { id: 'saturation', label: 'Saturation', type: 'number', min: 0, max: 3, step: 0.01, default: 1 },
    ],
    export: {
      requiredFilters: ['eq'],
      toChain: (p) => eqChain(p),
    },
    preview: (p): PreviewOp[] => [{ op: 'cssFilter', css: `saturate(${cssNum(paramNum(p, 'saturation'))})` }],
  },
  {
    id: 'grayscale',
    name: 'Grayscale',
    description: 'Desaturate to gray. Export: hue=s=(1−amount); preview CSS grayscale().',
    category: 'color',
    params: [
      { id: 'amount', label: 'Amount', type: 'number', min: 0, max: 1, step: 0.01, default: 1 },
    ],
    export: {
      requiredFilters: ['hue'],
      toChain: (p) => `hue=s=${fmt(1 - paramNum(p, 'amount'))}`,
    },
    preview: (p): PreviewOp[] => [{ op: 'cssFilter', css: `grayscale(${cssNum(paramNum(p, 'amount'))})` }],
  },
  {
    id: 'sepia',
    name: 'Sepia',
    description: 'Warm brown tone. Export: colorchannelmixer (standard sepia matrix, blended by amount); preview CSS sepia() (same matrix).',
    category: 'stylize',
    params: [
      { id: 'amount', label: 'Amount', type: 'number', min: 0, max: 1, step: 0.01, default: 1 },
    ],
    export: {
      requiredFilters: ['colorchannelmixer'],
      toChain: (p) => sepiaChain(paramNum(p, 'amount')),
    },
    preview: (p): PreviewOp[] => [{ op: 'cssFilter', css: `sepia(${cssNum(paramNum(p, 'amount'))})` }],
  },
  {
    id: 'invert',
    name: 'Invert',
    description: 'Invert all colors. Export: negate; preview CSS invert().',
    category: 'stylize',
    params: [
      { id: 'on', label: 'Invert', type: 'boolean', default: true },
    ],
    export: {
      requiredFilters: ['negate'],
      toChain: (p) => (paramBool(p, 'on') ? 'negate' : ''),
    },
    preview: (p): PreviewOp[] => [{ op: 'cssFilter', css: `invert(${paramBool(p, 'on') ? 1 : 0})` }],
  },
  {
    id: 'vignette',
    name: 'Vignette',
    description: 'Darkened frame edges. Export: vignette filter (angle ∝ strength); preview: radial-gradient overlay.',
    category: 'stylize',
    params: [
      { id: 'strength', label: 'Strength', type: 'number', min: 0, max: 1, step: 0.01, default: 0.5 },
    ],
    export: {
      requiredFilters: ['vignette'],
      // angle 0 → no vignette; PI/4 at full strength (filter default is PI/5).
      toChain: (p) => `vignette=a=${fmt((Math.PI / 4) * paramNum(p, 'strength'))}`,
    },
    preview: (p): PreviewOp[] => {
      const s = paramNum(p, 'strength');
      const inner = Math.round((1 - s) * 70);
      const css = `radial-gradient(ellipse at center, rgba(0,0,0,0) ${inner}%, rgba(0,0,0,${cssNum(0.75 * s)}) 100%)`;
      return [{ op: 'radialVignette', strength: s, css }];
    },
  },
  {
    id: 'pixelate',
    name: 'Pixelate',
    description: 'Mosaic blocks. Export: scale down + neighbor-neighbour upscale; preview: canvas drawImage down/upscale.',
    category: 'mosaic',
    params: [
      { id: 'block', label: 'Block size (px)', type: 'number', min: 2, max: 64, step: 1, default: 12 },
    ],
    export: {
      requiredFilters: ['scale'],
      toChain: (p, ctx) => {
        const b = Math.max(2, Math.round(paramNum(p, 'block')));
        // Downscale with bicubic (smooth source of the block average), upscale
        // with nearest-neighbour for hard mosaic edges. Even dims keep yuv happy.
        return (
          `scale=trunc(iw/${b}/2)*2:trunc(ih/${b}/2)*2:flags=bicubic,` +
          `scale=${ctx.width}:${ctx.height}:flags=neighbor`
        );
      },
    },
    preview: (p): PreviewOp[] => [{ op: 'pixelate', block: Math.max(2, Math.round(paramNum(p, 'block'))) }],
  },
  {
    id: 'temperature',
    name: 'Temperature',
    description: 'Warm/cool white balance. Export: colortemperature (mapping designed & verified: positive = warmer = lower K; Observed on this ffmpeg: 3000K warms, 10000K cools). Preview: RGB gain matrix approximation.',
    category: 'color',
    params: [
      { id: 'value', label: 'Warm (+) / Cool (−)', type: 'number', min: -1, max: 1, step: 0.01, default: 0 },
    ],
    export: {
      requiredFilters: ['colortemperature'],
      toChain: (p) => {
        const v = paramNum(p, 'value');
        const kelvin = Math.min(40000, Math.max(1000, Math.round(6500 - v * 3500)));
        return `colortemperature=temperature=${kelvin}`;
      },
    },
    preview: (p): PreviewOp[] => {
      const v = paramNum(p, 'value');
      const kr = 1 + 0.18 * v;
      const kb = 1 - 0.18 * v;
      return [{ op: 'channelMatrix', matrix: [kr, 0, 0, 0, 1, 0, 0, 0, kb] }];
    },
  },
  {
    id: 'duotone',
    name: 'Duotone',
    description: 'Two-tone map of the luminance. Export + preview share the exact colorchannelmixer/RGB matrix (near-exact match).',
    category: 'stylize',
    params: [
      { id: 'dark', label: 'Shadow color', type: 'color', default: '#0b1d36' },
      { id: 'light', label: 'Highlight color', type: 'color', default: '#ffd166' },
    ],
    export: {
      requiredFilters: ['colorchannelmixer'],
      toChain: (p) => duotoneChain(paramStr(p, 'dark'), paramStr(p, 'light')),
    },
    preview: (p): PreviewOp[] => [
      { op: 'channelMatrix', matrix: duotoneMatrix(paramStr(p, 'dark'), paramStr(p, 'light')) },
    ],
  },
  {
    id: 'chromatic',
    name: 'Chromatic aberration',
    description: 'Offsets red/blue channels radially-ish (horizontal approximation). Export: rgbashift; preview: canvas channel shift.',
    category: 'distort',
    params: [
      { id: 'shift', label: 'Shift (px)', type: 'number', min: 0, max: 10, step: 0.5, default: 2 },
    ],
    export: {
      requiredFilters: ['rgbashift'],
      toChain: (p) => {
        const s = Math.round(paramNum(p, 'shift'));
        return s === 0 ? '' : `rgbashift=rh=-${s}:bh=${s}`;
      },
    },
    preview: (p): PreviewOp[] => [{ op: 'channelShift', dx: Math.round(paramNum(p, 'shift')) }],
  },
];

/* ---------- shared matrix math (also used by tests) ---------- */

/** Standard sepia matrix blended toward identity by (1−amount). */
export function sepiaChain(amount: number): string {
  const a = Math.min(1, Math.max(0, amount));
  const rr = 1 - a + 0.393 * a;
  const rg = 0.769 * a;
  const rb = 0.189 * a;
  const gr = 0.349 * a;
  const gg = 1 - a + 0.686 * a;
  const gb = 0.168 * a;
  const br = 0.272 * a;
  const bg = 0.534 * a;
  const bb = 1 - a + 0.134 * a;
  return (
    `colorchannelmixer=rr=${fmt(rr)}:rg=${fmt(rg)}:rb=${fmt(rb)}` +
    `:gr=${fmt(gr)}:gg=${fmt(gg)}:gb=${fmt(gb)}` +
    `:br=${fmt(br)}:bg=${fmt(bg)}:bb=${fmt(bb)}`
  );
}

/**
 * Duotone as a 3×3 RGB matrix: out = dark + Y(luma) * (light − dark),
 * with Rec.709 luma weights (0.2126, 0.7152, 0.0722).
 */
export function duotoneMatrix(darkHex: string, lightHex: string): number[] {
  const [dr, dg, db] = parseHexColor(darkHex);
  const [lr, lg, lb] = parseHexColor(lightHex);
  const wr = lr - dr;
  const wg = lg - dg;
  const wb = lb - db;
  const YR = 0.2126;
  const YG = 0.7152;
  const YB = 0.0722;
  return [
    dr + wr * YR, wr * YG, wr * YB,
    wg * YR, dg + wg * YG, wg * YB,
    wb * YR, wb * YG, db + wb * YB,
  ];
}

export function duotoneChain(darkHex: string, lightHex: string): string {
  const m = duotoneMatrix(darkHex, lightHex);
  return (
    `colorchannelmixer=rr=${fmt(m[0])}:rg=${fmt(m[1])}:rb=${fmt(m[2])}` +
    `:gr=${fmt(m[3])}:gg=${fmt(m[4])}:gb=${fmt(m[5])}` +
    `:br=${fmt(m[6])}:bg=${fmt(m[7])}:bb=${fmt(m[8])}`
  );
}
