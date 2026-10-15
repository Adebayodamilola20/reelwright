/** @ve/engine — public entry point. */

export * from './time.js';
export * from './types.js';
export * from './errors.js';
export * from './api.js';
export { newId } from './ids.js';
export { Emitter } from './events.js';
export { ProjectStore } from './store/store.js';
export * as timelineOps from './ops/timeline.js';
export { probeMedia, ffprobeJson, classifyKind } from './media/probe.js';
export { resolveTool } from './media/tools.js';
export {
  computeRelPath,
  relinkAsset,
  resolveAllAssets,
  resolveAssetPath,
  projectDirOf,
} from './media/assets.js';
export {
  autosaveDirOf,
  autosaveFilePathFor,
  listAutosaves,
  newestAutosave,
  readProject,
  validateProjectShape,
  withRelPaths,
  writeAutosave,
  writeProjectAtomic,
  RecentStore,
} from './persistence/persistence.js';
export { probeCapabilities } from './export/capabilities.js';
export { buildFfmpegJob } from './export/plan.js';
export { ExportManager } from './export/runner.js';
export * from './providers/providers.js';
export { createEngine, DEFAULT_SETTINGS } from './engine.js';
export type { EngineInstance, EngineOptions } from './engine.js';
export { createEngineDispatcher } from './ipc/dispatcher.js';
export type { Dispatcher } from './ipc/dispatcher.js';
