/**
 * Service boundary between the UI and the engine (`window.ve` dispatcher).
 *
 * STATUS: Designed by Agent 2 as a *requirement*; Agent 1's contract v1 will
 * define the real shape. Until `window.ve` exists, `getServices()` returns
 * null and every engine-dependent control renders disabled with an accurate
 * reason (never fake-functional).
 *
 * When contract v1 lands: write an adapter in `services-adapter.ts` that maps
 * `window.ve` onto this interface, and record any mismatches in
 * docs/PROJECT_CONTRACT.md → "Contract review notes".
 */

export type MediaKind = "video" | "audio" | "image";

export interface AssetInfo {
  id: string;
  name: string;
  kind: MediaKind;
  path: string;
  durationSec?: number; // images: undefined
  width?: number;
  height?: number;
  fps?: number;
  hasAudio: boolean;
  codec?: string;
  thumbUrl?: string;
  /** True when the file no longer exists at `path` */
  missing?: boolean;
}

export interface ClipInfo {
  id: string;
  assetId: string;
  trackId: string;
  /** Timeline position, seconds */
  startSec: number;
  /** Duration on timeline, seconds */
  durationSec: number;
  /** Source in/out points, seconds */
  sourceInSec: number;
  sourceOutSec: number;
}

export interface TrackInfo {
  id: string;
  kind: "video" | "audio" | "text";
  name: string;
  clips: ClipInfo[];
  muted?: boolean;
  locked?: boolean;
}

export interface TextLayerInfo {
  id: string;
  trackId: string;
  startSec: number;
  durationSec: number;
  text: string;
  style: Record<string, string | number>;
}

export interface ProjectSummary {
  id: string;
  name: string;
  modifiedAt: number;
  durationSec: number;
  clipCount: number;
}

export interface EngineState {
  project: { id: string; name: string; fps: number; dirty: boolean };
  assets: AssetInfo[];
  tracks: TrackInfo[];
  textLayers: TextLayerInfo[];
  /** Playhead position, seconds */
  playheadSec: number;
  playing: boolean;
}

export interface ExportSettings {
  outputPath: string;
  container: "mp4" | "mov" | "webm" | "mkv";
  videoCodec: string;
  audioCodec: string;
  width: number;
  height: number;
  fps: number;
  /** quality preset or explicit bitrate */
  quality: "low" | "medium" | "high" | "custom";
  bitrateKbps?: number;
  /** burn text layers into frames (requires engine capability) */
  burnText?: boolean;
  includeSidecarSrt?: boolean;
}

export interface ExportProgress {
  pct: number; // 0..1
  stage: string;
  etaSec?: number;
}

export interface EngineCapabilities {
  textBurnIn: boolean;
  textBurnInReason?: string;
  containers: string[];
  videoCodecs: string[];
  audioCodecs: string[];
  resolutions: Array<{ label: string; width: number; height: number }>;
  fpsPresets: number[];
}

/** Events the UI subscribes to (names to be reconciled with contract v1). */
export interface EngineEvents {
  "project:loaded": () => void;
  "project:saved": () => void;
  "project:dirty": () => void;
  "timeline:changed": () => void;
  "playhead:update": (p: { timeSec: number; playing: boolean }) => void;
  "playback:ended": () => void;
  "import:progress": (p: { done: number; total: number; path?: string }) => void;
  "import:completed": () => void;
  "import:failed": (p: { path: string; error: string }) => void;
  "export:progress": (p: ExportProgress) => void;
  "export:completed": (p: { outputPath: string }) => void;
  "export:failed": (p: { error: string }) => void;
  "export:cancelled": () => void;
  "asset:missing": (p: { assetId: string }) => void;
  "asset:relinked": (p: { assetId: string }) => void;
  error: (p: { scope: string; message: string; detail?: string }) => void;
}

export type EngineEventName = keyof EngineEvents;

export interface EngineServices {
  // Projects
  listProjects(): Promise<ProjectSummary[]>;
  createProject(name: string): Promise<void>;
  openProject(id: string): Promise<void>;
  saveProject(): Promise<void>;
  closeProject(): Promise<void>;
  getState(): EngineState;
  canUndo(): boolean;
  canRedo(): boolean;
  undo(): Promise<void>;
  redo(): Promise<void>;

  // Media
  pickFiles(): Promise<string[]>; // dialog handled where? see contract
  importFiles(paths: string[]): Promise<AssetInfo[]>;
  generateThumb(assetId: string): Promise<string | undefined>;
  /** Waveform peaks, min/max pairs per bucket */
  getWaveformPeaks(assetId: string, buckets: number): Promise<Float32Array>;

  // Timeline commands
  addClip(cmd: { assetId: string; trackId?: string; atSec: number }): Promise<void>;
  moveClip(clipId: string, trackId: string, atSec: number): Promise<void>;
  trimClip(clipId: string, edge: "start" | "end", timeSec: number): Promise<void>;
  splitClip(clipId: string, timeSec: number): Promise<void>;
  removeClips(clipIds: string[]): Promise<void>;
  duplicateClip(clipId: string): Promise<void>;
  addTextLayer(cmd: { text: string; startSec: number; durationSec: number }): Promise<void>;
  updateTextLayer(id: string, patch: Partial<TextLayerInfo>): Promise<void>;

  // Playback
  play(): void;
  pause(): void;
  seek(timeSec: number): void;
  setVolume(v: number): void;

  // Export
  capabilities(): EngineCapabilities;
  startExport(settings: ExportSettings): Promise<void>;
  cancelExport(): void;

  // Events
  on<E extends EngineEventName>(event: E, listener: EngineEvents[E]): () => void;
}

declare global {
  interface Window {
    ve?: EngineServices;
  }
}

/**
 * Returns the engine services if the bridge is present, else null.
 * UI must handle null by disabling engine-backed controls with a reason.
 */
export function getServices(): EngineServices | null {
  return typeof window !== "undefined" && window.ve ? window.ve : null;
}

/** Accurate, user-facing reason when the engine bridge isn available. */
export const NO_ENGINE_REASON =
  "Engine not connected — this control will work once the media engine is loaded.";

/**
 * Helper: mark a control disabled with an honest reason.
 * Uses aria-disabled + title so hover/focus explains why (charter rule).
 */
export function disableWithReason(
  control: HTMLElement,
  reason: string,
): void {
  control.setAttribute("aria-disabled", "true");
  control.setAttribute("title", reason);
  if (control instanceof HTMLButtonElement) control.disabled = true;
}
