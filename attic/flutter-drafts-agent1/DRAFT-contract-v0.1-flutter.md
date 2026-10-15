> ## 🛑 SUPERSEDED — DO NOT EDIT OR BUILD AGAINST THIS COPY (2026-10-15, coordinator session ses_ec31f91c6ffeEUTcTBeJxl8EU2)
> The canonical contract lives at **`/Users/adebayostephenoluwadamilola/Desktop/ai_models/video-editor/docs/PROJECT_CONTRACT.md`**. Agent 1: merge this v0.1 draft into the canonical file (preserving its coordinator baseline and "Contract review notes (Agent 2)" section), then work only there. Full instructions: top of `docs/TEAM_STATUS.md` in this directory.

# PROJECT_CONTRACT.md — Reelforge video editor

Status: **v0.1 — DRAFTED by Agent 1, awaiting Agent 2 review notes.**
Owner: Agent 1. Agent 2 may append clearly marked `REVIEW NOTE (Agent 2):`
blocks at the end of sections; Agent 1 integrates accepted proposals and
bumps the version. This file is the source of truth for module boundaries,
data shapes, time units, events, and integration decisions.

Labels used below: **Observed** (verified in this repo), **Documented**
(public docs of a dependency/platform), **Inferred**, **Designed** (our
decision — changeable).

---

## 1. Product identity and scope

- Working product name: **Reelforge** (**Designed**; renameable — it is not
  wired into any persistent format except the storage folder name `reelforge/`,
  which is trivial to migrate).
- The existing app `emerge_x` is a chat/AI assistant (**Observed**). The video
  editor is a new module inside the same Flutter app, reachable through an
  entry point Agent 2 adds. Nothing in `lib/views/**`, `lib/main.dart`, or the
  Firebase/Stripe code is modified by Agent 1.

## 2. Ownership map

| Area | Owner | Paths |
|---|---|---|
| Editor core (model, ops, state, persistence, service boundaries) | Agent 1 | `lib/editor/**`, `test/editor/**` |
| Editor UI (library, editor layout, timeline widget, preview, inspectors) | Agent 2 | `lib/views/editor/**`, entry/routing in `lib/main.dart` + `lib/views/**`, theming, `lib/shared/**` |
| Contract | Agent 1 | `docs/PROJECT_CONTRACT.md` |
| Status log | both (own sections only) | `docs/TEAM_STATUS.md` |
| Roadmap / feature matrix | both append | `docs/ROADMAP.md` |
| Dependencies | coordinate in TEAM_STATUS before editing | `pubspec.yaml` |

If Agent 2 needs a change inside `lib/editor/**`, request it in TEAM_STATUS
(`REQUIREMENT (Agent 2): ...`); Agent 1 implements and notes it here.
Agent 1 will not edit UI files without first claiming them in TEAM_STATUS.

User-owned uncommitted changes (`backend/agent.py`, `contribution.txt`,
`lib/services/tts_service.dart`, deleted `ios/GoogleService-Info-2.plist` +
`ios/Podfile`, untracked `backend/graph_brain.png`, `graph_brain.png`,
`notemaker/`) are untouched by both agents (**Observed**).

## 3. Platform and dependency policy

- First shipping platform for the editor: **macOS desktop** (**Designed**).
  Rationale: dev machine is macOS; desktop gives full filesystem access for
  import/relink and headroom for encoding; Windows is a near-copy via the
  existing `windows/` folder; Android/iOS follow; **web is deferred** (no
  general filesystem, codec/encoder constraints). The core module is pure
  Dart + `dart:io`, so this is not a one-way door.
- Slice 1 adds **zero** new pubspec dependencies (**Designed**). Future
  candidates must be proposed here with license notes and owner approval
  before adding:
  - Native decoder/encoder (e.g. bundled FFmpeg static builds — FFmpeg
    licensing (LGPL vs GPL) and binary bundling need owner sign-off;
    ffmpeg-kit was retired upstream, so per-platform binaries or a maintained
    wrapper is the realistic path). **Planned, not integrated.**
  - Player widget for preview (to be evaluated against `video_player`,
    `media_kit`, custom texture pipeline) — **Planned**.
- User media stays local by default; no uploads. All AI/cloud/publishing
  integration goes through the provider interfaces in §9 and requires owner
  approval before any network use (**Designed**).

## 4. Time model (normative)

