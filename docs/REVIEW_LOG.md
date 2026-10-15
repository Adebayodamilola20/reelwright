# REVIEW_LOG.md — review gate (owners: coordinator + second head; each appends their own `## Review N` entries)

Agents read; only the two heads edit. Findings must be resolved before a phase closes.

---

## Review #1 — Phase 1 in-progress sweep (2026-10-15)

Scope: read-only review of repo state, docs coordination, `packages/engine` core, `packages/app` entry.

### Verdict: **healthy, with findings to watch** — no blocking defects found yet.

### What's strong (passes)

1. **Contract discipline (pass).** `PROJECT_CONTRACT.md` v1 is unusually complete: normative tick timebase (70,560,000 ticks/s, NTSC-exact), data shapes mirrored in `types.ts`, overlap/non-destructive semantics, persistence + relink order, honest-capability export rules. Agent 2 reviewed it line-by-line with 11 substantive notes instead of silently diverging — coordination working as intended.
2. **`time.ts` (pass).** Rational fps parsing, integer frame durations, frame floor/ceil with epsilon, exact sample conversion for 44.1/48/96 kHz, non-drop timecode + parser. Matches contract claims; arithmetic is sound.
3. **`store.ts` undo/redo (pass).** Snapshot-based per contract; failed transacts leave history untouched; batch gestures collapse to one entry; dirty tracked by snapshot reference — correct across undo/redo/markSaved cycles. History limit enforced.
4. **`ops/timeline.ts` (pass so far, partial read).** Validates before mutating (locked tracks, asset-kind/track-kind match, overlap policy, media-bounds with 1 ms probe tolerance). Non-destructive by construction. `fail()` with codes+hints matches `EngineErrorShape` contract.
5. **Honesty rules (pass).** `main.ts` runs as an honest shell when `window.ve` is absent (engine controls disabled with reasons); text-burn-in export capability-gated OFF with real reason (local ffmpeg lacks freetype); no fake controls spotted in review.
6. **Original identity.** App named "Reelwright" — original branding, no CapCut assets/strings observed.
7. **Stack convergence.** Second redirected team accepted Electron+TS over their Flutter drafts; drafts preserved in `attic/` rather than deleted. Good conflict handling.

### Findings (watch / act)

- **F1 (process, MEDIUM): zero commits.** Everything is untracked; with 2–4 agents editing a shared tree, review diffs and rollback are impossible. *Coordinator action: baseline checkpoint committed at review time; agents to commit per increment going forward (recorded in TEAM_STATUS).*
- **F2 (schedule, MEDIUM): engine still missing Phase-1 directories.** `persistence/`, `export/`, `ipc/`, `providers/`, `cli.ts` are declared in the contract's module map but not yet on disk — import exists (`media/`), export + save/open do not. Expected mid-flight; must exist before Phase 1 acceptance.
- **F3 (scope, MEDIUM): known contract gaps under negotiation** — playback/playhead events, batch-import progress, `exportMedia.preflight`, `verifyAssets` shape, `autosave:status`, `replaceClipAsset`, markers ops, undo labels. Both agents have flagged them; ensure resolutions land in the contract body (not only in review-note prose) before Phase 1 close.
- **F4 (risk, LOW): `store.update()` bookkeeping path** (no revision bump by design) — correct today, but any future caller that mutates real content through `update()` would silently bypass undo. Add a usage comment/guard if not already planned.
- **F5 (risk, LOW): concurrency.** Second-team agents are active in the same tree; ownership claims logged (e.g. `features/timeline/**` claimed by second-team Agent 2). Verify no overlapping writes at next checkpoint.

### Phase 1 acceptance checklist status

Not yet runnable as one product (export/persistence/playback integration pending). Checklist lives in `docs/PHASE_PLAN.md`; review gate re-runs when agents report handoff.

---

## Review #2 — verification of second-head handoff claims (2026-10-15)

Second coordinator head reported done; I independently re-ran their assertions:

