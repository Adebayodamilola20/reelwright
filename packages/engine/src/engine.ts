/**
 * The engine facade — implements the EngineApi contract groups and emits
 * EngineEvents. No Electron, no DOM: usable from Node, tests, or an
 * Electron main process (via the IPC dispatcher).
 */

import { existsSync, mkdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import type {
  AddClipInput,
  AddTextClipInput,
  ChangeReason,
  CreateProjectInput,
  EngineAssetsApi,
  EngineEvents,
  EngineExportApi,
  EngineHistoryApi,
  EnginePersistenceApi,
  EngineProjectApi,
  EngineProviderApi,
  EngineTimelineApi,
  ImportResult,
  MoveClipTarget,
  OpenProjectResult,
  TrimClipChange,
  UpdateClipPatch,
} from './api.js';
import { EngineError, toErrorShape } from './errors.js';
import { Emitter } from './events.js';
import { newId } from './ids.js';
import { computeRelPath, relinkAsset as relinkAssetCheck, resolveAllAssets, resolveAssetPath } from './media/assets.js';
import { assetFromProbe, probeMedia } from './media/probe.js';
import { resolveTool } from './media/tools.js';
import * as timelineOps from './ops/timeline.js';
import {
  RecentStore,
  listAutosaves,
  newestAutosave,
  readProject,
  withRelPaths,
  writeAutosave,
  writeProjectAtomic,
} from './persistence/persistence.js';
import { probeCapabilities } from './export/capabilities.js';
import { buildFfmpegJob } from './export/plan.js';
import { ExportManager } from './export/runner.js';
import { ProviderRegistry } from './providers/providers.js';
import { ProjectStore } from './store/store.js';
import { TICKS_PER_SECOND, rat } from './time.js';
import { PROJECT_FILE_EXTENSION } from './types.js';
import type {
  Asset,
  AssetResolution,
  AutosaveInfo,
  Clip,
  CurrentState,
  ExportCapabilities,
  ExportOptions,
  ProjectFile,
  ProjectSettings,
  RecentEntry,
  Track,
  TrackKind,
} from './types.js';

export interface EngineOptions {
  /** Local app-data dir (recent projects list). Default: ~/.ve-editor */
  appDataDir?: string;
  /** Autosave interval in ms; 0 disables. Default 30_000. */
  autosaveIntervalMs?: number;
  /** Undo depth. Default 100. */
  historyLimit?: number;
  ffmpegPath?: string;
  ffprobePath?: string;
}

export const DEFAULT_SETTINGS: ProjectSettings = {
  width: 1920,
  height: 1080,
  frameRate: rat(30),
  sampleRate: 48000,
  channels: 2,
  background: '#000000',
};

export interface EngineInstance {
  readonly project: EngineProjectApi;
  readonly assets: EngineAssetsApi;
  readonly timeline: EngineTimelineApi;
  readonly history: EngineHistoryApi;
  readonly exportMedia: EngineExportApi;
  readonly persistence: EnginePersistenceApi;
  readonly providers: EngineProviderApi;
  on<K extends keyof EngineEvents>(event: K, cb: (payload: EngineEvents[K]) => void): () => void;
  dispatch(method: string, params?: unknown[]): Promise<unknown>;
  /** Synchronous access for in-process consumers (CLI/tests). */
  readonly store: ProjectStore;
  dispose(): void;
}

export function createEngine(options: EngineOptions = {}): EngineInstance {
  const appDataDir = options.appDataDir ?? join(homedir(), '.ve-editor');
  const autosaveIntervalMs = options.autosaveIntervalMs ?? 30_000;
  const ffmpegPath = resolveTool('ffmpeg', options.ffmpegPath);
  const ffprobePath = resolveTool('ffprobe', options.ffprobePath);
  const store = new ProjectStore(options.historyLimit ?? 100);
  const emitter = new Emitter<EngineEvents>();
  const recent = new RecentStore(appDataDir);
  const providers = new ProviderRegistry();
  const exportManager = new ExportManager((event, payload) => emitter.emit(event, payload), ffmpegPath);

  let currentPath: string | null = null;
  let resolutions: AssetResolution[] = [];
  let autosaveTimer: NodeJS.Timeout | null = null;
  let lastAutosaveMs = 0;
  let capabilitiesPromise: Promise<ExportCapabilities> | null = null;

  store.onChange = (change) => {
    emitter.emit('project:change', { revision: change.revision, reason: change.reason as ChangeReason });
    if (currentPath && store.isOpen()) maybeAutosave();
  };

  function requireProject(): ProjectFile {
    return store.get();
  }

  function requirePath(): string {
    if (!currentPath) throw new EngineError('NOT_FOUND', 'No project is open.');
    return currentPath;
  }

  function refreshResolutions(): AssetResolution[] {
    const project = store.tryGet();
    if (!project || !currentPath) {
      resolutions = [];
      return resolutions;
    }
    resolutions = resolveAllAssets(project.assets, dirname(resolve(currentPath)));
    return resolutions;
  }

  function currentState(): CurrentState {
    const project = store.tryGet();
    return {
      path: currentPath,
      revision: store.revision,
      dirty: store.dirty,
      project: project ? structuredClone(project) : null,
      assets: resolutions.map((r) => ({ ...r })),
    };
  }

  function resolvedPathFor(assetId: string): string {
    const res = resolutions.find((r) => r.assetId === assetId);
    if (res?.status === 'ok' && res.resolvedPath) return res.resolvedPath;
    const project = requireProject();
    const asset = project.assets.find((a) => a.id === assetId);
    if (!asset) throw new EngineError('NOT_FOUND', `Asset ${assetId} not found.`);
    throw new EngineError('ASSET_MISSING', `Media file for asset "${asset.name}" is missing.`,
      `Looked for: ${asset.source.path}`);
  }

  function startAutosave(): void {
    stopAutosave();
    if (autosaveIntervalMs <= 0) return;
    autosaveTimer = setInterval(() => maybeAutosave(true), autosaveIntervalMs);
    autosaveTimer.unref();
  }

  function stopAutosave(): void {
    if (autosaveTimer) {
      clearInterval(autosaveTimer);
      autosaveTimer = null;
    }
  }

  function maybeAutosave(force = false): void {
    if (!currentPath || !store.dirty) return;
    const now = Date.now();
    // Time-throttled on op bursts; the interval timer calls with force.
    if (!force && now - lastAutosaveMs < 5000) return;
    lastAutosaveMs = now;
    const project = store.tryGet();
    if (project) writeAutosave(project, currentPath);
  }

  const projectApi: EngineProjectApi = {
    async create(input: CreateProjectInput) {
      if (!input.name?.trim()) throw new EngineError('INVALID_ARGUMENT', 'Project name cannot be empty.');
      const dir = resolve(input.dir || process.cwd());
      mkdirSync(dir, { recursive: true });
      const settings: ProjectSettings = { ...DEFAULT_SETTINGS, ...(input.settings ?? {}) };
      if (input.settings?.frameRate) settings.frameRate = rat(input.settings.frameRate.n, input.settings.frameRate.d);
      const project = timelineOps.makeEmptyProject(newId('prj'), input.name.trim(), settings);
      timelineOps.seedDefaultTracks(project);
      const path = join(dir, `${input.name.trim()}${PROJECT_FILE_EXTENSION}`);
      writeProjectAtomic(withRelPaths(project, path), path);
      currentPath = path;
      store.load(project);
      store.markSaved();
      refreshResolutions();
      recent.push({ path, name: project.name });
      startAutosave();
      return { path, state: currentState() };
    },

    async open(path: string) {
      const resolved = resolve(path);
      const project = readProject(resolved);
      currentPath = resolved;
      store.load(project);
      refreshResolutions();
      recent.push({ path: resolved, name: project.name });
      startAutosave();
      let recovered: AutosaveInfo | undefined;
      const newest = newestAutosave(resolved);
      if (newest && newest.modifiedMs > statSync(resolved).mtimeMs) recovered = newest;
      const result: OpenProjectResult = { state: currentState() };
      if (recovered) result.recoveredAutosave = recovered;
      return result;
    },

    async save() {
      const path = requirePath();
      const project = requireProject();
      const stamped: ProjectFile = { ...structuredClone(project), modifiedAt: new Date().toISOString() };
      writeProjectAtomic(withRelPaths(stamped, path), path);
      store.update((draft) => {
        draft.modifiedAt = stamped.modifiedAt;
        for (const asset of draft.assets) {
          const src = stamped.assets.find((a) => a.id === asset.id);
          if (src?.source.relPath) asset.source.relPath = src.source.relPath;
          else delete asset.source.relPath;
        }
      });
      store.markSaved();
      emitter.emit('project:saved', { path, revision: store.revision });
      return { path };
    },

    async saveAs(path: string) {
      const target = isAbsolute(path) ? path : join(dirname(requirePath()), path);
      currentPath = target;
      refreshResolutions();
      return projectApi.save();
    },

    async current() {
      return store.isOpen() ? currentState() : null;
    },

    async close() {
      stopAutosave();
      exportManager.killAll();
      store.clear();
      currentPath = null;
      refreshResolutions();
    },

    async verifyAssets() {
      return refreshResolutions();
    },

    async relinkAsset(assetId: string, newPath: string) {
      const project = requireProject();
      const dir = dirname(resolve(requirePath()));
      const asset = project.assets.find((a) => a.id === assetId);
      if (!asset) throw new EngineError('NOT_FOUND', `Asset ${assetId} not found.`);
      const updated = relinkAssetCheck(asset, isAbsolute(newPath) ? newPath : resolve(newPath), dir);
      store.transact((draft) => {
        const idx = draft.assets.findIndex((a) => a.id === assetId);
        draft.assets[idx] = updated;
      });
      refreshResolutions();
      emitter.emit('assets:changed', { revision: store.revision });
      const resolution = resolutions.find((r) => r.assetId === assetId)!;
      return { asset: structuredClone(updated), resolution };
    },

    async recent(): Promise<RecentEntry[]> {
      return recent.list();
    },
  };

  const assetsApi: EngineAssetsApi = {
    async import(paths: string[]): Promise<ImportResult> {
      const project = requireProject();
      const dir = dirname(resolve(requirePath()));
      const result: ImportResult = { imported: [], existing: [], failed: [] };
      for (const rawPath of paths) {
        const abs = resolve(rawPath);
        try {
          if (!existsSync(abs)) throw new EngineError('NOT_FOUND', `File not found: ${abs}`);
          const already = project.assets.find((a) => a.source.path === abs && a.kind !== 'text');
          if (already) {
            result.existing.push(structuredClone(already));
            continue;
          }
          const stat = statSync(abs);
          const { kind, meta } = await probeMedia(abs, ffprobePath);
          const relPath = computeRelPath(abs, dir);
          const asset = assetFromProbe(abs, kind, meta, relPath, {
            sizeBytes: stat.size,
            modifiedMs: Math.round(stat.mtimeMs),
          });
          store.transact((draft) => {
            draft.assets.push(asset);
          });
          result.imported.push(structuredClone(asset));
        } catch (e) {
          result.failed.push({ path: rawPath, error: toErrorShape(e) });
        }
      }
      refreshResolutions();
      if (result.imported.length > 0) emitter.emit('assets:changed', { revision: store.revision });
      return result;
    },

    async remove(assetId: string) {
      const project = requireProject();
      const asset = project.assets.find((a) => a.id === assetId);
      if (!asset) throw new EngineError('NOT_FOUND', `Asset ${assetId} not found.`);
      store.transact((draft) => {
        const used = timelineOps.clipCountForAsset(draft, assetId);
        if (used > 0) {
          throw new EngineError('INVALID_ARGUMENT',
            `Asset "${asset.name}" is used by ${used} clip(s).`,
            'Remove the clips first.');
        }
        draft.assets = draft.assets.filter((a) => a.id !== assetId);
      });
      refreshResolutions();
      emitter.emit('assets:changed', { revision: store.revision });
    },

    async get(assetId: string): Promise<Asset> {
      const asset = requireProject().assets.find((a) => a.id === assetId);
      if (!asset) throw new EngineError('NOT_FOUND', `Asset ${assetId} not found.`);
      return structuredClone(asset);
    },
  };

  function op<T>(fn: (draft: ProjectFile) => T): T {
    return store.transact(fn);
  }

  const timelineApi: EngineTimelineApi = {
    async addTrack(kind: TrackKind, name?: string): Promise<Track> {
      return structuredClone(op((d) => timelineOps.addTrack(d, kind, name)));
    },
    async removeTrack(trackId: string) {
      op((d) => timelineOps.removeTrack(d, trackId));
    },
    async renameTrack(trackId: string, name: string): Promise<Track> {
      return structuredClone(op((d) => timelineOps.renameTrack(d, trackId, name)));
    },
    async setTrackFlags(trackId, flags): Promise<Track> {
      return structuredClone(op((d) => timelineOps.setTrackFlags(d, trackId, flags)));
    },
    async addClip(input: AddClipInput): Promise<Clip> {
      return structuredClone(op((d) => timelineOps.addClip(d, input)));
    },
    async addTextClip(input: AddTextClipInput) {
      const res = op((d) => timelineOps.addTextClip(d, input));
      return structuredClone(res);
    },
    async updateClip(clipId: string, patch: UpdateClipPatch): Promise<Clip> {
      timelineOps.assertClipPatchSupported(patch as Record<string, unknown>);
      return structuredClone(op((d) => timelineOps.updateClip(d, clipId, patch)));
    },
    async removeClip(clipId: string, opts?: { ripple?: boolean }) {
      op((d) => timelineOps.removeClip(d, clipId, opts));
    },
    async duplicateClip(clipId: string, at?: number): Promise<Clip> {
      return structuredClone(op((d) => timelineOps.duplicateClip(d, clipId, at)));
    },
    async splitClip(clipId: string, at: number): Promise<[Clip, Clip]> {
      return structuredClone(op((d) => timelineOps.splitClip(d, clipId, at)));
    },
    async trimClip(clipId: string, change: TrimClipChange): Promise<Clip> {
      return structuredClone(op((d) => timelineOps.trimClip(d, clipId, change)));
    },
    async moveClip(clipId: string, target: MoveClipTarget): Promise<Clip> {
      return structuredClone(op((d) => timelineOps.moveClip(d, clipId, target)));
    },
  };

  const historyApi: EngineHistoryApi = {
    async undo() {
      return store.undo();
    },
    async redo() {
      return store.redo();
    },
    async canUndo() {
      return store.canUndo();
    },
    async canRedo() {
      return store.canRedo();
    },
    async beginBatch() {
      store.beginBatch();
    },
    async endBatch() {
      store.endBatch();
    },
  };

  function getCapabilities(): Promise<ExportCapabilities> {
    if (!capabilitiesPromise) capabilitiesPromise = probeCapabilities(ffmpegPath);
    return capabilitiesPromise;
  }

  const exportApi: EngineExportApi = {
    async start(options: ExportOptions) {
      const project = requireProject();
      const caps = await getCapabilities();
      const resolvedPaths = new Map<string, string>();
      for (const asset of project.assets) {
        if (asset.kind === 'text') continue;
        const res = resolveAssetPath(asset, dirname(resolve(requirePath())));
        if (res.status === 'ok' && res.resolvedPath) resolvedPaths.set(asset.id, res.resolvedPath);
      }
      const job = buildFfmpegJob(project, resolvedPaths, options, caps);
      return exportManager.start(job, options.outputPath);
    },
    async cancel(exportId: string) {
      return exportManager.cancel(exportId);
    },
    async capabilities() {
      return getCapabilities();
    },
  };

  const persistenceApi: EnginePersistenceApi = {
    async autosaveList(): Promise<AutosaveInfo[]> {
      return listAutosaves(requirePath());
    },
    async autosaveRecover(autosavePath: string) {
      return projectApi.open(autosavePath);
    },
  };

  const providerApi: EngineProviderApi = {
    async status() {
      return providers.status();
    },
  };

  const groups: Record<string, Record<string, unknown>> = {
    project: projectApi as unknown as Record<string, unknown>,
    assets: assetsApi as unknown as Record<string, unknown>,
    timeline: timelineApi as unknown as Record<string, unknown>,
    history: historyApi as unknown as Record<string, unknown>,
    exportMedia: exportApi as unknown as Record<string, unknown>,
    persistence: persistenceApi as unknown as Record<string, unknown>,
    providers: providerApi as unknown as Record<string, unknown>,
  };

  const instance: EngineInstance = {
    project: projectApi,
    assets: assetsApi,
    timeline: timelineApi,
    history: historyApi,
    exportMedia: exportApi,
    persistence: persistenceApi,
    providers: providerApi,
    on: (event, cb) => emitter.on(event, cb),
    dispatch(method: string, params: unknown[] = []) {
      const [group, name] = method.split('.');
      const target = groups[group]?.[name];
      if (typeof target !== 'function') {
        return Promise.reject(new EngineError('NOT_FOUND', `Unknown engine method "${method}".`));
      }
      try {
        return Promise.resolve((target as (...a: unknown[]) => unknown).apply(null, params));
      } catch (e) {
        return Promise.reject(e);
      }
    },
    store,
    dispose() {
      stopAutosave();
      exportManager.killAll();
      emitter.removeAll();
    },
  };
  return instance;
}
