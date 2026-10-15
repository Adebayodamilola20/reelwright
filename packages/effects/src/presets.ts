/**
 * Filter presets — original named combinations of registry effects.
 * A preset instantiates EffectInstances (fresh instance ids assigned by the
 * caller-supplied factory so keyframes can still target them).
 */

import { resolveEffectParams } from './effects/registry.js';
import { fail } from './errors.js';
import type { EffectInstance, EffectValue, FilterPreset } from './types.js';

export const FILTER_PRESETS: FilterPreset[] = [
  {
    id: 'warm-film',
    name: 'Warm Film',
    description: 'Gentle warmth, slightly faded contrast.',
    effects: [
      { effectId: 'brightness', params: { brightness: 0.04 } },
      { effectId: 'contrast', params: { contrast: 1.08 } },
      { effectId: 'saturation', params: { saturation: 0.92 } },
      { effectId: 'temperature', params: { value: 0.25 } },
      { effectId: 'vignette', params: { strength: 0.3 } },
    ],
  },
  {
    id: 'cold-tone',
    name: 'Cold Tone',
    description: 'Cool steel look.',
    effects: [
      { effectId: 'temperature', params: { value: -0.35 } },
      { effectId: 'saturation', params: { saturation: 0.9 } },
      { effectId: 'contrast', params: { contrast: 1.05 } },
    ],
  },
  {
    id: 'noir',
    name: 'Noir',
    description: 'High-contrast black & white with vignette.',
    effects: [
      { effectId: 'grayscale', params: { amount: 1 } },
      { effectId: 'contrast', params: { contrast: 1.25 } },
      { effectId: 'vignette', params: { strength: 0.55 } },
    ],
  },
  {
    id: 'vivid',
    name: 'Vivid',
    description: 'Punchy color and contrast.',
    effects: [
      { effectId: 'saturation', params: { saturation: 1.35 } },
      { effectId: 'contrast', params: { contrast: 1.1 } },
    ],
  },
  {
    id: 'soft-glow',
    name: 'Soft Glow',
    description: 'Slight blur + lift for a dreamy base.',
    effects: [
      { effectId: 'blur', params: { sigma: 1.5 } },
      { effectId: 'brightness', params: { brightness: 0.05 } },
    ],
  },
  {
    id: 'aged-paper',
    name: 'Aged Paper',
    description: 'Sepia tone with edge darkening.',
    effects: [
      { effectId: 'sepia', params: { amount: 0.8 } },
      { effectId: 'contrast', params: { contrast: 0.95 } },
      { effectId: 'vignette', params: { strength: 0.4 } },
    ],
  },
];

const BY_ID = new Map(FILTER_PRESETS.map((p) => [p.id, p]));

export function getPreset(id: string): FilterPreset {
  const p = BY_ID.get(id);
  if (!p) fail('NOT_FOUND', `Unknown filter preset "${id}".`, `Known presets: ${[...BY_ID.keys()].join(', ')}`);
  return p;
}

export function listPresets(): FilterPreset[] {
  return [...FILTER_PRESETS];
}

let counter = 0;
const defaultInstanceId = (presetId: string): string => `${presetId}-${++counter}`;

/**
 * Instantiate a preset into EffectInstances. Params are validated against the
 * registry (typos/overrides rejected). Instance ids come from `idFactory`
 * (deterministic default provided for tests).
 */
export function instantiatePreset(
  presetId: string,
  idFactory: (effectId: string) => string = defaultInstanceId,
): EffectInstance[] {
  const preset = getPreset(presetId);
  return preset.effects.map((e) => {
    const resolved: Record<string, EffectValue> = resolveEffectParams(e.effectId, e.params);
    return { id: idFactory(e.effectId), effectId: e.effectId, params: resolved, enabled: true };
  });
}