| Claim | My verification | Verdict |
|---|---|---|
| FEATURE_MATRIX.md honest rows + merged into ROADMAP as Section E | file present (6.2KB), `Section E` at ROADMAP:88 | ✅ verified |
| Commits `6c27ed1` + `57673f5` on top of my checkpoint | both in `git log` | ✅ verified |
| Timebase verifier 41/41 (incl. parseTimecode NTSC fix) | re-ran `scripts/verify-timebase.mjs` → **41 passed, 0 failed** | ✅ verified |
| Engine tsc green | `tsc -p packages/engine --noEmit` → exit 0, no output | ✅ verified |
| App vite/tsc red (F11 + in-flight) | `tsc -p packages/app --noEmit` → **errors present** (timeline.ts PointerEvent casts, keyboard-map.ts `inTextInput`, app-shell.ts `getServices`/`NO_ENGINE_REASON`) | ✅ confirmed still red |
| F11 `bridge-status.ts` bad import | file **no longer exists** — superseded by in-flight `bridge.ts` refactor (`services.ts` deleted, `bridge.ts` untracked-new); error surface moved | ⚠️ superseded, re-check at gate |

**Ruling:** all second-head claims hold up. App-side tsc errors are **in live files owned by my currently-running agents** (uncommitted churn: `timeline.ts`, `keyboard-map.ts`, `app-shell.ts`) — I will NOT patch over their mid-write state; errors must be green at gate #2, owner = canonical Agent 2 + Phase 2 agent for timeline pieces. F11 effectively auto-resolved by refactor; confirm at gate.

**Gate #2 blockers recorded:** (B1) app tsc/vite green, (B2) export E2E script evidence (`scripts/export-e2e.mjs`, second-head Agent 1's lane), (B3) one-product run: preview playback + export + reopen/relink walked by me per PHASE_PLAN checklist.

---

## Review #2 — second head sweep (2026-10-15)

Scope: workspace health, build state, `time.ts`, docs acceptance, coordination integrity.

### Fixed by second head (announced in TEAM_STATUS)

- **F6 (BUILD, HIGH — fixed):** `node_modules/.bin` was empty → root builds failed exit 127 (`tsc`/`vite` not found) after raced installs. Repaired with `npm install` (one transient TLS error at tail — re-run if deps look thin). **Standing rule: no concurrent `npm install` in this workspace.**
- **F7 (CORRECTNESS, HIGH — fixed):** `time.ts parseTimecode()` NTSC round-trip drift (patch supplied by team-2 Agent 1). Applied nominal-rate conversion + `ff >= nominal` rejection. **`node scripts/verify-timebase.mjs` → 41 passed, 0 failed.** Canonical Agent 1: review the diff; revert-with-reason if you object.
- **F1 follow-up (process):** baseline commits now exist (`44956db` checkpoint, `55e5923`, `9bdd3b0`).

### Open findings (must resolve before Phase 1 close)

- **F8 (BUILD, HIGH — canonical Agent 2):** `packages/app` fails `tsc -p tsconfig.electron.json` — ~17 errors in `electron/main.ts`: TS7034/TS7019/TS7006/TS7005 implicit `any` (`win`, `dispatch`, `eventSubs`, `args`, `payload`) and TS2339 `hint`/`details` not on the error object (lines 26–255). `@ve/app` does not build. You're active in `preload.cjs`/`bridge.ts`/`ve.ts` — fix at your increment boundary; if still red at next review, I patch it myself.
- **F9 (VERIFY, MEDIUM):** `providers/`, `ipc/`, `export/` landed after Review #1's F2 but remain unverified — export E2E assigned to team-2 Agent 1 (`test-media/` ready). No "Implemented" claim without an acceptance run.
- **F10 (DOCS, ongoing):** `docs/ROADMAP.md` + `docs/FEATURE_MATRIX.md` created by second head. Agents update their Status rows honestly: `In progress (unverified)` → `Implemented` only after a head's acceptance run (matrix header rule).

---

## Review #3 — second head surface pass (2026-10-15 18:45)

Scope: preview monitor, export dialog, B1 re-verification against the live tree.

### Verified

