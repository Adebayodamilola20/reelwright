/**
 * Reelwright keyboard map — single source of truth for shortcuts.
 *
 * Pure data + matching logic; no DOM, no engine dependency.
 * The UI layer binds `KeyboardAction`s to engine calls once the contract lands.
 *
 * Conventions:
 *  - Platform-agnostic base bindings; `matches()` handles Mac vs other meta keys.
 *  - Every action has a stable id, a human label (for menus / cheat sheet),
 *    and at least one binding. Unavailable actions must be rendered disabled
 *    with an accurate reason — never as fake-working controls.
 */

export type Platform = "mac" | "other";

export type KeyboardActionId =
  // File / project
  | "project.new"
  | "project.open"
  | "project.save"
  | "project.import"
  | "export.open"
  // Playback
  | "playback.toggle"
  | "playback.stop"
  | "playback.frameBack"
  | "playback.frameFwd"
  | "playback.jumpStart"
  | "playback.jumpEnd"
  | "playback.nextEdit"
  | "playback.prevEdit"
  // Editing
  | "edit.undo"
  | "edit.redo"
  | "edit.split"
  | "edit.delete"
  | "edit.duplicate"
  | "edit.selectAll"
  | "edit.copy"
  | "edit.paste"
  | "edit.trimStart"
  | "edit.trimEnd"
  // Timeline view
  | "timeline.zoomIn"
  | "timeline.zoomOut"
  | "timeline.zoomFit"
  | "timeline.snapToggle"
  | "timeline.addTrack"
  // Tools / panels
  | "tool.select"
  | "tool.text"
  | "panel.mediaBin"
  | "panel.inspector"
  | "panel.timeline"
  // General
  | "help.shortcuts"
  | "commandPalette.toggle";

export interface KeyBinding {
  /** e.g. "Mod+S", "Space", "S", "Shift+Mod+K", "ArrowLeft", "CmdOrCtrl+Z" */
  key: string;
  /** Optional platform restriction */
  only?: Platform;
  /** Binding does not fire while a text field is focused */
  outsideInput?: boolean;
}

export interface KeyboardAction {
  id: KeyboardActionId;
  label: string;
  /** Grouping for the shortcut sheet */
  category:
    | "Project"
    | "Playback"
    | "Editing"
    | "Timeline"
    | "Tools"
    | "General";
  bindings: KeyBinding[];
  /**
   * If the action's availability depends on engine/UI state, the UI supplies a
   * reason string when disabled (used for accurate disabled tooltips).
   */
  requires?: "openProject" | "selection" | "playback" | "timeline";
}

const SPACE_BINDINGS: KeyBinding[] = [
  { key: "Space", outsideInput: true },
  { key: "K", outsideInput: true },
];

