# @ve/effects — effects, transitions, keyframes, speed, masks, stickers

Phase 2 package (owner: Agent 2.5, per `docs/PHASE_PLAN.md` parallelization).
Pure TypeScript, **zero runtime dependencies**, no DOM/Electron imports — the
only external call is the one ffmpeg capability probe. Tests: `npm run build -w @ve/effects && npm test -w @ve/effects` (node:test, 85 tests green — Observed 2026-10-15).

## Core rules (from charter/contract)

- **Honest capability gating:** every export mapping declares required ffmpeg
  filters; export against probed capabilities throws `UNSUPPORTED_FEATURE` +
  actionable hint when unavailable — never a silent drop. Controls whose
  export path is unavailable must show their `reason` in the UI
  (`effectAvailability()` / `clipExportBlockers()`).
- **Two render paths per effect:** (a) preview = serializable `PreviewOp`
  plans executed by the UI with CSS filters/canvas (pure reference math in
  `preview.ts`, unit-tested in Node); (b) export = ffmpeg filter-chain
  segment + required-filter list, embedded by `@ve/engine`'s export plan.
- **Originality:** all effect math, sticker SVGs, and preset recipes are
  written from scratch here. No copied code/branding/assets.

## Environment probe evidence (Observed, 2026-10-15, local ffmpeg 8.1.1)

Probed with `ffmpeg -filters` / `ffmpeg -h filter=xfade` (the probe itself is
`capabilities.probeFfmpegCapabilities()`, asserted by a live test):

| Needed by | Filters | Present |
|---|---|---|
| blur | `gblur` | Observed ✅ |
| sharpen | `unsharp` | Observed ✅ |
| brightness/contrast/saturation | `eq` | Observed ✅ |
| grayscale | `hue` | Observed ✅ |
| sepia / duotone / opacity | `colorchannelmixer` (incl. `aa`) | Observed ✅ |
| vignette | `vignette` | Observed ✅ |
| invert | `negate` | Observed ✅ |
| pixelate / scale | `scale` | Observed ✅ |
| temperature | `colortemperature` | Observed ✅ |
| chromatic aberration | `rgbashift` | Observed ✅ |
| masks | `format`, `geq` | Observed ✅ (probe-verified expressions) |
| transitions | `xfade` (+ `fade, fadeblack, fadewhite, wipeleft/right/up/down`), `concat`, `acrossfade` | Observed ✅ |
| speed | `setpts`, `atempo` | Observed ✅ |
| transform | `rotate`, `scale`, `pad` family | Observed ✅ (`rotate`+`aa` probe-verified) |
| stickers | *(no SVG rasterizer)* | **absent → capability-gated OFF** |

## Effects library (13) — effect → preview → export → availability

Parameter values are clamped to their ranges at resolution
(`resolveEffectParams`); all numbers formatted to ≤4 decimals for ffmpeg.

| Effect | Params (default) | Preview (renderer executes) | Export chain (ffmpeg) | Availability gate |
|---|---|---|---|---|
| `blur` | sigma 8 (0–64) | `cssFilter: blur(σpx)` — CSS blur length IS Gaussian σ, 1:1 (Designed) | `gblur=sigma=σ` | needs `gblur` |
| `sharpen` | amount 0.5 (0–3) | `convolve` 3×3 unsharp kernel (center 1+4a) — approximation of unsharp (Designed) | `unsharp=5:5:a:5:5:0.0` | needs `unsharp` |
| `brightness` | brightness 0 (−1..1) | `cssFilter: brightness(1+2×v)` — designed mapping from additive eq scale (approximate) | `eq=brightness=v` | needs `eq` |
| `contrast` | contrast 1 (0–3) | `cssFilter: contrast(v)` — identical formula (Designed, 1:1) | `eq=contrast=v` | needs `eq` |
| `saturation` | saturation 1 (0–3) | `cssFilter: saturate(v)` — 1:1 (Designed) | `eq=saturation=v` | needs `eq` |
| `grayscale` | amount 1 (0–1) | `cssFilter: grayscale(v)` | `hue=s=(1−v)` | needs `hue` |
| `sepia` | amount 1 (0–1) | `cssFilter: sepia(v)` — W3C sepia matrix = export matrix (1:1) | `colorchannelmixer` sepia matrix blended by amount | needs `colorchannelmixer` |
| `invert` | on = true | `cssFilter: invert(1\|0)` | `negate` (full invert only; partial is Planned) | needs `negate` |
| `vignette` | strength 0.5 (0–1) | `radialVignette` radial-gradient overlay string | `vignette=a=(π/4 × strength)` (0 = none) | needs `vignette` |
| `pixelate` | block 12 (2–64) | `pixelate` — canvas drawImage down/upscale, smoothing off | `scale=trunc(iw/b/2)*2:…:flags=bicubic,scale=WxH:flags=neighbor` | needs `scale` |
| `temperature` | value 0 (−1..1, + = warmer) | `channelMatrix` RGB gains (±0.18×v) — approximation (Designed) | `colortemperature=temperature=K`, K = 6500 − v×3500. **Direction measured (Observed):** 3000K warms, 10000K cools on this build | needs `colortemperature` |
| `duotone` | dark `#0b1d36`, light `#ffd166` | `channelMatrix` — SAME matrix as export (near-exact match, Rec.709 luma) | `colorchannelmixer` 3×3 from the two colors | needs `colorchannelmixer` |
| `chromatic` | shift 2 (0–10 px) | `channelShift` + reference impl `channelShiftRgb` (R left, B right) | `rgbashift=rh=-d:bh=d` | needs `rgbashift` |

