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

## Review #3 — Phase 3 handoff verified + B1/B2 CLOSED (2026-10-15)

**Phase 3 agent handoff — re-run verification:**
- `npm test -w @ve/audio` → **54/54 pass** (re-run by me) ✅
- `tsc -p packages/audio` → clean ✅
- Commits `5b29064` present; matrix rows scoped to Phase 3 sections only; matrix integrity intact (all phase sections present after the earlier clobber/restore incident — see 2653689).
- **Verdict: accepted at package level.** Honest-status wording in their handoff (implemented+tested at package level, NOT yet user-visible until engine/UI wiring) matches evidence — exactly the charter standard.

**Blocker status:**
- **B1 → CLOSED.** `tsc -p packages/app` exit 0, zero errors (re-run by me). Also clean: engine, effects. **templates tsc exit 2 — Phase 4 agent still mid-flight (their lane, expected).**
- **B2 → CLOSED.** `node scripts/export-e2e.mjs` re-run by me: **39/39**, including text-burn-in honesty gate (capabilities probe honest, rejection + real hint, no partial output).
- **B3 → OPEN, sole remaining gate blocker.** Awaiting remaining handoffs (Agent 1, Agent 2, Phase 2, Phase 4) so the tree is stable, then I execute `docs/ACCEPTANCE_WALKTHROUGH.md`.

**Coordination note:** one ROADMAP clobber incident occurred (path collision, repaired in `2653689`). Rule reaffirmed: roadmap/matrix are append/section-scoped; large edits to shared docs go through announce-then-edit in TEAM_STATUS.

---

## Review #4 — Phase 2 handoff verified + accepted (2026-10-15)

Phase 2 agent's claims re-run by me:
- `npm test -w @ve/effects` → **85/85 pass** ✅
- `tsc -p packages/effects` → exit 0, 0 errors ✅
- **Commit isolation:** `c01c209` touches only `packages/effects/**` + `docs/**` — zero engine/app files (grep of non-owned paths empty) ✅
- Contract notes appended under own section (labeled "Agent 2.5"); matrix Phase 2 section rewritten scope-checked, 17 evidence-labeled rows ✅
- Honesty spot-checks in handoff language match charter (sticker export gated with real reason, dip-to-color arbitrary color honestly blocked, keyframed export refused with hint + stream API ready).

**Verdict: ACCEPTED at package level.** Wiring tasks identified (Agent 1 → export plan joins + preflight; Agent 2 → inspector preview plans) — those integrate at their handoff, feeding B3.

**Gate tracker:** B1 ✅ B2 ✅ B3 ⏳ — awaiting Agent 1, Agent 2, Phase 4 handoffs.

---

## Review #5 — Agent 2 (first team) handoff verified + accepted (2026-10-15)

Claims re-run by me:
- `node scripts/app-smoke-e2e.mjs --skip-build` → **VERDICT PASS, 4/4** (Electron boot, renderer mounts, `window.ve` bridge round-trip: `project.recent` → `[]`, engine via `createEngineDispatcher`) ✅
- Commit `98fdd04` scope: **only `packages/app/**` + `docs/**`** (zero non-owned files) ✅
- Build gates: `tsc -p packages/app/tsconfig.json` exit 0 ✅; `vite build` (run from `packages/app/`) **exit 0, built in 1.83s** ✅ *(note: invoking vite from repo root fails on entry resolution — coordinator invocation error, not a defect; correct invocation is package dir or the wired npm script)*
- Disconnected-state probe (Observed): honest "Engine not connected" states, 10 controls disabled with reasons — charter honesty rule verified at UI level.
- Quarantine of pre-contract `timeline-view.ts`/`timeline.css` (excluded from tsconfig, canonical = `features/timeline/timeline.ts`) — acceptable preservation pattern; B3 must confirm no import leaks.

**Verdict: ACCEPTED.** UI slice is Observed at boot; editor flows remain "Partial (UI code exists, flows unverified)" per their own honest labeling — exactly what B3's walkthrough is for.

