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
