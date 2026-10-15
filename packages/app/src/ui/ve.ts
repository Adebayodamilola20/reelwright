/**
 * Single import site for the engine contract inside the UI.
 *
 * - `import type` from "@ve/engine" → api.ts (all erased at build; zero runtime coupling)
 * - value imports only from "@ve/engine/time" → time.ts (dependency-free)
 *
 * Vite aliases (vite.config.ts) and tsconfig paths map these specifiers to the
 * engine's *source* — the engine ships no Electron/DOM code (contract rule 1),
 * so bundling from source is safe. When @ve/engine's dist lands, the aliases
 * can switch to dist without touching any consumer.
 */

export type {
  VeBridge,
  VeMethodPath,
  EngineEvents,
  ChangeReason,
  CreateProjectInput,
  OpenProjectResult,
  ImportResult,
  OverwriteMode,
  AddClipInput,
  AddTextClipInput,
  UpdateClipPatch,
  TrimClipChange,
  MoveClipTarget,
} from "@ve/engine";

export type {
  CurrentState,
  ProjectFile,
  ProjectSettings,
  Asset,
  AssetKind,
  AssetMeta,
  AssetResolution,
  Track,
  TrackKind,
  Clip,
  ClipAudio,
  Transform,
  TextContent,
  Keyframe,
  Marker,
  ExportOptions,
  ExportCapabilities,
  ExportContainer,
  RecentEntry,
  AutosaveInfo,
} from "@ve/engine/types";

export {
  TICKS_PER_SECOND,
  secFromTicks,
  ticksFromSec,
  frameDurTicks,
  frameFloor,
  frameCeil,
  ticksToFrameIndex,
  ticksToFrames,
  framesToTicks,
  formatTimecode,
  parseTimecode,
  fsec,
  rat,
  ratValue,
  ratToString,
} from "@ve/engine/time";

export type { Ticks, Rational } from "@ve/engine/time";
