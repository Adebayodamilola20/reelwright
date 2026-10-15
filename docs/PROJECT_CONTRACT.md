# PROJECT_CONTRACT.md — source of truth for module boundaries, data shapes, events, integration decisions

> Owner: **Agent 1** (architecture, project model, media foundation).
> Reviewer: **Agent 2** (product experience, editor interface, integration).
> Agent 2 records requested changes under "Contract review notes" below; Agent 1 integrates accepted changes into the body.

## Status

**CONTRACT v1 — READY (2026-10-15, Agent 1).** Agent 2 may build dependent integrations against this. Changes to the body are announced in `docs/TEAM_STATUS.md`; Agent 2 proposes edits via "Contract review notes".

## Environment baseline (verified by coordinator, 2026-10-15)

- Greenfield repository (git initialized, no prior code).
- macOS; node v24.16.0, npm, git available.
- ffmpeg/ffprobe 8.1.1 at /usr/local/bin — export/transcode/waveform/ffprobe metadata available locally.
- Desktop has ~16 GB free disk; keep test media small.
- Coordination channel: this file + `docs/TEAM_STATUS.md` (no direct agent messaging available in this harness).
- Role prompts stored in `docs/agent-prompts/AGENT_1_PROMPT.md` and `AGENT_2_PROMPT.md`.

Additional environment facts (Observed, Agent 1, 2026-10-15):

- ffmpeg filters available: `overlay, concat, scale, fps, color, trim, atrim, amix, afade, volume, pad…`; encoders: `libx264, aac, libmp3lame, prores`.
- **`drawtext`/`subtitles`/`ass` filters are NOT in this ffmpeg build** (no libfreetype/libass). Text burn-in on export is capability-gated — see "Export" below.

## Platform recommendation (Decision, Agent 1 — v1)

**First shipping platform: local-first desktop app on Electron + TypeScript (macOS first, cross-platform path preserved).**

| Option | Pros | Cons |
|---|---|---|
| **Electron (chosen)** | Node 24 + ffmpeg already present; full filesystem access stays local (privacy default); mature ecosystem for desktop UI; engine runs in main process headlessly; same engine later serves a web build | ~100–200 MB bundle; RAM heavier than native |
| Web app (browser + WASM ffmpeg) | zero install | WASM ffmpeg ~30 MB+ download, slower transcodes, file-access friction (OPFS), limits local-first story |
| Tauri (Rust shell) | smaller bundle | Rust toolchain not verified here; ffmpeg still a sidecar; slower to first slice |
| Native (Swift/AppKit) | best macOS feel | macOS-only, no reuse of node/ffmpeg tooling, slowest delivery |

Rationale: minimizes new dependencies, keeps all media local by default (charter), and the **engine is a plain Node package with no Electron import**, so a web/cloud shell can be added later behind the same `EngineApi`. No cost or privacy impact (no network code anywhere in v1). *Status: Designed.*

## Module boundaries

```
video-editor/
├── docs/                      # shared; PROJECT_CONTRACT.md owned by Agent 1, TEAM_STATUS.md append-only
├── packages/
│   ├── engine/                # @ve/engine — Agent 1 owns ALL of this
│   │   └── src/
│   │       ├── api.ts         # EngineApi interface + EngineEvents (THE contract, TypeScript)
│   │       ├── time.ts        # tick timebase + conversions (frame/sample/seconds)
│   │       ├── types.ts       # Project/Asset/Track/Clip/Keyframe/... data shapes
│   │       ├── errors.ts      # EngineError + error codes
│   │       ├── ids.ts         # id generation
│   │       ├── store/         # immutable store, revision counter, undo/redo history
│   │       ├── ops/           # timeline operations (add/split/trim/move/duplicate/…)
│   │       ├── media/         # ffprobe ingest, asset resolution/relink, waveform (later)
│   │       ├── persistence/   # save/open/atomic write/autosave/recent projects
│   │       ├── export/        # render plan → ffmpeg args, progress, cancellation, capabilities
│   │       ├── providers/     # AI/cloud provider interfaces + explicit unavailable stubs
│   │       ├── ipc/           # createEngineDispatcher: method-path dispatcher for IPC bridging
│   │       └── cli.ts         # headless E2E/demo entry (also my test harness)
│   └── app/                   # @ve/app — Agent 2 owns: Electron main, preload, renderer (UI)
└── test-media/                # tiny ffmpeg-generated fixtures (committed or regenerated)
```

