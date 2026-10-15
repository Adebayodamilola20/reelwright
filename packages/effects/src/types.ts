/**
 * Data shapes consumed/produced by @ve/effects.
 *
 * The first section is a STRUCTURAL MIRROR of docs/PROJECT_CONTRACT.md v1
 * (owned by Agent 1). This package deliberately does not import `@ve/engine`
 * so it builds and tests standalone and never goes red because of engine
 * churn; a real `Clip` from `@ve/engine` is assignable to `ClipLike` below.
 * Convergence to type-only imports is proposed in the contract's
 * "Contract review notes" (Agent 2.5).
 *
 * Everything here is JSON-serializable plain data.
 */

/** Integer tick count (1/70,560,000 s each) — contract v1 canonical time unit. */
export const TICKS_PER_SECOND = 70_560_000;

export type Ticks = number;

/** Exact rational number n/d, d > 0. */
export interface Rational {
  readonly n: number;
  readonly d: number;
}

/** Contract v1 easing set. */
export type Easing = 'linear' | 'easeIn' | 'easeOut' | 'easeInOut' | 'hold';

/**
 * Contract v1 keyframe props. The evaluator is generic over `prop: string`
 * so the proposed `effect.<instanceId>.<paramId>` props (and future props)
 * work without a redesign; engine `Keyframe` (union-typed prop) is assignable.
 */
export type ContractKeyframeProp =
  | 'transform.x'
  | 'transform.y'
  | 'transform.scale'
  | 'transform.rotationDeg'
  | 'transform.opacity'
  | 'audio.volume';

export interface Keyframe {
  prop: string;
  at: Ticks;
  value: number;
  easing: Easing;
}

export interface Transform {
  x: number; // px, origin = program center, +y down
  y: number;
  scale: number; // 1 = 100%, uniform
  rotationDeg: number; // clockwise
  opacity: number; // 0..1
}

/* ------------------------------------------------------------------ */
/* @ve/effects extensions (proposed additions to the contract Clip)    */
/* ------------------------------------------------------------------ */

export type EffectValue = number | boolean | string;

/**
 * One effect applied to a clip. Keyframes target this instance's params via
 * the prop path `effect.<instance.id>.<paramId>` (proposed extension).
 */
export interface EffectInstance {
  id: string; // instance id (unique per clip; keyframes reference it)
  effectId: string; // registry id, e.g. 'blur'
  /** Overrides of the registry defaults; missing params fall back to defaults. */
  params: Record<string, EffectValue>;
  enabled: boolean;
}

export type TransitionKind = 'cut' | 'fade' | 'dipToColor' | 'wipe';

/**
 * A transition at the boundary between a clip and the PREVIOUS clip on the
 * same track (proposed as `Clip.transitionIn`). v1 model requires the two
 * clips to abut exactly; see transitions.ts for the window math.
 */
export interface Transition {
  kind: TransitionKind;
  /** 0 for 'cut'. Region length for the others. */
  duration: Ticks;
  /** dipToColor: '#rrggbb'. Export currently supports black/white only. */
  color?: string;
  /** wipe direction; default 'left'. */
  direction?: 'left' | 'right' | 'up' | 'down';
}

/**
 * Normalized mask over a clip (proposed as `Clip.mask`).
 * Coordinates are fractions of the program frame; origin top-left.
 */
export interface MaskSpec {
  shape: 'rect' | 'ellipse';
  cx: number; // 0..1 center
  cy: number;
  rx: number; // 0..1 half-width
  ry: number; // 0..1 half-height
  /** 0..1 — edge falloff as a fraction of the radius. */
  feather: number;
  invert: boolean;
}

/**
 * Structural view of a contract `Clip` that this package consumes.
 * `effects`/`mask`/`transitionIn` are proposed contract extensions; when
 * absent the corresponding builders return null/no-ops.
 */
export interface ClipLike {
  id: string;
  start: Ticks;
  duration: Ticks;
  sourceIn: Ticks;
  speed: Rational;
  transform?: Transform;
  keyframes: Keyframe[];
  audio?: { volume: number }; // structural subset of ClipAudio
  effects?: EffectInstance[];
  mask?: MaskSpec | null;
  transitionIn?: Transition | null;
}

/* ------------------------------------------------------------------ */
/* Effect registry types                                               */
/* ------------------------------------------------------------------ */

export interface EffectParamDef {
  id: string;
  label: string;
  type: 'number' | 'boolean' | 'color';
  min?: number;
  max?: number;
  step?: number;
  default: EffectValue;
}

/** Resolved parameter values (defaults + overrides + clamping). */
export type ResolvedParams = Record<string, EffectValue>;

/** Context needed by mappings (program frame size). */
export interface EffectContext {
  width: number;
  height: number;
}

/**
 * Serializable preview operations. The UI executes these via CSS filters or
 * canvas; `convolve`/`channelShift`/`channelMatrix` reference implementations
 * live in preview.ts and are unit-tested in Node (no DOM needed here).
 */
export type PreviewOp =
  | { op: 'cssFilter'; css: string }
  | { op: 'convolve'; kernel: number[]; divisor: number; bias: number }
  | { op: 'pixelate'; block: number }
  | { op: 'channelShift'; dx: number }
  | { op: 'channelMatrix'; matrix: number[] } // 3x3 row-major, RGB gains 0..n
  | { op: 'radialVignette'; strength: number; css: string }
  | { op: 'maskSvg'; svgPath: string; featherPx: number; invert: boolean }
  | { op: 'crossfade'; durationSec: number; color: string | null }
  | { op: 'wipe'; durationSec: number; direction: 'left' | 'right' | 'up' | 'down' }
  | { op: 'switch' };

export interface EffectDefinition {
  id: string;
  name: string;
  description: string;
  category: 'blur' | 'sharpen' | 'color' | 'stylize' | 'mosaic' | 'distort';
  params: EffectParamDef[];
  /**
   * Consecutive enabled instances of the same category get their ffmpeg
   * segments merged into one filter call (e.g. all 'eq' effects) — the chain
   * builder re-renders the merged segment from merged params.
   */
  mergeKey?: string;
  export: {
    requiredFilters: string[];
    toChain(params: ResolvedParams, ctx: EffectContext): string;
    /** Additional export gate beyond filters; return a hint to block, null to allow. */
    gate?(params: ResolvedParams): string | null;
  };
  preview(params: ResolvedParams, ctx: EffectContext): PreviewOp[];
}

export interface StickerDef {
  id: string;
  name: string;
  description: string;
  /** Original procedural SVG (no copied assets). Params are simple scalars/colors. */
  params: EffectParamDef[];
  toSvg(params: ResolvedParams): string;
}

export interface FilterPreset {
  id: string;
  name: string;
  description: string;
  /** Effect instances (ids + params) this preset instantiates. */
  effects: Array<{ effectId: string; params: Record<string, EffectValue> }>;
}
