# FEATURE_MATRIX.md — feature inventory, status, dependencies, acceptance, evidence

Evidence labels: **Observed** (verified by running locally) · **Documented** (public product docs) · **Inferred** · **Designed** (our design).
Status values: `Planned` · `In progress (unverified)` (code exists, no acceptance run) · `Implemented` (acceptance passed) · `Capability-gated` (honest disabled with real reason).
Platform for Phase 1+ = macOS first (Designed); core is platform-neutral TypeScript.

## Phase 1 — end-to-end local editing workflow

| Feature | Status | Platform | Dependencies | Acceptance criteria | Evidence |
|---|---|---|---|---|---|
| Create project; persist `.veproj`; reopen with state intact | In progress (unverified) | macOS | @ve/engine persistence (landed) | Kill/reopen restores tracks/clips/settings | Designed |
| Autosave / dirty indicator | Planned | macOS | store dirty flag, events | No explicit save loses no committed edit | Designed |
| Import video/audio/image with ffprobe metadata | In progress (unverified) | macOS | ffmpeg/ffprobe 8.1.1 (Observed), `test-media/` fixtures (Observed) | duration, fps, resolution, codecs, hasAudio correct vs ffprobe | Observed (fixtures) / Inferred (code) |
| Asset references; missing detection; relink | Planned | macOS | persistence schema | Delete file → honest missing state; relink restores | Designed |
| Multitrack timeline renders placed media | In progress (unverified) | macOS | timeline view (claim: Agent 2 team-2), engine ops | Video/audio/image/text tracks visibly placed, zoomed, scrolled | Designed |
| Preview monitor: play/seek | Planned | macOS | playback engine (contract: engine-driven v1) | Playhead moves; seek lands on correct frame (±1 frame) | Designed |
| Trim, split, move, duplicate clips | In progress (unverified) | macOS | `ops/timeline.ts` (partial pass in review #1) | Ops respect bounds/overlap/locked rules; undo restores | Observed (code review) |
| Text/caption overlay visible in preview | In progress (unverified) | macOS | HTML overlay layer (no ffmpeg freetype) | Text renders over video in preview at correct time | Designed |
| Basic audio: volume/fade apply to export | Planned | macOS | ffmpeg `volume`/`afade` filters (Observed) | Audible difference A/B on exported file | Observed (filters present) |
| Export playable file, real progress %, cancel, readable errors | In progress (unverified) | macOS | `export/plan.ts` + `export/runner.ts` (landed, unverified) | MP4 plays in QuickTime; cancel stops ffmpeg; failure shows actionable message | Inferred |
| Text burn-in on export | Capability-gated | macOS | ffmpeg build w/o freetype (Observed) | Control disabled with real reason; sidecar/SRT or preview-only alternative stated | Observed |
| Reopen recovers asset references | Planned | macOS | persistence + relink | See relink row | Designed |
| Honest states (no fake-functional controls) | In progress (unverified) | macOS | states library, capabilities API | Every unavailable control shows why | Observed (review #1 partial) |

## Phase 2 — editing depth (Planned)

| Feature | Status | Dependencies | Evidence |
|---|---|---|---|
| Transitions (crossfade etc.) | Planned | compositor (`resolveAt` reference in attic) | Documented (public feature) |
| Keyframes: transform/opacity/volume/effects | Planned | `ops/keyframes.ts` (evaluator semantics ported from attic draft) | Documented; evaluator Designed (attic, tested in Dart — unported) |
| Speed change / ramping | Planned | time remap in compositor | Documented |
| Snapping polish, markers | Planned | timeline view | Documented |
| Masks + color adjustment | Planned | ffmpeg filters (subset Observed) | Documented |
| Effects/filters library (original) | Planned | ffmpeg filter set (Observed: overlay, scale, fps, color…) | Documented |
| Stickers (original/generated assets) | Planned | asset pipeline | Documented |
| Caption/subtitle styling | Planned | text overlay + export path | Documented |

## Phase 3 — audio & captions (Planned)

| Feature | Status | Dependencies | Evidence |
|---|---|---|---|
| Waveform display | Planned | peaks extraction (ffmpeg/astats — unverified) | Documented |
| Voiceover recording | Planned | mic capture (Electron) | Documented |
| Music bed / loop controls | Planned | audio tracks | Documented |
| Noise cleanup | Planned | ffmpeg filters (local set Observed; afftdn unverified) | Documented |
| Speech transcription → captions | Planned | local STT provider interface (no provider approved) | Documented |
| Speech tools (isolate/enhance) | Planned | provider interface, owner approval for paid services | Documented |

## Phase 4 — templates & AI tools (Planned; all provider-gated)

| Feature | Status | Dependencies | Evidence |
|---|---|---|---|
| Templates / reusable assets | Planned | project schema | Documented |
| Auto-reframe | Planned | provider interface + owner approval | Documented |
| Background removal | Planned | provider interface + owner approval | Documented |
| Scene/clip search | Planned | provider interface | Documented |
| Filler-word removal | Planned | transcription dep + provider | Documented |
| Script-to-video | Planned | provider interface + owner approval | Documented |
| Voice generation | Planned | provider interface + owner approval | Documented |

## Phase 5 — accounts, cloud, collaboration, publishing (Planned; owner approval gate)

| Feature | Status | Dependencies | Evidence |
|---|---|---|---|
| Optional accounts | Planned | auth provider (none approved) | Documented |
| Cloud projects + sync | Planned | storage provider; upload approval | Documented |
| Collaboration | Planned | sync foundation | Documented |
| Publishing integrations | Planned | external APIs; approval | Documented |

## Out of scope / constraints (honest disclosure)

- No copied proprietary code, branding, or assets; product identity is original (working names in use: **Reelwright** in app shell; "Reelforge" was a superseded team-2 draft name) — any final rename is an owner decision.
- REA MCP not connected; no REA-based observation performed (Observed).
- Local ffmpeg lacks freetype/libass (Observed) — text burn-in blocked here regardless of UI.
