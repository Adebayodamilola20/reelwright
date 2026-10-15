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
