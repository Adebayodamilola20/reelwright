/**
 * Data shapes — the normative project model (see docs/PROJECT_CONTRACT.md).
 * Everything here is JSON-serializable plain data.
 */

import type { Ticks, Rational } from './time.js';

export const SCHEMA_VERSION = 1;
export const PROJECT_FILE_EXTENSION = '.veproj';

export interface ProjectSettings {
  width: number;
  height: number;
  frameRate: Rational;
  sampleRate: number;
  channels: number;
  /** '#rrggbb' — background/base color used at render. */
  background: string;
}

export type AssetKind = 'video' | 'audio' | 'image' | 'text';

export interface TextContent {
  text: string;
  style: {
    fontFamily: string;
    fontSizePx: number;
    color: string;
    bold: boolean;
    italic: boolean;
    align: 'left' | 'center' | 'right';
    background: string | null;
    lineHeight: number;
  };
}

export interface AssetMeta {
  durationTicks?: Ticks;
  video?: {
    codec: string;
    width: number;
    height: number;
    frameRate?: Rational;
    pixelFormat?: string;
    rotationDeg?: number;
  };
  audio?: {
    codec: string;
    channels: number;
    sampleRate: number;
  };
  format?: {
    formatName: string;
    bitRate?: number;
    sizeBytes?: number;
  };
  probedAt: string;
}

export interface Asset {
  id: string;
  kind: AssetKind;
  name: string;
  source: {
    /** Best-known absolute path at last use. */
    path: string;
    /** Path relative to the .veproj directory when media lives beside/near it. */
    relPath?: string;
  };
  /** Present for file-backed assets; used for relink verification. */
  file?: {
    sizeBytes: number;
    modifiedMs: number;
  };
  meta: AssetMeta;
  /** kind === 'text' — generated asset stored inline in the project. */
  text?: TextContent;
}

/** Runtime-only (never persisted) asset resolution state. */
export interface AssetResolution {
  assetId: string;
  status: 'ok' | 'missing';
  resolvedPath?: string;
}

export type TrackKind = 'video' | 'audio';

export interface ClipAudio {
  volume: number; // linear gain, 1 = unity (0 dB)
  fadeIn: Ticks;
  fadeOut: Ticks;
  muted: boolean;
  pan: number; // -1..1 (reserved; not yet rendered)
}

export interface Transform {
  x: number; // px, origin = program center, +y down
  y: number;
  scale: number; // 1 = 100%, uniform
  rotationDeg: number; // clockwise (stored; not yet rendered on export)
  opacity: number; // 0..1
}

export type KeyframeProp =
  | 'transform.x'
  | 'transform.y'
  | 'transform.scale'
  | 'transform.rotationDeg'
  | 'transform.opacity'
  | 'audio.volume';

export type Easing = 'linear' | 'easeIn' | 'easeOut' | 'easeInOut' | 'hold';

export interface Keyframe {
  prop: KeyframeProp;
  at: Ticks;
  value: number;
  easing: Easing;
}

export interface Clip {
  id: string;
  assetId: string;
  /** Timeline position of clip head. */
  start: Ticks;
  /** Timeline length (> 0). */
  duration: Ticks;
  /** Asset offset where playback begins. */
  sourceIn: Ticks;
  /** 1/1 default. Source span consumed = duration * speed (v1: only 1/1 usable). */
  speed: Rational;
  enabled: boolean;
  audio: ClipAudio;
  transform?: Transform;
  text?: TextContent;
  keyframes: Keyframe[]; // v1: stored, not evaluated (see feature matrix)
}

export interface Track {
  id: string;
  kind: TrackKind;
  name: string;
  locked: boolean;
  muted: boolean;
  hidden: boolean;
  /** Always kept sorted by start, then id. */
  clips: Clip[];
}

export interface Marker {
  id: string;
  at: Ticks;
  label: string;
  color?: string;
}

export interface ProjectFile {
  schemaVersion: number;
  id: string;
  name: string;
  createdAt: string;
  modifiedAt: string;
  /** Recorded constant; readers must honor it. */
  timebase: number;
  settings: ProjectSettings;
  assets: Asset[];
  /** Order matters: video tracks later in the array render on top. */
  tracks: Track[];
  markers: Marker[];
}

/** ---------- Export ---------- */

export type ExportContainer = 'mp4' | 'mov' | 'mkv' | 'webm' | 'mp3' | 'wav';

export interface ExportOptions {
  outputPath: string;
  container: ExportContainer;
  video?: {
    codec: 'h264' | 'prores' | 'vp9' | 'none';
    width?: number;
    height?: number;
    frameRate?: Rational;
    quality: 'draft' | 'standard' | 'high';
  } | null;
  audio?: {
    codec: 'aac' | 'mp3' | 'opus' | 'pcm_s16le' | 'none';
    bitrateKbps?: number;
  } | null;
  /** Timeline range; default whole program. */
  range?: { start: Ticks; end: Ticks };
}

export interface ExportCapabilities {
  ffmpegPath: string;
  ffmpegVersion: string;
  /** False when the local ffmpeg lacks libfreetype (drawtext). */
  textBurnIn: boolean;
  containers: ExportContainer[];
  videoCodecs: string[];
  audioCodecs: string[];
}

/** ---------- Misc API payloads ---------- */

export interface CurrentState {
  path: string | null;
  revision: number;
  dirty: boolean;
  project: ProjectFile | null;
  assets: AssetResolution[];
}

export interface RecentEntry {
  path: string;
  name: string;
  openedAt: string;
}

export interface AutosaveInfo {
  path: string;
  modifiedMs: number;
}
