/**
 * The engine↔UI TypeScript contract (mirrors docs/PROJECT_CONTRACT.md).
 * Agent 2 consumes these types via the `@ve/engine` workspace package.
 */

import type {
  Asset,
  AssetResolution,
  AutosaveInfo,
  Clip,
  ClipAudio,
  CurrentState,
  ExportCapabilities,
  ExportOptions,
  ProjectFile,
  ProjectSettings,
  RecentEntry,
  TextContent,
  Track,
  TrackKind,
  Transform,
} from './types.js';
import type { Ticks } from './time.js';
import type { EngineErrorShape } from './errors.js';
import type { ProviderKind, ProviderStatusReport } from './providers/providers.js';

export type ChangeReason = 'op' | 'undo' | 'redo' | 'load' | 'create' | 'relink';

export interface EngineEvents {
  /** State changed — UI should re-fetch project.current(). */
  'project:change': { revision: number; reason: ChangeReason };
  'project:saved': { path: string; revision: number };
  'assets:changed': { revision: number };
  'export:progress': {
    exportId: string;
    percent: number | null; // 0..100, null while starting
    outTimeTicks?: Ticks;
    fps?: number;
  };
  'export:done': { exportId: string; outputPath: string };
  'export:error': { exportId: string; error: EngineErrorShape };
  'export:cancelled': { exportId: string };
}

export interface CreateProjectInput {
  name: string;
  dir: string;
  settings?: Partial<ProjectSettings>;
}

export interface OpenProjectResult {
  state: CurrentState;
  /** Present when an autosave is newer than the project file; UI decides whether to offer recovery. */
  recoveredAutosave?: AutosaveInfo;
}

export interface ImportResult {
  imported: Asset[];
  /** Already-imported paths (deduplicated by resolved absolute path). */
  existing: Asset[];
  failed: { path: string; error: EngineErrorShape }[];
}

export type OverwriteMode = 'reject' | 'overwrite';

export interface AddClipInput {
  trackId: string;
  assetId: string;
  start: Ticks;
  /** Default: full remaining asset length (video/audio) or 5 s (image/text). */
  duration?: Ticks;
  sourceIn?: Ticks;
  mode?: OverwriteMode;
  transform?: Partial<Transform>;
  audio?: Partial<ClipAudio>;
}

export interface AddTextClipInput {
  trackId: string;
  start: Ticks;
  duration?: Ticks; // default 5 s
  text: string;
  style?: Partial<TextContent['style']>;
}

export interface UpdateClipPatch {
  enabled?: boolean;
  audio?: Partial<ClipAudio>;
  transform?: Partial<Transform>;
  text?: Partial<TextContent>;
}

export interface TrimClipChange {
  edge: 'in' | 'out';
  /** New timeline position of the touched edge (ticks). */
  to: Ticks;
  ripple?: boolean;
}

export interface MoveClipTarget {
  trackId?: string;
  start: Ticks;
  mode?: OverwriteMode;
}

/** ---------- API groups ---------- */

export interface EngineProjectApi {
  create(input: CreateProjectInput): Promise<{ path: string; state: CurrentState }>;
  open(path: string): Promise<OpenProjectResult>;
  save(): Promise<{ path: string }>;
  saveAs(path: string): Promise<{ path: string }>;
  current(): Promise<CurrentState | null>;
  close(): Promise<void>;
  verifyAssets(): Promise<AssetResolution[]>;
  relinkAsset(assetId: string, newPath: string): Promise<{ asset: Asset; resolution: AssetResolution }>;
  recent(): Promise<RecentEntry[]>;
}

export interface EngineAssetsApi {
  import(paths: string[]): Promise<ImportResult>;
  remove(assetId: string): Promise<void>;
  get(assetId: string): Promise<Asset>;
}

export interface EngineTimelineApi {
  addTrack(kind: TrackKind, name?: string): Promise<Track>;
  removeTrack(trackId: string): Promise<void>;
  renameTrack(trackId: string, name: string): Promise<Track>;
  setTrackFlags(trackId: string, flags: Partial<Pick<Track, 'locked' | 'muted' | 'hidden' | 'name'>>): Promise<Track>;
  addClip(input: AddClipInput): Promise<Clip>;
  addTextClip(input: AddTextClipInput): Promise<{ asset: Asset; clip: Clip }>;
  updateClip(clipId: string, patch: UpdateClipPatch): Promise<Clip>;
  removeClip(clipId: string, opts?: { ripple?: boolean }): Promise<void>;
  duplicateClip(clipId: string, at?: Ticks): Promise<Clip>;
  splitClip(clipId: string, at: Ticks): Promise<[Clip, Clip]>;
  trimClip(clipId: string, change: TrimClipChange): Promise<Clip>;
  moveClip(clipId: string, target: MoveClipTarget): Promise<Clip>;
}

export interface EngineHistoryApi {
  undo(): Promise<boolean>;
  redo(): Promise<boolean>;
  canUndo(): Promise<boolean>;
  canRedo(): Promise<boolean>;
  /** Wrap a continuous gesture (drag, typing) — exactly one undo entry. */
  beginBatch(): Promise<void>;
  endBatch(): Promise<void>;
}

export interface EngineExportApi {
  start(options: ExportOptions): Promise<{ exportId: string }>;
  cancel(exportId: string): Promise<boolean>;
  capabilities(): Promise<ExportCapabilities>;
}

export interface EnginePersistenceApi {
  autosaveList(): Promise<AutosaveInfo[]>;
  /** Recovery is simply open() with an explicit autosave path. */
  autosaveRecover(autosavePath: string): Promise<OpenProjectResult>;
}

export interface EngineProviderApi {
  status(): Promise<ProviderStatusReport>;
}

export interface EngineApi extends
  EngineProjectApi, EngineAssetsApi, EngineTimelineApi,
  EngineHistoryApi, EngineExportApi, EnginePersistenceApi, EngineProviderApi {
  on<K extends keyof EngineEvents>(event: K, cb: (payload: EngineEvents[K]) => void): () => void;
  /** Generic dispatcher used by the IPC bridge: dispatch('timeline.splitClip', [id, at]). */
  dispatch(method: string, params?: unknown[]): Promise<unknown>;
}

export type { ProviderKind, ProviderStatusReport };
export type VeMethodPath =
  | 'project.create' | 'project.open' | 'project.save' | 'project.saveAs'
  | 'project.current' | 'project.close' | 'project.verifyAssets'
  | 'project.relinkAsset' | 'project.recent'
  | 'assets.import' | 'assets.remove' | 'assets.get'
  | 'timeline.addTrack' | 'timeline.removeTrack' | 'timeline.renameTrack'
  | 'timeline.setTrackFlags' | 'timeline.addClip' | 'timeline.addTextClip'
  | 'timeline.updateClip' | 'timeline.removeClip' | 'timeline.duplicateClip'
  | 'timeline.splitClip' | 'timeline.trimClip' | 'timeline.moveClip'
  | 'history.undo' | 'history.redo' | 'history.canUndo' | 'history.canRedo'
  | 'history.beginBatch' | 'history.endBatch'
  | 'exportMedia.start' | 'exportMedia.cancel' | 'exportMedia.capabilities'
  | 'persistence.autosaveList' | 'persistence.autosaveRecover'
  | 'providers.status';

/** Preload-exposed bridge (see contract "Engine ↔ UI boundary"). */
export interface VeBridge {
  invoke<T = unknown>(method: VeMethodPath | string, params?: unknown[]): Promise<T>;
  on<K extends keyof EngineEvents>(event: K, cb: (payload: EngineEvents[K]) => void): () => void;
}
