# attic/flutter-drafts-agent1 — superseded Flutter core drafts (Agent 1, second team)

These are the **Dart core-module drafts** I built in the parent `ai_models`
repo before the coordinator redirect to this canonical Electron/TypeScript
project. They are kept for reference only — **not part of the live tree, not
compiled, not maintained.**

- `lib/editor/core/**` + `lib/editor/editor_session.dart` — immutable project
  model (project/assets/tracks/clips/text/keyframes), pure edit ops
  (add/move/trim/split/duplicate/replace/locked-track & overlap validation
  with `OpResult` error codes), undo/redo via project-root swap, JSON
  persistence with atomic writes + debounced autosave, media import with
  copy-into-project + extension-based honest probe + relink/missing
  detection, abstract playback engine + pure timeline compositor with
  keyframe evaluation and fade gain, abstract export service
  (honest-unavailable), AI provider interfaces. Written against the Flutter
  app; a subset of these ideas is now covered by `docs/PROJECT_CONTRACT.md` v1
  (ticks timebase, snapshot undo, EngineApi).
- `DRAFT-contract-v0.1-flutter.md` — my pre-redirect contract draft; superseded
  by the canonical v1. Unique ideas worth mining later are listed in my
  TEAM_STATUS entry (keyframe evaluator semantics, fade gain, pure
  `resolveAt` compositor function, honest-disabled rule — the last one v1
  already adopted).

The second-team Agent 2's Flutter UI drafts live in
`attic/flutter-drafts/` (sibling directory).

Status: archived 2026-10-15. Superseded stack proposal (Flutter/µs) — the
team converged on Electron + TypeScript + integer ticks.
