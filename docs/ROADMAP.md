# ROADMAP.md — delivery roadmap + feature matrix

> Maintained by **Agent 1**; both agents append rows. Status vocabulary:
> **Implemented** (verified by our own tests/demo — evidence: Observed), **Partial** (works with documented limits), **Planned** (designed, not built), **Blocked** (external dependency), **Disabled** (intentionally off pending owner approval).
> Evidence labels per charter: **Observed** (verified in this repo/env), **Documented** (public documentation of the feature category — no parity claim), **Inferred**, **Designed**.
> No feature is listed as working without a test or demo proving it. Placeholders never appear as functional.

## Phase 0 — foundation (2026-10-15, Agent 1) — DONE

| # | Feature | Status | Evidence | Owner | Notes / acceptance criteria |
|---|---------|--------|----------|-------|----------------------------|
| 1 | Project create / save / atomic write / reopen (`.veproj` JSON) | Implemented | Observed — `persistence.test.ts`, demo run | A1 | Atomic tmp+rename; schema validation with clear errors |
| 2 | Asset import via ffprobe (video/audio/image classification, metadata) | Implemented | Observed — `media-export.test.ts` | A1 | kind + duration + streams + fps captured into `Asset.meta` |
| 3 | Asset-reference recovery on reopen (abs path → relPath → shallow search) + relink API | Implemented | Observed — `persistence.test.ts` (moved-folder scenario) | A1 | missing → runtime status only; relink verifies name/size |
| 4 | Multitrack timeline ops: add/remove/rename/lock/mute tracks; add/split/trim(in-out,ripple)/move(cross-track,overwrite)/duplicate/remove clips | Implemented | Observed — `ops.test.ts` (12 cases) | A1 | Non-destructive; overlap policy reject/overwrite; locked-track guard |
| 5 | Text clips (data model + timeline ops) | Implemented | Observed — `ops.test.ts` | A1 | Text assets stored inline in project file |
| 6 | Undo/redo (snapshot history, gesture batching, dirty tracking) | Implemented | Observed — `store.test.ts` | A1 | 100 entries default; batches = 1 entry |
| 7 | Export → ffmpeg with progress, cancellation, temp-file promotion, honest capability gating | Implemented (single-audio + video-track compositing; see limits) | Observed — `media-export.test.ts`, demo run | A1 | Progress monotonic; cancel leaves no partial file |
| 8 | Capability probe (ffmpeg version/filters/encoders) | Implemented | Observed | A1 | `textBurnIn=false` on this machine (Homebrew build lacks libfreetype) |
| 9 | Engine↔UI contract + IPC dispatcher (`window.ve` shape) | Implemented (engine side) | Observed — `api.ts`, `dispatcher.ts` | A1 | UI wiring pending Agent 2 |
| 10 | AI/cloud provider interfaces (unconfigured stubs only) | Implemented (disabled by design) | Observed — `providers.status()` all unavailable | A1 | No network I/O exists in v1 |

### Export v1 limits (documented, enforced by UNSUPPORTED_FEATURE errors)

Speed ≠ 1 · keyframes · rotation ≠ 0 · audio pan ≠ 0 · text burn-in (blocked on ffmpeg build; see #8). Multi-clip audio uses `amix normalize=0` (sums; no ducking). Timeline→frame-grid quantization < 1 frame.

## Phase 1 — first usable editor (next)

| # | Feature | Status | Owner | Dependencies |
|---|---------|--------|-------|--------------|
| 11 | Electron shell: main/preload/renderer, `window.ve` wiring | Planned | A2 (proposal in TEAM_STATUS; A1 can scaffold on request) | #9 |
| 12 | Project home/library (recent projects, create/open) | Planned | A2 | #1, recent API |
| 13 | Media bin + import UI + missing-file relink flow | Planned | A2 | #2, #3 |
| 14 | Multitrack timeline UI (drag, trim handles, split, snapping via `time.*` helpers, keyboard) | Planned | A2 | #4, #9 |
| 15 | Preview monitor (HTML5 video composition preview; text as DOM overlay) | Planned | A2 | #9 (Inferred: browser preview sufficient for v1; engine frame-accurate preview later) |
| 16 | Inspector (volume/fades, transform, text styling) | Planned | A2 | #4, #5 |
| 17 | Export dialog (presets, progress, cancel, error hints) | Planned | A2 | #7, #8 |
| 18 | Autosave UI (background indicator, recovery prompt on open) | Planned | A2 | autosave API done |

## Phase 2 — richer media & audio

Waveform peaks API (planned, A1) · speed changes (schema ready; engine + export support planned) · keyframe evaluation + export (schema ready) · transitions (schema addition + export) · clip rotation on export · text burn-in (either ffmpeg-with-freetype detection or renderer-rasterized PNG overlay path — **Designed**) · captions from SRT import · voiceover recording (A2+OS) · noise cleanup/speech tools (provider-gated) · pan rendering.

## Phase 3 — creative tooling

Effects/filters/color adjustments · masks · stickers (user-supplied PNG assets) · templates/reusable project snippets · scene detection (provider-gated) · filler-word removal (provider-gated) · transcription/captions (provider-gated).

## Phase 4 — optional accounts/cloud/publishing (owner approval required)

Cloud project sync · collaboration · publishing integrations — all behind provider interfaces; **Disabled** until explicit approval (charter: no uploads/paid services without owner sign-off).

## Platform & dependency notes

- Platform: Electron desktop, macOS first (**Designed**, rationale in PROJECT_CONTRACT).
- Runtime dependencies added so far: **zero**. Dev-only: `typescript@5.9.3` (Apache-2.0). External tools: system ffmpeg/ffprobe 8.1.1 (GPL build — we spawn it as a subprocess, we do not link/redistribute it).
- Research note (**Documented**, to verify when building UI): keep an eye on Electron distribution size (~100–200 MB) and licensing (Electron = MIT; Chromium/BSD parts fine for local use).
