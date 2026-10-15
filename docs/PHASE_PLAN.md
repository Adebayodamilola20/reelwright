# PHASE_PLAN.md — staged delivery plan + coordinator review gates

Owner of this document: **Coordinator** (final review authority over all agents' code).
Agents may read this; changes require a note in `docs/TEAM_STATUS.md`.

## Governing rule

The product vision is full, CapCut-breadth coverage **built entirely from scratch** — original code, original identity, original assets, no copied proprietary code or branding. Delivery is phased; no phase may be called a "complete recreation" without evidence (charter rule).

---

## PHASE 1 — End-to-end local editing workflow (CURRENT)

Definition = charter delivery steps 1–6. Acceptance criteria (coordinator verifies by running the app):

- [ ] Create a project; it persists to disk and reopens with state intact.
- [ ] Import video, audio, and image files (ffprobe metadata: duration, fps, resolution, codecs).
- [ ] Multitrack timeline renders placed media; preview monitor plays/seeks.
- [ ] Trim and split clips work; a text/caption overlay can be added and is visible in preview.
- [ ] Basic audio adjustment (volume/fade) applies to export.
- [ ] Export produces a playable file via ffmpeg with real progress %, working cancel, and readable errors on failure.
- [ ] Reopen recovers asset references; missing files are detected and relinkable (or clearly reported).
- [ ] UI shows honest states: no placeholder control ever appears functional (charter rule).
- [ ] `docs/PROJECT_CONTRACT.md` matches the implemented engine↔UI interface.
- [ ] `docs/` roadmap + feature matrix exist with Observed/Documented/Inferred/Designed labels.
- [ ] Coordinator code review passed (see gate below).

**Review gate (my higher-authority pass over agent code):**
1. `git log`/`diff` over all changes — read every non-trivial file.
2. Verify contract conformance: UI consumes engine through documented API only; no ownership violations.
3. Run the app myself; execute every acceptance check; test error paths (bad file, missing asset, cancel mid-export).
4. Originality scan: no copied branding/strings/assets from CapCut or others.
5. Dependency/license check on anything added.
6. Findings go in `docs/REVIEW_LOG.md`; agents must fix before phase close.

## PHASE 2 — Editing depth

Transitions, keyframes (transforms/effects), speed changes/ramping, snapping polish, duplicate/replace/arrange flows, undo/redo completeness, masks + basic color adjustment, filters/effects library (original), stickers (original/generated), caption styling.

## PHASE 3 — Audio & captions

Waveform display, voiceover recording, music bed controls, noise cleanup (ffmpeg-based), speech transcription (local, opt-in), caption/subtitle generation + styling, speech tools behind explicit provider interface.

## PHASE 4 — Templates & AI-assisted tools

Templates/reusable assets; AI: reframe, background removal, scene/clip search, filler-word removal, script-to-video, voice generation — **each behind a provider interface, disabled with an accurate reason until approved/licensed** (charter: no paid services or uploads without project-owner approval).

## PHASE 5 — Accounts, cloud, collaboration, publishing

Optional accounts, cloud projects, sync, collaboration, publishing integrations. Requires explicit project-owner approval before any network upload or paid service.

---

## Status tracking

Phase status lives in the feature matrix (`docs/FEATURE_MATRIX.md` if present, else roadmap doc). Phase closure is declared only by the coordinator after the review gate passes.