Rules:

1. `@ve/engine` **must not import Electron, DOM, or any UI code.** It is importable by Node scripts, tests, and Electron main alike.
2. `@ve/app` never mutates project state directly; it only calls `EngineApi` methods and reacts to `EngineEvents`.
3. Agent 2 scaffolds `packages/app` (proposal in TEAM_STATUS; reversible on request). Agent 1 does not edit `packages/app` without coordinating.
4. Shared TypeScript contract lives in `packages/engine/src/api.ts` + `types.ts`. UI imports these types from `@ve/engine` (workspace dependency).

## Time units (normative)

**Canonical unit: integer ticks, `TICKS_PER_SECOND = 70_560_000` (1 tick = 1/70,560,000 s).**

- All timeline positions, clip durations, source in/out points, fade lengths, marker positions, and keyframe times are `Ticks` — **integers**.
- The tick rate was chosen so common rates divide evenly (Designed; arithmetic verified):
  - Frame rates: 24, 25, 30, 50, 60, 120 fps ✓; NTSC rates `24000/1001, 30000/1001, 60000/1001` ✓ (e.g. one `30000/1001` frame = `2352 × 1001 = 2,354,352` ticks, integer).
  - Audio sample rates: 44_100 ✓ (1600 ticks/sample), 48_000 ✓ (1470), 96_000 ✓ (735).
- Why not microseconds: NTSC frame durations (`1001/30000` s) are non-terminating in µs → cumulative frame drift. Why not floating seconds: no exact frame/sample arithmetic, comparison hazards.
- `time.ts` provides: `secFromTicks/ticksFromSec`, `frameDurTicks(fps)`, `frameFloor/FrameCeil(ticks, fps)`, `ticksToFrames(ticks, fps)`, `samplesFromTicks(ticks, sampleRate)` (exact when sampleRate ∈ {44100, 48000, 96000}), `formatTimecode(ticks, fps)` (HH:MM:SS:FF).
- Storage: plain JSON numbers. Safe range ≈ 4 years of continuous project time (`2^53 / TICKS_PER_SECOND`).
- **Export quantization (documented boundary):** timeline keeps exact ticks; when building the ffmpeg plan, clip boundaries are floored/ceiled to the program frame grid. Rounding is deterministic and < 1 frame.

## Data shapes (normative — mirrored in `types.ts`)

All shapes are JSON-serializable plain data. `string` ids are opaque (UUID-ish); do not parse them.

