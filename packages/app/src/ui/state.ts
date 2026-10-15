/**
 * UI application state store (renderer-side only).
 *
 * - Engine snapshot (`CurrentState`) is fetched from `project.current()` and
 *   refreshed on every `project:change` / `assets:changed` (contract sync model).
 * - Playhead + playback clock are UI-owned for v1 (contract review note #1 —
 *   the engine stores timeline data only; the monitor/timeline run the clock).
 * - Selection, zoom, snapping, active tool are pure UI state.
 */

import type { CurrentState, Ticks } from "./ve.js";
import { TICKS_PER_SECOND } from "./ve.js";
import { call, onEvent, bridge } from "./bridge.js";

export type Tool = "select" | "text";

export interface UiState {
  connected: boolean;
  /** null when no project is open */
  state: CurrentState | null;
  playhead: Ticks;
  playing: boolean;
  /** selected clip ids */
  selection: Set<string>;
  pxPerSec: number;
  snapping: boolean;
  tool: Tool;
  /** assetId → missing (from project.verifyAssets) */
  missing: Set<string>;
  /** last project:saved info for the status bar */
  lastSavedAt: number | null;
  busy: string | null;
}

type Listener = () => void;

const listeners = new Set<Listener>();

const ui: UiState = {
  connected: bridge() !== null,
  state: null,
  playhead: 0,
  playing: false,
  selection: new Set(),
  pxPerSec: 80,
  snapping: true,
  tool: "select",
  missing: new Set(),
  lastSavedAt: null,
  busy: null,
};

export const MIN_ZOOM = 8; // px/sec
export const MAX_ZOOM = 800; // px/sec

export function getState(): UiState {
  return ui;
}

export function subscribe(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function notify(): void {
  for (const fn of [...listeners]) fn();
}

/* ------------------------------------------------------------------ *
 * Engine snapshot sync
 * ------------------------------------------------------------------ */

let refreshQueued = false;

/** Re-fetch the full snapshot (cheap; contract sync model). */
export async function refreshState(): Promise<void> {
  if (!ui.connected) return;
  try {
    const state = await call<CurrentState | null>("project.current");
    ui.state = state;
    if (!state) {
      ui.selection.clear();
      ui.playhead = 0;
      ui.playing = false;
    } else {
      // Drop selections that no longer exist.
      const alive = new Set<string>();
      for (const t of state.project?.tracks ?? []) for (const c of t.clips) alive.add(c.id);
      for (const id of [...ui.selection]) if (!alive.has(id)) ui.selection.delete(id);
      // Clamp playhead to program.
      const end = programEndTicks();
      if (ui.playhead > end) ui.playhead = end;
    }
    notify();
  } catch (err) {
    console.error("[state] project.current failed", err);
    notify();
  }
}

function queueRefresh(): void {
  if (refreshQueued) return;
  refreshQueued = true;
  queueMicrotask(() => {
    refreshQueued = false;
    void refreshState();
  });
}

/** Verify asset paths after open/relink; fills the missing set. */
export async function verifyAssets(): Promise<void> {
  if (!ui.state) return;
  try {
    const res = await call<Array<{ assetId: string; status: "ok" | "missing" }>>(
      "project.verifyAssets",
    );
    ui.missing = new Set(res.filter((r) => r.status === "missing").map((r) => r.assetId));
    notify();
  } catch (err) {
    console.error("[state] verifyAssets failed", err);
  }
}

let wired = false;

/** Attach engine event subscriptions (idempotent). */
export function wireEngineEvents(): void {
  if (wired || !ui.connected) return;
  wired = true;
  onEvent("project:change", queueRefresh);
  onEvent("assets:changed", queueRefresh);
  onEvent("project:saved", ({ revision }) => {
    ui.lastSavedAt = Date.now();
    if (ui.state) {
      ui.state.revision = revision;
      ui.state.dirty = false;
    }
    notify();
  });
  // Export events are handled by the export dialog, which owns its job ids.
  void refreshState();
}

/* ------------------------------------------------------------------ *
 * Playhead (UI-owned for v1)
 * ------------------------------------------------------------------ */

export function setPlayhead(t: Ticks, opts: { snapToFrame?: boolean } = {}): void {
  const clamped = Math.max(0, Math.min(t, Math.max(programEndTicks(), 0)));
  ui.playhead = opts.snapToFrame ? frameFloorSafe(clamped) : clamped;
  notify();
}

function frameFloorSafe(t: Ticks): Ticks {
  const fps = ui.state?.project?.settings.frameRate;
  if (!fps) return Math.round(t);
  const frame = Math.floor((t * fps.n) / (TICKS_PER_SECOND * fps.d));
  return Math.round((frame * TICKS_PER_SECOND * fps.d) / fps.n);
}

export function setPlaying(playing: boolean): void {
  if (ui.playing === playing) return;
  ui.playing = playing;
  notify();
}

/* ------------------------------------------------------------------ *
 * Selection / view state
 * ------------------------------------------------------------------ */

export function selectClip(id: string, mode: "replace" | "toggle" = "replace"): void {
  if (mode === "replace") {
    ui.selection.clear();
    ui.selection.add(id);
  } else if (ui.selection.has(id)) {
    ui.selection.delete(id);
  } else {
    ui.selection.add(id);
  }
  notify();
}

export function clearSelection(): void {
  if (ui.selection.size === 0) return;
  ui.selection.clear();
  notify();
}

export function selectAll(): void {
  if (!ui.state?.project) return;
  ui.selection.clear();
  for (const t of ui.state.project.tracks) for (const c of t.clips) ui.selection.add(c.id);
  notify();
}

export function setZoom(pxPerSec: number): void {
  ui.pxPerSec = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, pxPerSec));
  notify();
}

