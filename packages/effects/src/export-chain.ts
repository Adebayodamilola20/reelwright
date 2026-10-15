/**
 * Export-side chain builders — produce ffmpeg filter-chain STRINGS (single
 * input stream segments) plus the filters required, for the engine's export
 * plan to embed. Nothing here spawns ffmpeg; availability is decided by the
 * probed capabilities the caller passes in.
 *
 * Honesty rules enforced at this boundary (contract):
 * - required filter missing on this machine → UNSUPPORTED_FEATURE + hint
 * - keyframed effect params → UNSUPPORTED_FEATURE + hint (streams exist via
 *   sampleParamStream for a future per-frame export plan; v1 must not pretend)
 * - disabled instances are skipped (they are inert by data, not a fake control)
 */

import {
  assertFiltersAvailable,
  type FfmpegCapabilities,
} from './capabilities.js';
import { fail } from './errors.js';
import { effectAvailability, getEffect, instanceParamsAreConstant, resolveEffectParams } from './effects/registry.js';
import { buildMaskChain } from './masks.js';
import type {
  ClipLike,
  EffectContext,
  EffectInstance,
  Keyframe,
  MaskSpec,
  ResolvedParams,
} from './types.js';

export interface BuiltChain {
  /** Comma-joined ffmpeg filter chain for one video stream. '' = passthrough. */
  chain: string;
  requiredFilters: string[];
}

/**
 * Chain for a clip's enabled effects. Consecutive effects sharing a
 * `mergeKey` (e.g. all `eq`-based color controls) are merged into ONE filter
 * call so brightness+contrast+saturation cost a single eq.
 */
export function buildEffectChain(
  instances: readonly EffectInstance[],
  keyframes: readonly Keyframe[],
  ctx: EffectContext,
  caps: FfmpegCapabilities,
): BuiltChain {
  interface Segment {
    mergeKey?: string;
    effectId: string;
    params: ResolvedParams;
    required: Set<string>;
    render(): string;
  }
  const segments: Segment[] = [];

  for (const inst of instances) {
    if (!inst.enabled) continue;
    const def = getEffect(inst.effectId);
    const params = resolveEffectParams(inst.effectId, inst.params);

    // Keyframed effect params: preview animates, export v1 refuses honestly.
    const keyframedParams = def.params.filter(
      (p) =>
        p.type === 'number' &&
        keyframes.some((k) => k.prop === `effect.${inst.id}.${p.id}`),
    );
    if (keyframedParams.length > 0) {
      fail('UNSUPPORTED_FEATURE',
        `Effect "${def.name}" has keyframed parameters, which cannot be exported yet.`,
        `Remove keyframes from ${keyframedParams.map((p) => `${def.name}.${p.label}`).join(', ')} (the preview animates them; per-frame export streams are planned).`,
        { effectId: def.id, instanceId: inst.id });
    }

    assertFiltersAvailable(def.export.requiredFilters, caps, def.name);
    if (def.export.gate) {
      const hint = def.export.gate(params);
      if (hint) {
        fail('UNSUPPORTED_FEATURE', `Effect "${def.name}" cannot be exported with the current parameters.`, hint);
      }
    }

    const last = segments[segments.length - 1];
    if (last && def.mergeKey && last.mergeKey === def.mergeKey) {
      last.params = { ...last.params, ...params };
      for (const f of def.export.requiredFilters) last.required.add(f);
    } else {
      const seg: Segment = {
        mergeKey: def.mergeKey,
        effectId: def.id,
        params,
        required: new Set(def.export.requiredFilters),
        render: () => def.export.toChain(seg.params, ctx),
      };
      segments.push(seg);
    }
  }

  const chains = segments.map((s) => s.render()).filter((c) => c.length > 0);
  const requiredFilters = new Set<string>();
  for (const s of segments) for (const f of s.required) requiredFilters.add(f);
  return { chain: chains.join(','), requiredFilters: [...requiredFilters] };
}

/** Chain for a clip's mask (applied AFTER effects). Null when no mask. */
export function buildClipMaskChain(mask: MaskSpec | null | undefined): BuiltChain | null {
  if (!mask) return null;
  const built = buildMaskChain(mask);
  return { chain: built.chain, requiredFilters: built.requiredFilters };
}

