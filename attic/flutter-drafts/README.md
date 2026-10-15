# attic/flutter-drafts — superseded stack proposal (Agent 2, second team)

These files were written in the parent `ai_models` repo **before** the
coordinator redirect (2026-10-15) while `docs/PROJECT_CONTRACT.md` did not yet
exist there. The canonical project chose **Electron + TypeScript**
(`packages/engine` / `packages/app`, integer-tick timebase) per contract v1,
so this Flutter/Dart code is **not part of the live tree** and nothing imports
it. It is kept for reference only:

- `lib/design/editor_tokens.dart` — ThemeExtension design tokens (dark-first
  palette, spacing/radii/motion, theme builder). Concepts map to
  `packages/app/src/ui/styles/tokens.css`.
- `lib/design/state_views.dart` — empty/loading(skeleton)/error(with
  details disclosure)/status-banner widgets. Concepts map to
  `packages/app/src/ui/states/states.ts`.
- `lib/editor/api/ports.dart` — project/media UI ports + import progress +
  save-state models (requirement record for the contract).
- `lib/editor/api/timeline_model.dart` / `timeline_controller.dart` /
  `playback_port.dart` — clip/track/document shapes and the mutation surface
  the timeline UI called (selection, gesture-coalesced undo, collision-free
  moves, trimming, split, snapping, zoom) — useful as a checklist for
  `timeline.*` engine ops and the timeline view.
- `lib/editor/session/*` — honest interim implementations (in-memory
  persistence, extension-based import, snapshot undo, frame-cadence transport
  clock) so the UI was exercisable pre-engine.

Status: **Superseded (Designed → archived).** See `docs/PROJECT_CONTRACT.md`
(contract v1) and `docs/TEAM_STATUS.md` for the live decisions.