```ts
type Ticks = number;                     // integer, ≥ 0 unless stated
interface Rational { n: number; d: number }  // reduced, d > 0

interface ProjectSettings {
  width: number;                         // program resolution, e.g. 1920
  height: number;                        // e.g. 1080
  frameRate: Rational;                   // e.g. { n: 30000, d: 1001 }
  sampleRate: number;                    // e.g. 48000
  channels: number;                      // e.g. 2
  background: string;                    // '#rrggbb' — export base color
}

interface ProjectFile {                  // == the .veproj JSON on disk
  schemaVersion: 1;
  id: string;
  name: string;
  createdAt: string;                     // ISO-8601 UTC
  modifiedAt: string;                    // ISO-8601 UTC
  timebase: 70560000;                    // recorded constant; readers must honor it
  settings: ProjectSettings;
  assets: Asset[];
  tracks: Track[];                       // ORDER MATTERS: video tracks later in array = rendered on top
  markers: Marker[];
}

interface Asset {
  id: string;
  kind: 'video' | 'audio' | 'image' | 'text';
  name: string;                          // display name (defaults to file basename)
  source: {
    path: string;                        // best-known absolute path at last use
    relPath?: string;                    // path relative to the .veproj dir, when inside/near project folder
  };
  file?: {                               // present for file-backed assets; relink verification
    sizeBytes: number;
    modifiedMs: number;                  // fs mtime
  };
  meta: AssetMeta;                       // captured at import via ffprobe
  text?: TextContent;                    // kind === 'text' — generated asset, no file on disk
}

interface AssetMeta {
  durationTicks?: Ticks;                 // video/audio only; images have none
  video?: { codec: string; width: number; height: number;
            frameRate?: Rational; pixelFormat?: string; rotationDeg?: number };
  audio?: { codec: string; channels: number; sampleRate: number };
  format?: { formatName: string; bitRate?: number; sizeBytes?: number };
  probedAt: string;                      // ISO-8601
}

interface Track {
  id: string;
  kind: 'video' | 'audio';               // 'video' tracks carry video/image/text clips, 'audio' carries audio
  name: string;
  locked: boolean;                       // ops on locked tracks rejected
  muted: boolean;                        // audio: excluded from mix. video: excluded from render
  hidden: boolean;                       // video: excluded from render (alias semantics of muted per kind)
  clips: Clip[];                         // always kept sorted by start, then id
}

interface Clip {
  id: string;
  assetId: string;
  start: Ticks;                          // timeline position of clip head
  duration: Ticks;                       // > 0; timeline length
  sourceIn: Ticks;                       // asset offset where playback begins
  speed: Rational;                       // 1/1 default; source span consumed = duration * speed
  enabled: boolean;                      // disabled clips stay in project but don't render/preview audio
  audio: {
    volume: number;                      // linear gain, 1 = unity (0 dB)
    fadeIn: Ticks;                       // 0 = none
    fadeOut: Ticks;
    muted: boolean;
    pan: number;                         // -1..1 (reserved; not yet rendered — see feature matrix)
  };
  transform?: Transform;                 // video/image/text clips
  text?: TextContent;                    // text clips (asset.kind === 'text' or inline)
  keyframes: Keyframe[];                 // v1: stored but NOT evaluated (see feature matrix)
}

interface Transform {
  x: number; y: number;                  // pixels, origin = program center, +y down
  scale: number;                         // 1 = 100%, uniform
  rotationDeg: number;                   // clockwise
  opacity: number;                       // 0..1
}

interface TextContent {
  text: string;
  style: {
    fontFamily: string; fontSizePx: number; color: string;
    bold: boolean; italic: boolean;
    align: 'left' | 'center' | 'right';
    background?: string | null;          // '#rrggbb' | null
    lineHeight: number;                  // multiplier
  };
}

interface Keyframe {
  prop: 'transform.x' | 'transform.y' | 'transform.scale'
      | 'transform.rotationDeg' | 'transform.opacity' | 'audio.volume';
  at: Ticks;
  value: number;
  easing: 'linear' | 'easeIn' | 'easeOut' | 'easeInOut' | 'hold';
}

interface Marker { id: string; at: Ticks; label: string; color?: string }
```

Semantics (normative):

- **Non-destructive:** operations never modify source media. `trim`/`split`/`move` only edit `start/duration/sourceIn` in project data.
- **Split at `at`:** requires `start < at < start+duration`; left keeps `sourceIn`, right gets `sourceIn + (at-start) * speed`.
- **Overlap policy:** clips on one track may not overlap (v1). `moveClip`/`addClip`/`trimClip` reject with `OVERLAP` unless `{ mode: 'overwrite' }` is passed, in which case intersecting parts of existing clips are trimmed or the clips fully covered are removed. (Default UI behavior: reject + snapping to avoid.)
- **Images** have no intrinsic duration: an image clip gets an explicit `duration` chosen at placement (default 5 s). The image asset's `meta.durationTicks` stays undefined.
- **Text assets** are generated (`kind:'text'`, no file): stored inline in the project file. Placement behaves like an image clip.
- **Runtime-only state is never persisted:** asset resolution status (`ok`/`missing`), resolved paths, dirty flag, export jobs. Reopening re-resolves paths (see Persistence).

## Events / integration contract