- **B1 GREEN (re-verified 18:44):** `tsc -p packages/app/tsconfig.json --noEmit` exit 0 **and** `tsc -p tsconfig.electron.json --noEmit` exit 0. The walkthrough prereq line "B1 currently RED" is stale — coordinator re-verifies at gate.
- **Export dialog (read review, passes):** preflight blockers are real (freetype-missing text, unrendered keyframes/speed, empty timeline), progress events clamped monotonic with ETA, cancel path wired, failures render code+hint — matches contract §Export.

### Fixed by second head (announced, TEAM_STATUS increment 3)

- **E1 (UX, MEDIUM — fixed):** `export-dialog.ts` — `browseBtn` disabled in `start()` and never restored; after any export (done/error/cancel) Browse stayed dead for the rest of the dialog session. Fixed with `browseBtn.disabled = exporting` in `refreshStart()` (every completion path calls it).
- **E2 (CORRECTNESS, MEDIUM — fixed):** `preview.ts` `localUrl()` used `encodeURI`, which leaves `#`, `?`, `%` unescaped — a source file named `Clip #1.mp4` parsed `#1.mp4` as a URL fragment and never loaded. Fixed with per-segment `encodeURIComponent` (also covers spaces, `%`, non-ASCII).

### Open findings (owner: canonical Agent 2 unless claimed otherwise)

- **E3 (HONESTY, MEDIUM):** preview plays only one audio layer — `contentAt()` yields `audioOnly` only when no visual base exists, so a music track under a video clip is silent in preview, while the limitation chip only covers "top visual layer". Mix audio-track clips in preview, or extend the honest limitation note. Walkthrough step 3 doesn't block on this yet; the honesty rule does.
- **E4 (HONESTY, LOW):** transport buttons are never visibly disabled — with no project open, clicks silently no-op. Disable + reason in `title` when state is null.
- **E5 (cosmetic, LOW):** `export-dialog.ts` preflight ternary branches are logically identical (`A && B` vs `B && A`).
- **E6 (LOW):** cancel clicked during the indeterminate "Starting export…" phase no-ops until `exportId` resolves — button shown but briefly dead.

---

## Review #4 — second head timeline pass (2026-10-15 18:55)

Scope: `timeline.ts` (536 lines — walkthrough steps 3–4 surface), `state.ts` read-verified.

### Fixed by second head (announced, TEAM_STATUS increment 4)

- **T1 (UX, MEDIUM — fixed):** `snapForMove()` tail-snap measured the wrong distance — candidates were pre-mapped by `-dur` and then compared against `to + dur`, yielding `|c − to − 2·dur|` instead of `|c − to − dur|`. Effect: dragging a clip so its head reached `c − 2·dur` triggered a phantom snap that **jumped the clip to `c − dur`** (up to a full clip-length away), while genuine tail alignments at `c − dur` were missed. Fixed: snap raw candidates against the tail position, derive `to = value − dur`, with a `≥ 0` guard. **Consolidation note for canonical Agent 2:** the tested, correct implementation already exists in `timeline-math.ts` → `snapClipStart()` (14 green tests, incl. head/tail edges) — delegate to it when you next touch this file rather than maintaining two snapping copies.
- **T2 (cosmetic — fixed):** `rw-tl__clip--ghosting` drop-affordance class was only ever added — stale when the pointer returned to the original/invalid lane mid-drag; now cleared in the else branch.

### Verified clean (read review, no action)

- `state.ts`: `setPlayhead` clamps to `[0, programEndTicks]` (no negative playhead from off-left scrub); `frameFloorSafe` NTSC-correct; zoom clamped `[8, 800]`; selection pruning on snapshot refresh; batched-undo wiring (`history.beginBatch/endBatch` around drags) matches contract §Undo/redo.
- `timeline.ts`: every mutation goes through the engine (`timeline.*`, never direct data edits); locked tracks block edits with notice; honest empty states; drag-drop from media-bin with track-kind matching + auto `addTrack`.

### Open (owner: canonical Agent 2)

- **T3 (LOW):** edge-drag on a locked track returns silently (no `notify`) while the trim handles still render as active — either hide handles on locked tracks or announce the lock like the body-drag path does.
- **T4 (LOW):** `media-bin.ts` not yet reviewed — next pass.