- Canonical time unit: **integer microseconds** (`int`, suffix `Us`) for every
  timestamp, duration, in/out point, and offset (**Designed**). Range of
  `int64` ≈ 292 000 years — ample.
- Frame rates are **rationals**: `fpsNum` / `fpsDen` (e.g. 30000/1001 for
  29.97; 24/1; 60/1). Never store fps as a float (**Designed**).
- Conversions frames↔µs and samples↔µs use `Rational` arithmetic and round
  **once** at the boundary (`us = frames * fpsDen * 1e6 ~/ fpsNum`). Repeated
  incremental conversion is forbidden (prevents drift) (**Designed**).
- Ranges are half-open `[inUs, outUs)`; `durationUs = outUs - inUs`.
- Timecode display (HH:MM:SS:FF) is derived, project-settings-aware, and
  never the storage format (**Designed**).
- Audio: project sample rate (default 48 000 Hz) is metadata; clip audio is
  edited in µs. Sample-accurate ops convert via `Rational` at boundaries.

## 5. Data model (normative)

All model classes are in `lib/editor/core/model/`, are **immutable** (final
fields + `copyWith`), and serialize to/from JSON by hand (no codegen) with a
top-level `formatVersion` integer (currently `1`) (**Designed**).

### 5.1 EditProject
| field | type | notes |
|---|---|---|
| `formatVersion` | int | = 1 |
| `id` | String | opaque, e.g. `p_<random>` |
| `name` | String | |
| `createdAt` / `updatedAt` | int (epoch ms) | |
| `settings` | ProjectSettings | see 5.2 |
| `assets` | List\<MediaAsset\> | project media library |
| `tracks` | List\<Track\> | **index 0 = bottom-most video layer; higher index renders on top**; audio tracks render in parallel regardless of index |
| `revision` | int | increments on every store commit; useful for UI dedup |

### 5.2 ProjectSettings
`width` (int, default 1920), `height` (int, default 1080), `fpsNum`
(default 30), `fpsDen` (default 1), `sampleRate` (default 48000),
`channels` (default 2).

### 5.3 MediaAsset
| field | type | notes |
|---|---|---|
| `id` | String | `a_<random>` |
| `kind` | MediaKind | `video`, `audio`, `image`, `other` |
| `relativePath` | String? | path relative to project dir (portable, preferred) |
| `absolutePath` | String? | fallback/original location |
| `originalFilename` | String | display name |
| `addedAt` | int (epoch ms) | |
| `fileSizeBytes` | int? | |
| `durationUs` | int? | **null when unknown** (slice 1 probe is extension-based) |
| `width` / `height` | int? | null when unknown |
| `fpsNum` / `fpsDen` | int? | null when unknown |
| `sampleRate` / `channels` | int? | null when unknown |
| `container` / `videoCodec` / `audioCodec` | String? | null when unknown |

Resolution order for opening bytes: `relativePath` (against project dir) →
`absolutePath`. A resolved path that no longer exists marks the asset
**missing**; the UI must show it as missing and offer *relink*
(`MediaImportService.relinkAsset`). Missing assets never silently disappear
(**Designed**).

### 5.4 Track
`id` (`t_<random>`), `kind` (TrackKind: `video`, `audio`, `text`),
`name`, `locked` (bool), `muted` (bool, audio), `hidden` (bool, video/text),
`clips` (List\<Clip\>, kept sorted by `timelineStartUs`).

### 5.5 Clip
| field | type | notes |
|---|---|---|
| `id` | String | `c_<random>` |
| `kind` | ClipKind | `video`, `audio`, `image`, `text` |
| `assetId` | String? | required for media clips, null for text |
| `timelineStartUs` | int | when the clip starts on the timeline |
| `sourceInUs` | int | source offset where clip content begins (≥ 0) |
| `durationUs` | int | > 0; for image clips defaults to 5 s but any length allowed |
| `speed` | double | 0.25–4.0, default 1.0; effective source span = durationUs × speed |
| `volume` | double | 0.0–2.0, default 1.0 (media clips) |
| `opacity` | double | 0.0–1.0, default 1.0 |
| `transform` | ClipTransform? | `x`,`y` (normalized −1..1 center offsets), `scale` (default 1.0), `rotationDeg`, `flipH`/`flipV` |
| `text` | TextSpec? | required iff kind == text |
| `fadeInUs` / `fadeOutUs` | int | default 0 |
| `transitionIn` / `transitionOut` | TransitionSpec? | `{type: TransitionType, durationUs}`; type currently `cut`, `dissolve`, `wipeLeft` (enum grows; unknown values must round-trip as `cut` in UI but stay in JSON) |
| `keyframes` | List\<Keyframe\> | see 5.6 |
| `label` | String? | user rename; display falls back to asset filename |

