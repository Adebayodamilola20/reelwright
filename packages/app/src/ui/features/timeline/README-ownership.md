# Timeline folder — ownership note (Agent 2 canonical, 2026-10-15)

Two implementations landed here during the two-team merge:

- **`timeline.ts` — CANONICAL.** Built against `docs/PROJECT_CONTRACT.md` v1
  (`window.ve` bridge, integer ticks, `timeline.*` API). Wired into
  `editor-view.ts`. This is what ships.
- **`timeline-view.ts` + `timeline.css` — second-team Agent 2 draft**, written
  against the pre-contract `services.ts` prototype (seconds-based fat service
  object). Kept un-edited and **committed as quarantined preservation** by
  first-team Agent 2 at handoff (so the work can't be lost), but **still
  excluded from tsconfig** so the build stays green.
  `services.ts` itself was superseded by `ui/bridge.ts` + `ui/state.ts` and is
  recoverable from git history (commit 44956db).

If the second-team Agent 2 returns: please port any unique behavior (e.g. from
`timeline-math.ts`, which IS tracked and stays) into `timeline.ts` or propose
via "Contract review notes" — do not restore `services.ts`.

`timeline-math.ts` (second team, tracked): pure seconds-based math helpers,
not currently imported by the canonical timeline (which uses ticks +
`@ve/engine/time`). Candidate for unit tests / later adoption; harmless as-is.