export const KEYBOARD_ACTIONS: KeyboardAction[] = [
  // ---- Project ----
  { id: "project.new", label: "New project", category: "Project",
    bindings: [{ key: "Mod+N" }] },
  { id: "project.open", label: "Open project…", category: "Project",
    bindings: [{ key: "Mod+O" }] },
  { id: "project.save", label: "Save project", category: "Project",
    bindings: [{ key: "Mod+S" }] },
  { id: "project.import", label: "Import media…", category: "Project",
    bindings: [{ key: "Mod+I" }, { key: "Mod+Shift+I" }] },
  { id: "export.open", label: "Export…", category: "Project",
    bindings: [{ key: "Mod+E" }], requires: "openProject" },

  // ---- Playback ----
  { id: "playback.toggle", label: "Play / pause", category: "Playback",
    bindings: SPACE_BINDINGS.map((b) => ({ ...b })), requires: "openProject" },
  { id: "playback.stop", label: "Stop playback", category: "Playback",
    bindings: [{ key: "Shift+Space", outsideInput: true },
      { key: "J", outsideInput: true }], requires: "openProject" },
  { id: "playback.frameBack", label: "Step one frame back", category: "Playback",
    bindings: [{ key: "ArrowLeft", outsideInput: true }], requires: "openProject" },
  { id: "playback.frameFwd", label: "Step one frame forward", category: "Playback",
    bindings: [{ key: "ArrowRight", outsideInput: true }], requires: "openProject" },
  { id: "playback.jumpStart", label: "Go to start", category: "Playback",
    bindings: [{ key: "Home", outsideInput: true }], requires: "openProject" },
  { id: "playback.jumpEnd", label: "Go to end", category: "Playback",
    bindings: [{ key: "End", outsideInput: true }], requires: "openProject" },
  { id: "playback.nextEdit", label: "Go to next edit point", category: "Playback",
    bindings: [{ key: "ArrowDown", outsideInput: true },
      { key: "Mod+ArrowRight", outsideInput: true }], requires: "openProject" },
  { id: "playback.prevEdit", label: "Go to previous edit point", category: "Playback",
    bindings: [{ key: "ArrowUp", outsideInput: true },
      { key: "Mod+ArrowLeft", outsideInput: true }], requires: "openProject" },

  // ---- Editing ----
  { id: "edit.undo", label: "Undo", category: "Editing",
    bindings: [{ key: "Mod+Z" }] },
  { id: "edit.redo", label: "Redo", category: "Editing",
    bindings: [{ key: "Mod+Shift+Z" }, { key: "Mod+Y" }] },
  { id: "edit.split", label: "Split at playhead", category: "Editing",
    bindings: [{ key: "S", outsideInput: true },
      { key: "Mod+B", outsideInput: true }], requires: "selection" },
  { id: "edit.delete", label: "Delete selection", category: "Editing",
    bindings: [{ key: "Delete", outsideInput: true },
      { key: "Backspace", outsideInput: true },
      { key: "Mod+Backspace", outsideInput: true }], requires: "selection" },
  { id: "edit.duplicate", label: "Duplicate selection", category: "Editing",
    bindings: [{ key: "Mod+D", outsideInput: true }], requires: "selection" },
  { id: "edit.selectAll", label: "Select all clips", category: "Editing",
    bindings: [{ key: "Mod+A", outsideInput: true }], requires: "openProject" },
  { id: "edit.copy", label: "Copy", category: "Editing",
    bindings: [{ key: "Mod+C", outsideInput: true }], requires: "selection" },
  { id: "edit.paste", label: "Paste", category: "Editing",
    bindings: [{ key: "Mod+V", outsideInput: true }], requires: "openProject" },
  { id: "edit.trimStart", label: "Trim clip start to playhead", category: "Editing",
    bindings: [{ key: "Alt+[", outsideInput: true },
      { key: "Mod+Alt+ArrowLeft", outsideInput: true }], requires: "selection" },
  { id: "edit.trimEnd", label: "Trim clip end to playhead", category: "Editing",
    bindings: [{ key: "Alt+]", outsideInput: true },
      { key: "Mod+Alt+ArrowRight", outsideInput: true }], requires: "selection" },

  // ---- Timeline ----
  { id: "timeline.zoomIn", label: "Zoom in timeline", category: "Timeline",
    bindings: [{ key: "=", outsideInput: true }, { key: "+", outsideInput: true },
      { key: "Mod+=", outsideInput: true }] },
  { id: "timeline.zoomOut", label: "Zoom out timeline", category: "Timeline",
    bindings: [{ key: "-", outsideInput: true }, { key: "Mod+-", outsideInput: true }] },
  { id: "timeline.zoomFit", label: "Zoom to fit sequence", category: "Timeline",
    bindings: [{ key: "Shift+Z", outsideInput: true }], requires: "openProject" },
  { id: "timeline.snapToggle", label: "Toggle snapping", category: "Timeline",
    bindings: [{ key: "N", outsideInput: true }] },
  { id: "timeline.addTrack", label: "Add track", category: "Timeline",
    bindings: [{ key: "Mod+Shift+N", outsideInput: true }], requires: "openProject" },

  // ---- Tools / panels ----
  { id: "tool.select", label: "Select tool", category: "Tools",
    bindings: [{ key: "V", outsideInput: true }] },
  { id: "tool.text", label: "Text tool", category: "Tools",
    bindings: [{ key: "T", outsideInput: true }], requires: "openProject" },
  { id: "panel.mediaBin", label: "Focus media bin", category: "Tools",
    bindings: [{ key: "Mod+1", outsideInput: true }] },
  { id: "panel.timeline", label: "Focus timeline", category: "Tools",
    bindings: [{ key: "Mod+2", outsideInput: true }] },
  { id: "panel.inspector", label: "Focus inspector", category: "Tools",
    bindings: [{ key: "Mod+3", outsideInput: true }] },

  // ---- General ----
  { id: "help.shortcuts", label: "Keyboard shortcuts", category: "General",
    bindings: [{ key: "?", outsideInput: true }, { key: "Mod+/", outsideInput: true }] },
  { id: "commandPalette.toggle", label: "Command palette", category: "General",
    bindings: [{ key: "Mod+K" }] },
];