**Invariant (enforced by ops):** clips on the same track never overlap and
never have negative positions. `sourceInUs + durationUs × speed` may exceed
asset duration only for images/unknown-duration assets; ops clamp against
known durations.

### 5.6 Keyframe
`property` (KeyframeProperty: `opacity`, `volume`, `x`, `y`, `scale`,
`rotationDeg`), `atUs` (**clip-relative** µs), `value` (double),
`easing` (KeyframeEasing: `linear`, `easeIn`, `easeOut`, `easeInOut`).
Value lookup at a playhead is a pure function in
`lib/editor/core/ops/keyframe_evaluator.dart`.

### 5.7 TextSpec
`text` (String), `fontFamily` (String?, null = platform default),
`fontSize` (double, px in project-resolution space, default 48),
`color` (int ARGB), `backgroundColor` (int ARGB, default transparent),
`bold`/`italic`/`underline` (bool), `alignment` (left/center/right),
`borderWidth`/`borderColor`, `boxPadding` (double).

## 6. Edit operations and undo/redo (normative)

- `lib/editor/core/ops/edit_ops.dart` exposes **pure functions**
  `EditProject op(EditProject p, ...)` returning a new project (structural
  sharing; `revision` +1). No mutation (**Designed**).
- Operations (slice 1, all implemented): `addTrack`, `removeTrack`,
  `renameTrack`, `setTrackLocked/muted/hidden`, `addAsset`, `removeAsset`,
  `placeClip` (asset → track at time, with auto-gap enforcement), `moveClip`
  (same track or cross-track), `trimClipStart` / `trimClipEnd` (ripple is a
  later flag, see roadmap), `splitClipAt(projectId, trackId, clipId, atUs)`,
  `duplicateClip`, `replaceClipAsset`, `updateClip` (transform/opacity/
  volume/speed/text/keyframes via `copyWith`), `insertGap`/`removeGap` — the
  last two are **Planned** (roadmap), not in slice 1.
- Every op returns `OpResult` = success(project) | failure(OpError) with
  machine-readable `OpError` codes: `trackLocked`, `clipNotFound`,
  `overlap`, `invalidRange`, `assetMissing`, `outOfBounds`. UI must surface
  these strings — ops never throw for user-logic errors (**Designed**).
- **Undo/redo:** `UndoStack` in `lib/editor/core/state/undo_stack.dart` keeps
  bounded (default 100) previous project roots; redo is cleared on new edit.
  Because the model is immutable, undo is a pointer swap — no inverse-command
  machinery (**Designed**).

## 7. Store, persistence, events (normative — Agent 2 integration surface)

`lib/editor/core/state/project_store.dart`:

```dart
class ProjectStore extends ChangeNotifier {
  EditProject get project;
  bool get canUndo; bool get canRedo; bool get isDirty; bool get isSaving;
  ChangeKind get lastChange;         // what the latest commit touched
  Stream<ProjectStoreError> get errors;
  OpResult apply(OpFunction op);     // commit + notify + schedule autosave
  Future<void> undo(); Future<void> redo();
  Future<void> saveNow();
  Future<void> close();
}
```

- `ChangeKind` enum: `structure` (tracks), `clips`, `assets`, `metadata`
  (name/settings), `loaded`. First slice notifies once per commit with this
  hint; finer-grained events are **Planned**.
- Autosave: debounce 1500 ms after a commit (**Designed**; configurable on
  the constructor). `saveNow()` flushes. Save errors surface via `errors`
  stream and keep the store dirty — never lose an edit silently.
- Serialization: `lib/editor/core/persistence/project_serializer.dart`
  (hand-written JSON, `formatVersion: 1`). Unknown JSON keys are dropped on
  load (documented; forward-compat policy revisit at v2).
- Repository: `lib/editor/core/persistence/project_repository.dart`
  - abstract `ProjectRepository` (create/load/save/delete/list metadata).
  - `FileProjectRepository(rootDir)` with layout
    `<rootDir>/reelforge/projects/<projectId>/project.json` and
    `<rootDir>/reelforge/projects/<projectId>/media/<assetId>.<ext>`.
  - Writes are atomic: write `project.json.tmp`, then rename.
  - Default root on desktop = app documents dir; tests inject temp dirs.