**Gate tracker:** B1 ✅ B2 ✅ B3 ⏳ — awaiting **Agent 1 (engine)** and **Phase 4** handoffs, then walkthrough (I'll drive UI flows via the existing CDP probe patterns since Agent 2's session has closed).

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

---

## Review #5 — second head: B2 double-verification + media-bin pass (2026-10-15 19:05)

- **B2 INDEPENDENTLY VERIFIED:** I reran `node scripts/export-e2e.mjs` myself → **39 passed, 0 failed, exit 0** (evidence `demo-output/export-e2e-evidence.json`), matching team-2 Agent 1's run. Spot-checked the substance: S1 exact-150-frame h264/aac mp4 (5.000 s ± tolerance), S2 cancel kills ffmpeg with no partials/temp leftovers, S3 `ASSET_MISSING` + hint, S4 `FFMPEG_FAILED` + stderr-tail hint, no stack leaks anywhere, S5 text honesty gate (`UNSUPPORTED_FEATURE` + real reason, nothing written).
- **Walkthrough prereq status (all under MY runs):** engine tsc exit 0 ✓ · app tsc **both** configs exit 0 ✓ (18:55) · `verify-timebase` 41/41 ✓ · `export-e2e` 39/39 ✓ (19:03) · gate-file freshness clean at run time. → Coordinator: every prereq box now has two independent green runs behind it; manual walk steps 3/5/8 remain yours (team-2 Agent 2's app-smoke E2E landing shortly as pre-walk evidence).
- **W1/W2 relayed to engine owner (canonical Agent 1):** (W1) ffmpeg exit-status wrapping surfaces as `243` — consider a `details` note (`exit N`/signal); (W2) a nonexistent output parent dir maps to `ASSET_MISSING` via the stderr "No such file" rule — decide whether `Error opening output` deserves `IO_ERROR` instead. Advisory only; E2E behavior is honest as-is.
- **media-bin.ts (T4) — PASS:** honest offline/no-project/no-media states, desktop-gating with a real reason, missing badge + working relink (`project.relinkAsset` → `verifyAssets`), truthful per-item hints, ffprobe metadata display. **M1 (improvement, LOW):** double-click append picks the first unlocked track and can land on an occupied span → engine overlap rejection surfaces as an error toast; smarter targeting (free slot / after last clip) is future polish, not a gate item.
- `timeline.ts` re-entered canonical Agent 2's active set (19:0x) — T1/T2 fixes are committed in `f7cf46c`; T3 (silent locked-track edge drag) awaits their call.

---

## Review #6 — second head: engine↔UI glue pass (2026-10-15 19:10)

Scope: `bridge.ts`, `ve.ts`, `commands.ts` — the command paths behind walkthrough steps 1–2 and 4–5.

- **`bridge.ts` — PASS.** Single `window.ve` touchpoint (contract boundary rule); `EngineCallError` rehydration preserves `{code, message, hint, details}` across IPC; no-bridge `call()` throws an honest `NOT_FOUND`; `getBridgeStatus()` reason text is accurate ("browser preview only shows the interface shell"); the charter `disableWithReason()` helper exists and is correct.
- **`ve.ts` — PASS.** Single import site; `import type` erased at build (zero runtime coupling); time values pulled only from dependency-free `@ve/engine/time`; alias strategy documented and contract-consistent.
- **`commands.ts` — PASS with nits.** Every mutation is engine-mediated (`history.*`, `timeline.*`, `assets.import`, `project.save`); multi-clip split/delete/duplicate iterate with honest per-op failure reporting; import progress shows real `i/n` counts (no fabricated %); per-file import failures notify and continue — matches contract §Events and the honesty rule.
  - **D2 (LOW, consolidation):** inline default text style duplicates `defaultTextStyle()` from `state.ts`; `70_560_000` literals instead of the exported `TICKS_PER_SECOND`; `togglePlay()` is implemented a second time (preview has its own). Drift risks, not bugs — canonical Agent 2 tidy-up when convenient.
- **E4 sharpened:** since `disableWithReason()` already ships in `bridge.ts`, E4 (transport silently no-ops with no project) is a one-call fix for canonical Agent 2 — no new plumbing needed.

---

## Review #7 — second head: running-app environment gate (2026-10-15 19:55)

- **R1 (ENV, HIGH — fixed):** electron's own installer half-extracts: `install.js` exits 0 without producing `Contents/Frameworks` (Observed ×3 by team-2 Agent 2; re-reproduced here — `node_modules/electron` mtimes 19:35 show a re-run clobbering its earlier repair while `path.txt` survived). Durable OFFLINE repair added: **`scripts/fix-electron-install.mjs`** — verifies the install layout derived from `path.txt`, repairs from npm's electron cache zip (`~/Library/Caches/electron/**`), `--check` mode for gates. Verified live: repair → intact → **`app-smoke --skip-build` 4/4 PASS** (window+renderer, `window.ve` bridge, engine dispatch round-trip `invoke('project.recent')`, clean kill).
- **Self-note (transparency):** my first `--check` revision tested `dist/Contents/…` instead of `dist/Electron.app/Contents/…` and briefly mis-labeled a healthy install as broken; corrected and re-verified in the same increment. The underlying half-extract bug is real and independent of this.
- **B3 protection:** the working binary lives in gitignored `node_modules` — any future `npm install` can re-trigger the half-extract. Until upstream is fixed: run `npm run fix:electron` after installs. Coordinator: consider two prereqs for `ACCEPTANCE_WALKTHROUGH.md` — `fix-electron-install.mjs --check` (boot-capable env) and `app-smoke-e2e.mjs` (boot + engine round-trip = automated half of the running-app steps).

---

## Review #8 — second head: step-6/7 E2E independent verification + parent-repo incident (2026-10-15 20:15)

- **Walkthrough step 6 — EVIDENCE INDEPENDENTLY RE-RUN BY ME:** `node scripts/export-e2e.mjs` → **51 passed / 0 skipped / 0 failed, exit 0** (fresh evidence JSON). Substance spot-checked against theory: half-gain export measures **Δ = −6.00 dB** (theory −6.02); fade-out tail **Δ = −13.20 dB** vs ≈ −12.7 linear-fade expectation; fade-in head **Δ = −12.70 dB** (exact). Bonus S7: wav lossless round-trip (level preserved) + mp3 44.1k→48k resample, `video:null` path verified. Step-6 integration confirmed native in `export/plan.ts` (Agent 3's proposal #3 not required) — **no step-6 blocker for B3.**
- **Advisories acknowledged (team-2 Agent 1's, non-blocking):** W3 — engine-native and `@ve/audio` gain/fade implementations coexist with differing edge semantics (clamp vs `INVALID_ARGUMENT`) — reconcile before relying on both in one pipeline; W4 — demuxer `-ss` segment measurement silently reads the whole stream near EOF on ffmpeg 8.1.1 (switched to in-filter `aselect`; documented in script).
- **PARENT-REPO INCIDENT — second-head confirmation (video-editor unaffected):** root cause identified as **iCloud Desktop & Documents sync eviction**, not damage by any agent: `~/Desktop` resolves to `~/Library/Mobile Documents/com~apple~CloudDocs/Desktop` (Observed). APFS dataless signature confirmed on user files (`size > 0, blocks = 0`); `contribution.txt` and `.git/HEAD` now read successfully via on-demand fetch, while root `graph_brain.png` is genuinely 0 bytes on disk. **Zero writes by any team member outside `video-editor/`** (diagnosis-only, both heads). User remediation steps logged in TEAM_STATUS `3005467` (Finder open / `brctl download` to force materialization, then `git fsck` in the parent repo; consider stopping iCloud eviction for that folder). The `video-editor/` repo is fully healthy — gate evidence and the walkthrough are unaffected.
- Walkthrough prereq checkbox text for the coordinator: "**B1 — currently RED**" is stale (your own review #3 closed B1; my double re-verification at 18:44/18:55 is in Review #5) — update the line when you tick the boxes.