/** Effects chain + mask chain for one clip, in application order. */
export function buildClipVideoChain(
  clip: Pick<ClipLike, 'effects' | 'mask'>,
  ctx: EffectContext,
  caps: FfmpegCapabilities,
): BuiltChain {
  const keyframes = 'keyframes' in clip ? (clip as ClipLike).keyframes : [];
  const fx = buildEffectChain(clip.effects ?? [], keyframes, ctx, caps);
  const mask = buildClipMaskChain(clip.mask);
  if (!mask) return fx;
  return {
    chain: [fx.chain, mask.chain].filter(Boolean).join(','),
    requiredFilters: [...new Set([...fx.requiredFilters, ...mask.requiredFilters])],
  };
}

/* ---------- transform mapping (rotate/scale/opacity per-stream) ---------- */

export interface BuiltTransformChain {
  chain: string;
  requiredFilters: string[];
  /** Overlay-position expression pair for the compositor (x, y). */
  position: { xExpr: string; yExpr: string };
}

/**
 * Per-stream transform chain: rotation + uniform scale + opacity.
 * Position (x/y) is a compositor concern (overlay offsets) — the returned
 * position expressions place the transformed clip at the contract's
 * center-origin offsets so the export plan can feed `overlay=x=…:y=…`.
 * Keyframed transforms are NOT mapped here (export v1 rejects them in the
 * engine plan); sampleParamStream() provides per-frame values for later.
 */
export function buildTransformChain(
  transform: Required<{ x: number; y: number; scale: number; rotationDeg: number; opacity: number }>,
  caps: FfmpegCapabilities,
): BuiltTransformChain {
  const parts: string[] = [];
  const required = new Set<string>();
  if (transform.rotationDeg % 360 !== 0) {
    assertFiltersAvailable(['rotate'], caps, 'Clip rotation');
    const rad = (transform.rotationDeg * Math.PI) / 180;
    parts.push(`rotate=a=${Number(rad.toFixed(6))}:c=none:ow=iw:oh=ih`);
    required.add('rotate');
  }
  if (Math.abs(transform.scale - 1) > 1e-9) {
    assertFiltersAvailable(['scale'], caps, 'Clip scale');
    parts.push(`scale=iw*${Number(transform.scale.toFixed(6))}:ih*${Number(transform.scale.toFixed(6))}`);
    required.add('scale');
  }
  if (transform.opacity < 1 - 1e-9) {
    assertFiltersAvailable(['format', 'colorchannelmixer'], caps, 'Clip opacity');
    parts.push(`format=rgba,colorchannelmixer=aa=${Number(transform.opacity.toFixed(6))}`);
    required.add('format');
    required.add('colorchannelmixer');
  }
  // Contract: x/y are pixels from program center; after scaling, the overlay
  // filter's own w/h are the scaled size, so center + offset is:
  const xExpr = `(main_w-overlay_w)/2+${transform.x}`;
  const yExpr = `(main_h-overlay_h)/2+${transform.y}`;
  return {
    chain: parts.join(','),
    requiredFilters: [...required],
    position: { xExpr, yExpr },
  };
}

/* ---------- preflight (non-throwing) ---------- */

export interface ClipExportBlocker {
  clipId: string;
  feature: string;
  code: 'UNSUPPORTED_FEATURE' | 'INVALID_ARGUMENT';
  reason: string;
}

/**
 * Non-throwing availability scan of one clip's effects/mask/transition/speed
 * for the export dialog's preflight list (Agent 2's request pattern: warn
 * BEFORE the run). Consumes the proposed Clip extensions when present.
 */
export function clipExportBlockers(
  clip: ClipLike,
  caps: FfmpegCapabilities,
): ClipExportBlocker[] {
  const out: ClipExportBlocker[] = [];
  for (const inst of clip.effects ?? []) {
    if (!inst.enabled) continue;
    const av = effectAvailability(inst.effectId, caps);
    if (!av.export) {
      out.push({
        clipId: clip.id,
        feature: `effect:${inst.effectId}`,
        code: 'UNSUPPORTED_FEATURE',
        reason: av.reason ?? 'Effect not exportable on this machine.',
      });
    }
    if (!instanceParamsAreConstant(clip, inst)) {
      out.push({
        clipId: clip.id,
        feature: `keyframed-effect:${inst.id}`,
        code: 'UNSUPPORTED_FEATURE',
        reason: 'Keyframed effect parameters cannot be exported yet (preview animates them).',
      });
    }
  }
  if (clip.mask) {
    const missing = ['format', 'geq'].filter((f) => !caps.filters.has(f));
    if (missing.length > 0) {
      out.push({
        clipId: clip.id,
        feature: 'mask',
        code: 'UNSUPPORTED_FEATURE',
        reason: `This ffmpeg build lacks the ${missing.join(', ')} filter required for masks.`,
      });
    }
  }
  return out;
}