`EngineEvents` (delivered to UI via the bridge's event channel):

```ts
interface EngineEvents {
  'project:change':   { revision: number; reason: 'op' | 'undo' | 'redo' | 'load' | 'create' | 'relink' };
                                     // state changed — UI should re-fetch project.current()
  'project:saved':    { path: string; revision: number };   // revision == savedRevision
  'assets:changed':   { revision: number };                 // import/remove/relink finished
  'export:progress':  { exportId: string; percent: number | null;  // 0..100, null while starting
                        outTimeTicks?: Ticks; fps?: number };
  'export:done':      { exportId: string; outputPath: string };
  'export:error':     { exportId: string; error: EngineErrorShape };
  'export:cancelled': { exportId: string };
}
```

- State sync model (v1, Designed-simple): on `project:change` the UI calls `project.current()` and gets a **full `ProjectSnapshot`**. Projects are small JSON (KBs); full-snapshot sync is correct and cheap. Optimized op-based patching is a later optimization, not a contract change.
- Every mutating call returns the affected entity (or a small result) plus the new `revision`; events are still emitted so no caller must poll blindly.

## Persistence schema

- **Project file:** single JSON file, `<name>.veproj`, UTF-8, `schemaVersion` first-class. Written **atomically**: temp file in same directory → `fs.rename`. `modifiedAt` bumped on save only.
- **Asset path recovery on open** (in order, per file-backed asset; first hit wins, then `source.path` is updated on next save):
  1. `source.path` as stored — exists → `ok`.
  2. `source.relPath` resolved against the project file's directory → exists → `ok` (portable projects; recommended when media lives under the project folder).
  3. Shallow search: `<projectDir>/<basename>` and `<projectDir>/media/<basename>` → `ok`.
  4. Otherwise `missing`: runtime status only; UI shows a relink flow calling `project.relinkAsset(assetId, newPath)` (verifies basename-or-size match, records new `path`+`relPath` if inside project dir).
  - No deep filesystem scanning (speed + privacy). No network, ever, for relinking.
- **Autosave:** engine option `autosaveIntervalMs` (default 30 000, `0` disables). Writes `<projectDir>/.autosave/<fileName>.<UTC-timestamp>.veproj` atomically, keeps newest 5. `persistence.autosave.list(projectPath)` and `.recover(path)` are available to the UI; recovery = `open`. If an autosave is newer than the project file, `project.open` returns `recoveredAutosave?: { path, modifiedAt }` hint — **the UI decides whether to offer it; nothing is auto-overwritten.**
- **Recent projects:** `<appDataDir>/recent.json` where `appDataDir` defaults to `~/.ve-editor` (working name; Electron shell may pass its `userData` dir). Local only.
- **No media is copied or moved by import** (non-destructive; path references only). A future "consolidate media" command may copy on explicit user action.

## Engine ↔ UI boundary (normative)

One generic bridge — the Electron preload exposes:

```ts
// window.ve  (typed in @ve/engine as VeBridge)
interface VeBridge {
  invoke<T = unknown>(method: EngineMethodPath, params?: unknown[]): Promise<T>;
  on<K extends keyof EngineEvents>(event: K, cb: (payload: EngineEvents[K]) => void): () => void;
}
```

- `method` is a dotted path into `EngineApi`, e.g. `'timeline.splitClip'`, `'project.open'`, `'exportMedia.start'`.
- IPC channels: request `ve:invoke` → `{ callId, method, params }`; reply `ve:reply` → `{ callId, ok: true, value } | { callId, ok: false, error: EngineErrorShape }`; events `ve:event` → `{ event, payload }`.
- Errors always cross the boundary as `EngineErrorShape = { code: EngineErrorCode, message: string, hint?: string, details?: unknown }` — never raw exceptions/stacks.
- The dispatcher is provided by Agent 1 as `createEngineDispatcher(engine)` in `@ve/engine/ipc` (Electron-agnostic: `(method, params) => Promise<value>`, plus `engine.on(...)` for events). Agent 2's main process wires it to `ipcMain`; preload maps it to `window.ve`. This keeps Electron out of the engine package.
- `EngineApi` surface (v1) — full signatures in `packages/engine/src/api.ts`:

```
project.      create | open | save | saveAs | current | close | verifyAssets | relinkAsset | recent
assets.       import | remove | get
timeline.     addTrack | removeTrack | renameTrack | setTrackFlags | addClip | addTextClip |
              updateClip | removeClip | duplicateClip | splitClip | trimClip | moveClip | listKeyframes? (via get)
history.      undo | redo | canUndo | canRedo | beginBatch | endBatch
exportMedia.  start | cancel | capabilities
persistence.  autosaveList | autosaveRecover   (also reachable via project.*)
providers.    status | register                 (AI/cloud interfaces; unavailable by default)
events        engine.on(event, cb) → unsubscribe   (exposed on the bridge)
time          re-exported helpers for UI snapping/timecode: frameFloor, frameCeil, formatTimecode, …
```

### Export contract

```ts
interface ExportOptions {
  outputPath: string;                    // absolute; parent dir must exist
  container: 'mp4' | 'mov' | 'mkv' | 'webm' | 'mp3' | 'wav';
  video?: { codec: 'h264' | 'prores' | 'none'; width?: number; height?: number;
            frameRate?: Rational; quality: 'draft' | 'standard' | 'high' } | null;
  audio?: { codec: 'aac' | 'mp3' | 'pcm_s16le' | 'none'; bitrateKbps?: number } | null;
  range?: { start: Ticks; end: Ticks };  // timeline range; default whole program
}
interface ExportCapabilities {
  ffmpegPath: string; ffmpegVersion: string;
  textBurnIn: boolean;                   // false in current environment (no libfreetype)
  containers: string[]; videoCodecs: string[]; audioCodecs: string[];
}
```

- Progress: ffmpeg `-progress pipe:1`, translated to `export:progress.percent` from program duration; `null` until first sample.
- Cancellation: `exportMedia.cancel(exportId)` terminates the ffmpeg process (SIGTERM → SIGKILL grace), emits `export:cancelled`, leaves no partial output file (temp output + rename on success).
- Failures: `export:error` with `code` ∈ `FFMPEG_NOT_FOUND | FFMPEG_FAILED | ASSET_MISSING | UNSUPPORTED_FEATURE | INVALID_ARGUMENT | OVERLAP | IO_ERROR | NOT_FOUND | BUSY` and a human `hint`.
- Honest-capability rule: features the renderer cannot actually perform are **rejected with `UNSUPPORTED_FEATURE` + hint**, never silently dropped. Currently rejected at export: `speed ≠ 1`, any `keyframes`, text clips when `capabilities.textBurnIn === false`, `pan ≠ 0`. (Pan: not yet rendered — will move to supported once implemented, not before.)

## Undo/redo model (normative)

- **Snapshot-based history** on the in-memory `ProjectFile` (deep-cloned via `structuredClone` at each commit). Rationale: projects are small; correctness beats micro-optimization; JSON snapshots also power dirty tracking. (Status: Designed; revisit with structural sharing only if profiling demands.)
- Every mutating op: push current snapshot to `past`, clear `future`, bump `revision`. `undo()`/`redo()` move snapshots and bump `revision` with `reason:'undo'|'redo'`.
- **Batching:** UI wraps continuous gestures (drag, inspector typing) in `history.beginBatch(label)` … `history.endBatch()` — exactly one undo entry regardless of intermediate updates. Nested batches are counted.
- Limits: 100 undo entries (configurable at engine creation). Saving does **not** clear history. `savedRevision` tracks dirty state; `project.current()` reports `dirty = revision !== savedRevision`.
- Ops validate before mutating (locked tracks, overlap, bounds, missing assets) and throw `EngineError` — failed ops leave history untouched.

## Provider interfaces (AI / cloud — Design gate)

- `src/providers/` defines `TranscriptionProvider`, `VoiceProvider`, `MediaAnalysisProvider` (scene search / reframe source), `CloudSyncProvider`, `PublishProvider`.
- Each has `id`, `displayName`, `status(): { available: boolean; reason?: string }` and methods that **throw `NOT_CONFIGURED` when unavailable**. v1 ships only unconfigured stubs: `status().available === false`.
- `engine.providers.register(...)` is the only way to attach a real provider; nothing in v1 performs network I/O, uploads files, or requires payment. Real providers need explicit project-owner approval (charter).

## Versioning rule

- Additive fields: free (consumers must ignore unknown fields).
- Breaking/semantic changes: bump `schemaVersion` + a migration in `persistence/`; announce in `TEAM_STATUS.md`.
- Contract body changes: Agent 1 edits, announces in `TEAM_STATUS.md`; Agent 2 proposes via review notes below.

## Contract review notes (Agent 2)

_(Agent 2 appends here; never delete existing entries.)_

### Review of v1 (Agent 2, 2026-10-15) — overall: ACCEPTED as the build basis. Requests/questions below; I build against v1 as written meanwhile.

1. **Playhead & playback ownership (gap in v1 — needs an explicit ruling).**
   `EngineApi` has no `play/pause/seek` and `EngineEvents` has no `playhead:update`. My reading: **v1 playback is UI-owned** — the preview monitor uses HTML5 `<video>`/`<audio>` on local files, the UI runs the playhead clock (rAF), and `timeline`/`monitor` sync to it; the engine stays out of 30 Hz IPC. *Proposed normative line:* "Playhead and playback are UI state for v1; the engine stores timeline data only. Moving playback into the engine later adds `playhead:update`/`playback:*` events without breaking this contract." — please adopt or specify your alternative.
   Consequence I accept in the UI: preview is **clip-under-playhead** playback (topmost enabled video track at the playhead), not a full multi-track composited preview; I will label this honestly in the monitor ("Preview: single clip — full composited preview planned") rather than imply parity. *Status: Designed.*
2. **Waveform peaks & thumbnails:** not in `EngineApi` v1 (`media/ waveform` marked later). Deferred requirement, no v1 change needed: when ready, expose `assets.thumbnail(assetId)` and `assets.waveform(assetId, buckets)` (min/max pairs). Until then the media bin renders kind icons and no waveform — no fake placeholders. *Status: Documented as deferred.*
3. **Import progress:** `assets.import` is one call without progress events. **Plan:** UI calls `assets.import([path])` per file so it can show done/total against `assets:changed`. Confirm this is acceptable (no re-probe overhead / no `BUSY` conflicts if called sequentially).
4. **`project.verifyAssets` return shape + `recoveredAutosave` hint shape** — please specify (e.g. `Array<{ assetId, status: 'ok'|'missing', searchedPaths: string[] }>` and `recoveredAutosave?: { path, modifiedAt }`). The relink flow and the "recover newer autosave?" dialog are UI-blocking on these shapes. Also: does `project.open` surface missing assets directly, or must the UI always call `verifyAssets` after open?
5. **Autosave failure visibility:** autosave writes are engine-side; the charter wants an honest autosave indicator. `project:saved` covers manual saves. Request: an `autosave:status` event (`{ ok: true, at } | { ok: false, error }`) or confirmation that the UI should derive save state purely from `project.current().dirty` (then autosave failures are only visible on demand — I'd rather show a warning chip).
6. **Export preflight:** accepted as written (`textBurnIn: false` → `UNSUPPORTED_FEATURE` + hint). One addition: a project containing text clips would fail export *after* the user starts it. Please add `exportMedia.preflight(options?) → { blockers: EngineErrorShape[] }` (or document that `capabilities()` is enough) so the export dialog can disable **Start** and list reasons *before* the run. UI will render the sidecar-SRT option only if/when an SRT export path exists; right now I won't show it (it doesn't exist — no fake controls).
7. **Dialog ownership:** contract has no file-dialog API. Proposal: **native dialogs belong to `@ve/app` (Electron main, my area)** — picker returns absolute paths, then calls `assets.import(paths)`. Engine stays dialog-free (keeps it headless). Confirm in the body when convenient.
8. **Time helpers for UI:** confirm they're importable from `@ve/engine` root (`formatTimecode`, `ticksFromSec`, `secFromTicks`, `frameFloor`, `frameCeil`, `frameDurTicks`). The timeline converts ticks↔pixels itself; I'll use your helpers for all frame math.
9. **Bridge shape accepted:** `window.ve = { invoke, on }` — my earlier "fat services object" requirement is superseded; I'm writing a UI-side adapter (`packages/app/src/ui/bridge-adapter.ts`) that maps `invoke('…')` to my internal `EngineServices` facade. Event names: I adopt the contract's list; my earlier names are withdrawn.
10. **Missing/relink events:** contract handles this via `project:change` reason `'relink'` + `verifyAssets` polling-on-open — acceptable; no `asset:missing` event needed for v1. Recorded so I disable nothing wrongly.
11. **Engine construction (blocking nothing, but pin it):** contract defines the dispatcher but not how main process *creates* the engine instance (`createEngine(opts)`? options like `autosaveIntervalMs`, `appDataDir`?). My Electron main currently probes `createEngine → createEngineApi → createDefaultEngine` dynamically and falls back to a bridge-less session (honest "Engine not connected" UI). Please pin the factory name + options in the contract body; I'll switch to the exact call.

### REVIEW NOTES (Agent 2, second team `ses_ebfaed118ffe0SsU7y7VKh4Bf4`, 2026-10-15 17:36) — audit of v1 against the UI in `packages/app`

Overall: v1 is buildable-against and the honesty rules match what I need. Notes are **proposals**; integrate or reply in TEAM_STATUS. Items marked *(UI-side fix)* are mine/canonical-Agent-2's to fix, listed for visibility.

1. **REQUIREMENT — playback/playhead on the bridge.** `EngineEvents` has no playhead/playback event, yet `NullPlaybackEngine` exposes `positionUsStream` and the UI must (a) drive the playhead at ≥30 Hz when a real engine exists and (b) *disable* transport honestly today. Propose: add `'playback:state': { playing: boolean; positionTicks: Ticks; available: boolean; reason?: string }` to `EngineEvents` + a `playback.status()` method on `EngineApi`. Without this, the honest-disabled rule can't be rendered accurately (services.ts currently has bare `play()/pause(): void`).
2. **REQUIREMENT — time unit at the UI boundary.** `packages/app/src/ui/services.ts` currently models `ClipInfo`/`EngineState` in float **seconds**; contract v1 canonical unit is integer **ticks**. Seconds as the *only* interchange format invite snap/split rounding drift. Propose: bridge exposes ticks-native fields (`startTicks`, `durationTicks`, `sourceInTicks`, `playheadTicks`) alongside derived seconds for layout, and `types.ts` exports a `ProjectSnapshot` + re-exports `secFromTicks/formatTimecode` for the UI. *(UI-side fix: I'll migrate services.ts off pure-seconds when `types.ts` lands — coordinating with canonical Agent 2 first.)*
3. **REQUIREMENT — background-error event.** Autosave failure must surface (contract: "never lose an edit silently"). `EngineErrorShape` only crosses on invokes. Propose: `'engine:error': { scope: 'autosave'|'load'|'media'|...; error: EngineErrorShape }` event.
4. **REQUIREMENT — missing-asset visibility on open.** Contract resolves paths on open and returns `relink` as a `project:change` reason, but no surface lists *which* assets are missing. Propose: `project.open` result (and/or `project.verifyAssets()` return) includes `missingAssets: [{ assetId, name }]`. In-session `asset:missing` detection (file deleted while open) can be **Planned** — say so and I'll disable polling UI with a reason instead.
5. **REQUIREMENT — batch import result + progress.** UI renders per-file import rows (progress + partial failure). Propose documenting: `assets.import(paths[])` returns `{ added: Asset[]; failures: [{ path, code, message }] }` and emits `'assets:importProgress': { done: number; total: number; currentPath?: string }`. Partial success must be shown as such (my earlier req).
6. **PROPOSE — `timeline.replaceClipAsset(clipId, assetId)`.** "Replace media in clip, keep timing/props" is in the charter's workflow list and missing from v1 ops. Cheap (same-kind validation + path swap); needed for media-bin "Replace with…".
7. **PROPOSE — export preflight.** Since v1 rejects `speed ≠ 1`, keyframes, and text clips (when `textBurnIn === false`) with `UNSUPPORTED_FEATURE`, add `exportMedia.preflight(projectId): { unsupported: [{ feature, reason, clipCount }] }` so the dialog can warn *before* the user picks an output path, instead of failing at encode time. Also: **sidecar `.srt` export** was my earlier requirement; v1 has no SRT path — either add it (text clips are already structured data) or mark it **Planned** explicitly and I'll annotate the dialog accordingly.
8. **PROPOSE — markers ops.** `ProjectFile.markers` exists but no `timeline.addMarker/removeMarker`; markers are prime snap candidates and cheap to add. Planned is acceptable if stated.
9. **PROPOSE — undo labels for tooltips.** `history.canUndo()/canRedo()` → `{ can: boolean; label?: string }` (batch label) so Edit menu/tooltip can show "Undo Split clip".
10. *(UI-side fix, heads-up to canonical Agent 2)* `services.ts` `TrackInfo.kind` allows `'text'`, but contract `Track.kind` is `'video' | 'audio'` — text clips ride video tracks (`Clip.kind === 'text'`). Also `services.ts` `ExportSettings` unions (`videoCodec: string`, quality `low|medium|high|custom`, `burnText`) diverge from contract (`'h264'|'prores'|'none'`, `draft|standard|high`, no `burnText` — capability-gated instead). I'll reconcile these in `services.ts`/export dialog when I touch those files, or canonical Agent 2 can — flagging to avoid duplicate/conflicting edits.
11. **ACK / decided by me (UI ownership):** file-picker dialogs live in Electron main (IPC), not the engine — matches contract's "engine stays Electron-free"; `pickFiles()` in services.ts will bind to an app-main IPC, documented here rather than in the engine body.
