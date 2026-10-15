# ROADMAP.md — master product roadmap (owner: coordinator)

Purpose: track the full feature inventory the product grows toward, with evidence
labels per charter: **Observed** (seen working), **Documented** (official public
source), **Inferred** (reasoned, unverified), **Designed** (our own decision).
Target breadth = CapCut's publicly documented workflow set; all implementations
original. Never claim parity without evidence.

Evidence source for the "CapCut public feature set" section: capcut.com homepage
+ linked tool pages, fetched 2026-10-15 (**Documented**).

---

## Section A — Core editing (our phases 1–2)

| Feature | Phase | Status | Evidence |
|---|---|---|---|
| Project create/save/reopen/relink | 1 | In progress (Agent 1) | Designed |
| Asset import + ffprobe metadata | 1 | In progress | Designed |
| Multitrack timeline + preview monitor | 1 | In progress (Agents 1+2) | Designed |
| Trim/split/move clips, snapping | 1 | In progress | Designed |
| Text overlay + caption data model | 1 | In progress | Designed |
| Export via ffmpeg, progress/cancel/errors | 1 | In progress | Designed |
| Volume/fades basic | 1 | In progress | Designed |
| Effects library (color, blur, stylize…) | 2 | In progress (Phase 2 agent) | Designed |
| Transitions (cut/fade/wipe/dip) | 2 | In progress | Designed |
| Keyframe evaluation + easing | 2 | In progress | Designed |
| Speed changes, masks, stickers | 2 | Planned | Designed |

## Section B — Audio & captions (phase 3)

| Feature | Phase | Status | Evidence |
|---|---|---|---|
| Waveform display | 3 | In progress (Phase 3 agent) | Designed |
| Sidecar SRT caption export | 3 | In progress | Designed |
| Noise cleanup (ffmpeg) | 3 | In progress | Designed |
| Voiceover capture path | 3 | In progress | Designed |
| Transcription (provider-gated) | 3 | In progress (stub honest-off) | Designed |

## Section C — CapCut public feature set (Documented, capcut.com 2026-10-15)

Research inventory the matrix must cover over successive releases. Status values:
`Planned | Partial | Implemented | Out-of-scope (owner decision)`.

### Text & Audio
- [ ] Auto captions / caption templates — Documented
- [ ] Speech recognition (sound→text) — Documented
- [ ] Text to speech + custom voices — Documented (provider interface; needs owner approval for any service)
- [ ] Voice enhance, reduce noise — Documented (noise: Phase 3; enhance: Planned)
- [ ] Extract audio from video — Documented (ffmpeg trivial; Planned)

### Video editing
- [ ] Cut/trim/transitions/subtitles HD export, no watermark — Documented (Phase 1 core)
- [ ] Video converter (format transcode) — Documented (export contract covers; Planned phase 5 polish)
- [ ] Video background removal — Documented (Phase 4 AI provider; honest-off until approved)
- [ ] AI video enhancer / quality upscaling — Documented (provider-gated, Planned)
- [ ] Resize/aspect reframing — Documented (transform + program settings; Planned)

### Image
- [ ] Background remover, image enhancer/resizer, photo editor tools — Documented (provider-gated or ffmpeg-based; Planned)

### Templates
- [ ] Template system: reusable project blueprints (social/holiday/effects/business) — Documented (Phase 4) — **we ship ORIGINAL templates only**
- [ ] Effects templates (one-click style packs) — Documented (Phase 4)

### AI creation (all provider-gated; no paid/network services without owner approval)
- [ ] AI video/image generator, AI design, video studio/chat-to-video — Documented (Phase 5 decision gate)
- [ ] Script-to-video, avatar/dialogue scenes — Documented (Phase 5)

### Accounts & cloud (Phase 5, explicit owner approval required)
- [ ] Accounts, cloud projects, sync, collaboration, publishing — Documented (charter phase 5)

## Section D — Explicit non-goals (coordinator rulings)

- Copying CapCut's proprietary assets, effect/template files, branding, or code — **never** (charter).
- "100% identical to CapCut" claims — **never** (evidence rule). Broad workflow coverage with original implementation is the goal.
- Network upload of user media, paid API services — blocked pending owner approval (charter).

---

## Versioning

- Agents append their feature rows' status updates to the matrix (`docs/FEATURE_MATRIX.md`); this roadmap holds phase ownership + research inventory.
- Updated: 2026-10-15 at Phase 2/3 opening.

---

## Section E — M1 execution slices + working agreements (second head)

Phase 1 slice order; **each slice ends GREEN (build + tests) with a `TEAM_STATUS` entry**, and phase close still requires the head-run `PHASE_PLAN.md` checklist:

1. Engine core (model/ops/store/persistence) — landed; acceptance pending.
2. Media ingest + ffprobe metadata (fixtures in `test-media/`) — landed; acceptance pending.
3. Engine façade + IPC (`engine.ts`, `ipc/dispatcher.ts` → `window.ve`) — landed; acceptance pending.
4. UI shell (home/editor) + honest states — landed; acceptance pending.
5. Timeline view + trim/split interactions — in flight.
6. Preview (HTML text layer + media playback/seek) — pending.
7. Export plan/runner (progress %, cancel, readable errors) — landed; E2E pending (team-2 Agent 1 assigned).
8. Reopen/relink asset recovery — pending.
9. Head acceptance pass over the `PHASE_PLAN.md` checklist.

Standing working agreements: green build at every increment boundary · commit per increment · no concurrent `npm install` · matrix rows become `Implemented` only after a head's acceptance run · honest-disabled controls always (charter).


---

## Section F — Agent 1 (team 1) foundation roadmap + phase-0 acceptance detail

> Added by Agent 1 during repair commit after a path collision overwrote the coordinator's master roadmap (restored in full above from commit `f7283f9`; both documents now live here). Feature *status* rows are authoritative in `docs/FEATURE_MATRIX.md` per Section "Versioning"; this section records what Agent 1 actually verified and the forward plan from the engine side.
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
