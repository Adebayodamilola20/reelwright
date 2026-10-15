/**
 * Effect registry — lookup, parameter resolution (defaults + overrides +
 * clamping), keyframed-param resolution, and availability reporting for the
 * UI (so a control is never shown as functional when its export mapping is
 * unavailable — the honest-capability rule).
 */

import { assertFiltersAvailable, type FfmpegCapabilities } from '../capabilities.js';
import { fail } from '../errors.js';
import { evaluatePropAt, effectProp } from '../keyframes.js';
import { EFFECT_DEFINITIONS, parseHexColor } from './definitions.js';
import type {
  ClipLike,
  EffectContext,
  EffectDefinition,
  EffectInstance,
  EffectValue,
  ResolvedParams,
} from '../types.js';

const REGISTRY = new Map<string, EffectDefinition>(
  EFFECT_DEFINITIONS.map((d) => [d.id, d]),
);

export function getEffect(effectId: string): EffectDefinition {
  const def = REGISTRY.get(effectId);
  if (!def) {
    fail('NOT_FOUND', `Unknown effect "${effectId}".`,
      `Known effects: ${[...REGISTRY.keys()].join(', ')}`);
  }
  return def;
}

export function listEffects(): EffectDefinition[] {
  return [...REGISTRY.values()];
}

/** True when the effect id exists (UI availability checks). */
export function hasEffect(effectId: string): boolean {
  return REGISTRY.has(effectId);
}

function clampNumber(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

/**
 * Resolve an effect's params: registry defaults overridden by `overrides`,
 * with numbers clamped to their declared range and types validated
 * (booleans/colors checked). Unknown override keys are rejected (typo guard).
 */
export function resolveEffectParams(
  effectId: string,
  overrides: Record<string, EffectValue> = {},
): ResolvedParams {
  const def = getEffect(effectId);
  const out: ResolvedParams = {};
  for (const p of def.params) {
    const raw = Object.prototype.hasOwnProperty.call(overrides, p.id) ? overrides[p.id] : p.default;
    if (p.type === 'number') {
      if (typeof raw !== 'number' || !Number.isFinite(raw)) {
        fail('INVALID_ARGUMENT', `Effect "${def.id}" param "${p.id}" must be a finite number.`,
          `Expected number in [${p.min ?? '-∞'}, ${p.max ?? '∞'}].`);
      }
      out[p.id] = clampNumber(raw, p.min ?? -Infinity, p.max ?? Infinity);
    } else if (p.type === 'boolean') {
      if (typeof raw !== 'boolean') {
        fail('INVALID_ARGUMENT', `Effect "${def.id}" param "${p.id}" must be a boolean.`);
      }
      out[p.id] = raw;
    } else {
      if (typeof raw !== 'string') {
        fail('INVALID_ARGUMENT', `Effect "${def.id}" param "${p.id}" must be a "#rrggbb" color string.`);
      }
      parseHexColor(raw); // validates format
      out[p.id] = raw.toLowerCase();
    }
  }
  const unknown = Object.keys(overrides).filter((k) => !def.params.some((p) => p.id === k));
  if (unknown.length > 0) {
    fail('INVALID_ARGUMENT', `Effect "${def.id}" got unknown param(s): ${unknown.join(', ')}.`,
      `Known params: ${def.params.map((p) => p.id).join(', ')}`);
  }
  return out;
}

/**
 * Params of one clip effect instance at tick `at`: static params overridden
 * by any keyframes on `effect.<instanceId>.<paramId>` props.
 */
export function resolveInstanceParamsAt(
  clip: ClipLike,
  instance: EffectInstance,
  at: number,
): ResolvedParams {
  const base = resolveEffectParams(instance.effectId, instance.params);
  const out: ResolvedParams = { ...base };
  const def = getEffect(instance.effectId);
  for (const p of def.params) {
    if (p.type !== 'number') continue; // only numbers are keyframable
    const prop = effectProp(instance.id, p.id);
    if (!clip.keyframes.some((k) => k.prop === prop)) continue;
    const v = evaluatePropAt(clip.keyframes, prop, at, base[p.id] as number);
    out[p.id] = clampNumber(v, p.min ?? -Infinity, p.max ?? Infinity);
  }
  return out;
}

/** True when no keyframes target this instance's numeric params (export gate). */
export function instanceParamsAreConstant(clip: ClipLike, instance: EffectInstance): boolean {
  const def = getEffect(instance.effectId);
  return !def.params.some(
    (p) => p.type === 'number' &&
      clip.keyframes.some((k) => k.prop === effectProp(instance.id, p.id)),
  );
}

export interface EffectAvailability {
  effectId: string;
  /** Preview always available (CSS/canvas is renderer-side). */
  preview: true;
  /** Export available iff every required filter is present AND no param is keyframed. */
  export: boolean;
  reason?: string;
  missingFilters: string[];
}

/** Availability of a single effect against probed capabilities. */
export function effectAvailability(
  effectId: string,
  caps: FfmpegCapabilities,
): EffectAvailability {
  const def = getEffect(effectId);
  const missing = def.export.requiredFilters.filter((f) => !caps.filters.has(f));
  if (missing.length > 0) {
    return {
      effectId,
      preview: true,
      export: false,
      reason: `This ffmpeg build lacks the ${missing.join(', ')} filter — the effect shows in preview but cannot be exported here.`,
      missingFilters: missing,
    };
  }
  return { effectId, preview: true, export: true, missingFilters: [] };
}

export function effectsAvailability(
  caps: FfmpegCapabilities,
): EffectAvailability[] {
  return [...REGISTRY.keys()].map((id) => effectAvailability(id, caps));
}

/**
 * Gate used by export builders: throws UNSUPPORTED_FEATURE + hint when the
 * effect's required filters are missing on this machine.
 */
export function assertEffectExportable(effectId: string, caps: FfmpegCapabilities): void {
  const def = getEffect(effectId);
  assertFiltersAvailable(def.export.requiredFilters, caps, def.name);
}

export { EFFECT_DEFINITIONS };
export type { EffectContext };