**Merge optimization:** consecutive `brightness/contrast/saturation`
instances (same `mergeKey: 'eq'`) collapse into ONE `eq=…:…:…` call.

**Preview plan contract for Agent 2** (`buildPreviewPlan(instances, ctx, caps?)`):
each entry = `{ instanceId, effectId, name, available: { preview: true,
export, reason? }, ops: PreviewOp[] }`. Without `caps` export is reported
optimistically-free (no claim made); with `caps` the UI can render honest
"preview only" badges. `PreviewOp` union lives in `src/types.ts`;
reference math: `convolve3x3`, `channelShiftRgb`, `applyChannelMatrix`.

## Transitions — cut / fade / dip-to-color / wipe

Data model (`Transition { kind, duration, color?, direction? }`) + window math
(`transitionWindow`) + export planning (`buildTransitionExportPlan`), all unit-tested.

- **Geometry (Designed, v1):** transition sits at an *abutting* boundary;
  region = `duration` ticks ending at the boundary; it consumes the outgoing
  tail D and incoming head D → program duration = Σclips − D. Non-abutting
  inputs fail `INVALID_ARGUMENT` with hint (overlap geometry = Planned with
  the contract's overlap policy).
- **Export mapping (Observed filters):**
  | kind | video | audio |
  |---|---|---|
  | cut | `concat` | `concat` |
  | fade | `xfade=transition=fade:duration=D:offset=0` (tail input is exactly D long) | `acrossfade=d=D` |
  | wipe left/right/up/down | `xfade … wipeleft/wiperight/wipeup/wipedown` | `acrossfade` |
  | dipToColor black/white | `xfade … fadeblack / fadewhite` | `acrossfade` |
  | dipToColor *other color* | **UNSUPPORTED_FEATURE + hint** (preview supports any color; export blocked rather than silently wrong) | — |
- **Preview ops:** `switch` | `crossfade {durationSec, color}` | `wipe {durationSec, direction}`.
- Gating: missing `xfade` or missing xfade transition name → `UNSUPPORTED_FEATURE`
  with the specific filter/transition named (`assertXfadeTransitionAvailable`).

## Keyframes (evaluator — the engine's export path can consume this)

- `evaluatePropAt(keyframes, prop, at, base)` — clamp-before-first /
  after-last, segment curve from the **left** keyframe, duplicate times: last
  wins. Easing set from the contract: `linear, easeIn(t)=t²,
  easeOut=1−(1−t)², easeInOut=quadratic midpoint, hold=step` (Defined in
  `easing.ts`; semantics **Designed** — proposed as normative text in the
  contract review notes).
- `sampleParamStream({keyframes, prop, base, fps, start, duration})` →
  `[{frame, at, value}]` per frame using integer tick frame durations
  (NTSC-exact: 30000/1001 → 2,354,352 ticks — unit-tested).
- `resolveClipParamsAt(clip, at)` → keyframe-evaluated
  `{x, y, scale, rotationDeg, opacity, volume}` (contract defaults when no
  transform stored).
- Effect params keyframe via proposed prop path `effect.<instanceId>.<paramId>`
  (`effectProp`/`parseEffectProp`); `resolveInstanceParamsAt` animates preview;
  export v1 **refuses keyframed effect params** (`UNSUPPORTED_FEATURE` + hint)
  — honest until a per-frame plan lands.

## Speed

- Math: `sourceTicksAt`, `sourceSpanTicks`, `timelineTicksForSource`
  (contract model: source span = duration × speed).
- Export: `speedExportPlan` → video `setpts=PTS*d/n`, audio `atempo` chain
  decomposed into [0.5, 2.0] factors (4× → `atempo=2,atempo=2`; unit-tested
  product round-trip). 1× returns an empty plan (skip). Bounds: (1/16 … 16] ×.
- **Ramping: Planned** (constant speed per clip only, matching `Clip.speed`).

## Masks

- `MaskSpec { shape: rect|ellipse, cx, cy, rx, ry (normalized), feather, invert }`.
- Export chain: `format=rgba,geq=r='p(X,Y)':g='p(X,Y)':b='p(X,Y)':a='<expr>'`
  — geq requires rgb expressions even for alpha-only work (Observed: identity
  `p(X,Y)` preserves RGB). Feather = linear falloff `(1−d)/feather`;
  hard edge via `between()`/`lte()`. **All four expression shapes executed
  against real ffmpeg frames in probes** (center 255 / corner 0 / monotonic).
- Preview: `maskPreview` returns an SVG path + `featherPx` (UI blurs the mask
  for feather). Presets: `MASK_PRESETS` (circle/oval/rect).
- Gate: needs `format` + `geq`.

## Stickers (original procedural SVG)

`star, burst, arrow, speechBubble, badge, sparkle` — generated from first
principles (polygon/star/arc math in `stickers.ts`), parametric colors/counts.
- Preview: render `stickerSvg(id, params)` in the renderer — works today.
- Export: **capability-gated OFF** — `assertStickerExportable()` throws
  `UNSUPPORTED_FEATURE`: no SVG rasterizer in the pipeline yet (planned path:
  renderer-rasterized PNG → engine `overlay`). The UI must show the sticker
  control as preview-only with this reason.

## Filter presets (original recipes)

`warm-film, cold-tone, noir, vivid, soft-glow, aged-paper` — instantiate via
`instantiatePreset(id)` → validated `EffectInstance[]` (fresh instance ids for
keyframe targeting). Unknown preset/effect ids → `NOT_FOUND` + known list.

## Transform export mapping (for Agent 1's compositor)

`buildTransformChain(transform, caps)` → per-stream chain
(`rotate` → `scale` → `format=rgba,colorchannelmixer=aa=`) plus overlay
position expressions `(main_w-overlay_w)/2 + x` for the compositor.
Gate: rotation needs `rotate` (Observed present); keyframed transforms are
**not** mapped here — engine export v1 rejects them; `sampleParamStream` is
the extension point for a future per-frame plan.

## Preflight for the export dialog

`clipExportBlockers(clip, caps)` → non-throwing list
`[{clipId, feature, code, reason}]` covering missing filters, keyframed
effect params, and masks — feed this to the export dialog so the user sees
blockers *before* starting a run.

## Package layout

```
src/
├── types.ts            # contract mirrors (ClipLike, Keyframe, …) + package types
├── errors.ts           # EffectsError → EngineErrorShape-compatible
├── ticks.ts            # minimal tick helpers (mirror; convergence proposed)
├── easing.ts           # contract easing set
├── keyframes.ts        # evaluator + per-frame streams + clip resolution
├── speed.ts            # remap math + setpts/atempo plan
├── capabilities.ts     # ffmpeg probe + availability gates
├── transitions.ts      # boundary model + window math + xfade plans
├── masks.ts            # geq expressions + SVG preview + presets
├── stickers.ts         # original procedural SVGs + export gate
├── presets.ts          # filter presets
├── preview.ts          # pure pixel math + PreviewOp plan builder
├── export-chain.ts     # chain builders + preflight blockers
└── test/               # 85 node:test cases
```

## Known gaps (honest status)

- Keyframed effect/transform params: preview ✅, export ❌ (refused with hint;
  stream API ready for a future plan) — *Partial*.
- Speed ramping, overlapping-clip transitions, dip-to-color export beyond
  black/white, sticker burn-in, partial invert — *Planned / Capability-gated*
  (see `docs/FEATURE_MATRIX.md`).
- Package is standalone (structural contract mirrors); type-only import
  convergence with `@ve/engine` proposed in the contract review notes.