- `docs`/`EditorSession` (`lib/editor/editor_session.dart`) wires repository +
  store + services for Agent 2:

```dart
class EditorSession {
  static Future<EditorSession> createNew({required String name, Directory? root});
  static Future<EditorSession> open(String projectId, {Directory? root});
  ProjectStore get store;
  MediaImportService get media;
  PlaybackEngine get playback;
  ExportService get exportService;
  Future<void> dispose();
}
```

## 8. Media ingest (normative)

`lib/editor/core/media/media_import_service.dart`:

- `Future<ImportResult> importFiles(List<String> paths)` — copies each file
  into the project `media/` dir as `<assetId>.<ext>`, probes it, commits
  `addAsset`. `ImportResult` has `added: List<MediaAsset>` and
  `failures: List<ImportFailure(path, message)>`. Partial success is normal
  and must be shown as such.
- `MediaProbe` (abstract) + `ExtensionMediaProbe` (slice 1): classifies by
  extension and reads file size; **all rich metadata stays null** and the UI
  must render "unknown" honestly (**Designed**; real probing arrives with the
  native decoder dependency).
- `OpResult relinkAsset(String assetId, String newPath)` — validates the
  extension matches the asset kind, updates paths, clears missing state.
- Import never uploads anything; copies are the source of truth after import.

## 9. Playback, compositor, export, AI providers (normative boundaries)

- `lib/editor/core/playback/playback_engine.dart` — abstract:
  `Future<void> setProject(EditProject)`, `play()`, `pause()`,
  `seekUs(int)`, `setRate(double)`, `bool get isPlaying`,
  `Stream<int> get positionUsStream`, `dispose()`. Slice 1 ships
  `NullPlaybackEngine` (reports paused, position 0, emits on seek only) —
  the UI must disable transport controls it cannot honestly support, and the
  contract for the real engine is fixed now (**Designed**).
- `lib/editor/core/playback/timeline_composer.dart` — pure:
  `List<ResolvedClip> resolveAt(EditProject, int playheadUs)` returning, per
  visible clip active at the playhead: clip, asset, layer index, computed
  source offset (speed-adjusted), per-property keyframe-evaluated values, and
  transition progress. This is what a future renderer (Agent 2's preview
  widget over a native engine) consumes (**Designed**).
- `lib/editor/core/export/export_service.dart` — abstract:
  `bool get isAvailable`, `String? get unavailableReason`,
  `Stream<ExportProgress> export(EditProject, ExportOptions)`,
  `Future<void> cancel()`. `ExportOptions`: container (mp4/mov/webm),
  width/height/fps rational, video bitrate or quality preset, audio bitrate,
  sample rate. `ExportProgress`: phase (preparing/encoding/finalizing/done/
  cancelled/failed), percent (0–100, -1 = indeterminate), ETA, message.
  Slice 1 ships `UnavailableExportService('Native encoder not integrated
  yet')` — the export UI must show disabled-with-reason (**Designed**).
- `lib/editor/core/providers/ai_providers.dart` — interfaces only, all with
  `ProviderAvailability get availability` (`available | unavailable(reason) |
  requiresNetwork | requiresApproval`): `TranscriptionProvider`
  (audio → timed segments in µs), `BackgroundRemovalProvider`,
  `VoiceSynthesisProvider`, `ClipSearchProvider`. No implementations make
  network calls in slice 1 (**Designed**; owner approval required before any
  real service is wired).

## 10. Errors, honesty rules

- User-logic failures flow through `OpResult`/`ImportResult`/`ExportProgress`
  — not exceptions. Exceptions mean bugs and may propagate.
- A control must never appear functional when its backing service is not:
  transport (needs real engine), export (needs encoder), AI tools (need
  providers) render disabled with the reason from the interface (**Designed**).
- Null metadata means "unknown", never 0.

## 11. Roadmap pointer

`docs/ROADMAP.md` carries the staged plan and feature matrix with status
labels (`Implemented`, `Partial`, `Planned`, `Blocked`) and evidence
(`Observed`/`Documented`/`Inferred`/`Designed`). This contract covers slice 1
boundaries; later slices (real decoding/preview, export encoder, transitions
rendering, captions/transcription, keyframe UI, templates, AI, cloud) amend
this file before code lands.

---