export interface ParsedKey {
  mod: boolean;
  shift: boolean;
  alt: boolean;
  key: string;
}

/** Parse "Mod+Shift+Z" into a normalized descriptor. */
export function parseBinding(binding: string): ParsedKey {
  const parts = binding.split("+");
  const out: ParsedKey = { mod: false, shift: false, alt: false, key: "" };
  for (const raw of parts) {
    const p = raw.trim();
    const lower = p.toLowerCase();
    if (lower === "mod" || lower === "cmdorctrl") out.mod = true;
    else if (lower === "shift") out.shift = true;
    else if (lower === "alt" || lower === "option") out.alt = true;
    else if (lower === "meta" || lower === "cmd") continue; // avoid silent misuse
    // Canonicalize single-character keys to lowercase ("S" → "s") so they
    // compare equal to eventToKey()'s lowercased printable keys. Second-head
    // fix K1: without this, every uppercase letter binding ("S", "K", "J",
    // "N", "V", "T") failed sameKey()'s exact match and the whole letter
    // shortcut set was silently dead.
    else out.key = p.length === 1 ? p.toLowerCase() : p;
  }
  return out;
}

/** Normalize a KeyboardEvent to a comparable descriptor (Mac-aware). */
export function eventToKey(e: KeyboardEvent, platform: Platform): ParsedKey {
  const key = e.key;
  // Space and single printable characters compare case-insensitively for shift.
  let base = key;
  if (key.length === 1) base = key.toLowerCase();
  if (key === " ") base = "Space";
  return {
    mod: platform === "mac" ? e.metaKey : e.ctrlKey,
    shift: e.shiftKey,
    alt: e.altKey,
    key: base,
  };
}

function sameKey(a: string, b: string): boolean {
  if (a === b) return true;
  return a.toLowerCase() === b.toLowerCase() && a.length > 1;
}

/**
 * Resolve which action (if any) a keyboard event triggers.
 * Returns null when no binding matches or the binding is suppressed in inputs.
 */
export function resolveEvent(
  e: KeyboardEvent,
  platform: Platform,
  opts: { inTextInput: boolean } = { inTextInput: false },
): KeyboardAction | null {
  const ev = eventToKey(e, platform);
  for (const action of KEYBOARD_ACTIONS) {
    for (const binding of action.bindings) {
      if (binding.only && binding.only !== platform) continue;
      if (opts.inTextInput && binding.outsideInput) continue;
      const want = parseBinding(binding.key);
      if (
        want.mod === ev.mod &&
        want.shift === ev.shift &&
        want.alt === ev.alt &&
        sameKey(want.key, ev.key)
      ) {
        return action;
      }
    }
  }
  return null;
}

/** Human-readable rendering, e.g. "⌘S" on Mac, "Ctrl+S" elsewhere. */
export function describeBinding(binding: string, platform: Platform): string {
  const p = parseBinding(binding);
  const parts: string[] = [];
  if (p.mod) parts.push(platform === "mac" ? "⌘" : "Ctrl");
  if (p.alt) parts.push(platform === "mac" ? "⌥" : "Alt");
  if (p.shift) parts.push(platform === "mac" ? "⇧" : "Shift");
  const keyLabel =
    p.key === "Space" ? "Space" : p.key.length === 1 ? p.key.toUpperCase() : p.key;
  parts.push(keyLabel);
  return platform === "mac" ? parts.join("") : parts.join("+");
}

export function detectPlatform(): Platform {
  if (typeof navigator === "undefined") return "other";
  const mac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
  return mac ? "mac" : "other";
}

/** Actions grouped by category, for the shortcut sheet / help dialog. */
export function groupedActions(): Array<{
  category: KeyboardAction["category"];
  actions: KeyboardAction[];
}> {
  const order: KeyboardAction["category"][] = [
    "Project", "Playback", "Editing", "Timeline", "Tools", "General",
  ];
  return order.map((category) => ({
    category,
    actions: KEYBOARD_ACTIONS.filter((a) => a.category === category),
  }));
}