export function toggleSnap(): void {
  ui.snapping = !ui.snapping;
  notify();
}

export function setTool(tool: Tool): void {
  ui.tool = tool;
  notify();
}

export function setBusy(text: string | null): void {
  ui.busy = text;
  notify();
}

/* ------------------------------------------------------------------ *
 * Derived helpers
 * ------------------------------------------------------------------ */

/** Total program length in ticks (end of last clip across all tracks). */
export function programEndTicks(): Ticks {
  let end = 0;
  for (const t of ui.state?.project?.tracks ?? []) {
    for (const c of t.clips) end = Math.max(end, c.start + c.duration);
  }
  return end;
}

export function ticksToPx(t: Ticks): number {
  return (t / TICKS_PER_SECOND) * ui.pxPerSec;
}

export function pxToTicks(px: number): Ticks {
  return Math.round((px / ui.pxPerSec) * TICKS_PER_SECOND);
}

/** Selected clips resolved against the current snapshot (empty when none). */
export function selectedClips(): Array<{ trackId: string; clip: import("./ve.js").Clip }> {
  const out: Array<{ trackId: string; clip: import("./ve.js").Clip }> = [];
  for (const t of ui.state?.project?.tracks ?? []) {
    for (const c of t.clips) {
      if (ui.selection.has(c.id)) out.push({ trackId: t.id, clip: c });
    }
  }
  return out;
}

export function assetById(id: string): import("./ve.js").Asset | undefined {
  return ui.state?.project?.assets.find((a) => a.id === id);
}

export function trackById(id: string): import("./ve.js").Track | undefined {
  return ui.state?.project?.tracks.find((t) => t.id === id);
}

/** Default style for new text clips (original design; contrast-checked). */
export function defaultTextStyle(): Partial<import("./ve.js").TextContent["style"]> {
  return {
    fontFamily: "Helvetica",
    fontSizePx: 72,
    color: "#ffffff",
    bold: true,
    italic: false,
    align: "center",
    background: null,
    lineHeight: 1.2,
  };
}
