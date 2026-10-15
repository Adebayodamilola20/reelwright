/**
 * Renderer entry — mounts the shell, wires routing, engine events,
 * and the global keyboard map to shared commands.
 *
 * Engine coupling lives in ui/bridge.ts + ui/state.ts; this file is glue.
 */

import "./ui/styles/tokens.css";
import "./ui/styles/base.css";
import "./ui/styles/components.css";
import "./ui/styles/shell.css";
import "./ui/styles/panels.css";

import { createAppShell } from "./ui/shell/app-shell";
import { createHomeView, type HomeView } from "./ui/features/home/home-view";
import { createEditorView, type EditorView } from "./ui/features/editor/editor-view";
import { currentRoute, onRouteChange, navigateTo, type RouteChange } from "./ui/router";
import { resolveEvent, detectPlatform, groupedActions, describeBinding } from "./ui/interaction/keyboard-map";
import { notify } from "./ui/states/states";
import { bridge } from "./ui/bridge.js";
import {
  wireEngineEvents, getState, selectAll, clearSelection, setTool,
  setPlayhead, setPlaying,
} from "./ui/state.js";
import * as cmd from "./ui/commands.js";

const shell = createAppShell();
document.body.append(shell.root);

const platform = detectPlatform();

let homeView: HomeView | null = null;
let editorView: EditorView | null = null;

/* ------------------------------------------------------------------ *
 * Engine events → shell status
 * ------------------------------------------------------------------ */

if (bridge()) {
  wireEngineEvents();
  const { onEvent } = await import("./ui/bridge.js");
  const { refreshState, verifyAssets } = await import("./ui/state.js");
  onEvent("project:saved", () => {
    shell.setDirty(false);
    shell.announce("Project saved");
  });
  onEvent("project:change", ({ reason }) => {
    if (reason === "load" || reason === "relink") void verifyAssets();
  });
  onEvent("assets:changed", () => void refreshState());
} else {
  shell.setStatus("Running without engine bridge", "error");
}

/* ------------------------------------------------------------------ *
 * View mounting
 * ------------------------------------------------------------------ */

function mountView(route: RouteChange): void {
  homeView?.destroy();
  editorView?.destroy();
  homeView = null;
  editorView = null;
  shell.viewHost.replaceChildren();

  if (route.view === "editor") {
    editorView = createEditorView();
    shell.viewHost.append(editorView.root);
    document.title = "Reelwright — Editor";
  } else {
    homeView = createHomeView(shell.announce);
    shell.viewHost.append(homeView.root);
    document.title = "Reelwright";
    void homeView.refresh();
  }
  shell.viewHost.focus({ preventScroll: true });
}

onRouteChange(mountView);
if (!window.location.hash) {
  navigateTo({ view: "home" });
} else {
  mountView(currentRoute());
}

// Dirty indicator sync
let lastDirty: boolean | null = null;
setInterval(() => {
  const dirty = getState().state?.dirty ?? false;
  if (dirty !== lastDirty) {
    lastDirty = dirty;
    shell.setDirty(dirty);
  }
  const busy = getState().busy;
  if (busy) shell.setStatus(busy, "busy");
}, 400);

/* ------------------------------------------------------------------ *
 * Global keyboard handling
 * ------------------------------------------------------------------ */

function isTextInput(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return (
    target.isContentEditable ||
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    tag === "SELECT"
  );
}

function dispatchAction(actionId: string): void {
  const editorWidth = document.querySelector(".rw-editor")?.clientWidth ?? 1200;
  switch (actionId) {
    // Project
    case "project.new":
      navigateTo({ view: "home" });
      break;
    case "project.open":
      navigateTo({ view: "home" });
      break;
    case "project.save":
      void cmd.saveProject();
      break;
    case "project.import":
      void cmd.importMedia();
      break;
    case "export.open":
      void (async () => {
        const { openExportDialog } = await import("./ui/features/export-dialog/export-dialog.js");
        await openExportDialog();
      })();
      break;
    // Playback
    case "playback.toggle":
      cmd.togglePlay();
      break;
    case "playback.stop":
      cmd.goStart();
      break;
    case "playback.frameBack":
      cmd.stepFrame(-1);
      break;
    case "playback.frameFwd":
      cmd.stepFrame(1);
      break;
    case "playback.jumpStart":
      cmd.goStart();
      break;
    case "playback.jumpEnd":
      cmd.goEnd();
      break;
    case "playback.nextEdit":
    case "playback.prevEdit": {
      const dir = actionId === "playback.nextEdit" ? 1 : -1;
      seekToEditPoint(dir);
      break;
    }
    // Editing
    case "edit.undo":
      void cmd.undo();
      break;
    case "edit.redo":
      void cmd.redo();
      break;
    case "edit.split":
      void cmd.splitAtPlayhead();
      break;
    case "edit.delete":
      void cmd.deleteSelection();
      break;
    case "edit.duplicate":
      void cmd.duplicateSelection();
      break;
    case "edit.selectAll":
      selectAll();
      break;
    case "edit.copy":
    case "edit.paste":
      // Clipboard across projects is planned; say so honestly.
      notify("info", "Copy/paste is not implemented yet — use Duplicate (⌘D).");
      break;
    case "edit.trimStart":
    case "edit.trimEnd":
      notify("info", "Keyboard trimming is not implemented yet — drag the clip edges in the timeline.");
      break;
    // Timeline
    case "timeline.zoomIn":
      cmd.zoomIn();
      break;
    case "timeline.zoomOut":
      cmd.zoomOut();
      break;
    case "timeline.zoomFit":
      cmd.zoomFit(editorWidth - 260);
      break;
    case "timeline.snapToggle":
      cmd.toggleSnap();
      break;
    case "timeline.addTrack":
      void (async () => {
        const { call } = await import("./ui/bridge.js");
        const { getState: gs } = await import("./ui/state.js");
        const kind = gs().state?.project?.tracks.some((t) => t.kind === "audio") ? "video" : "audio";
        try {
          await call("timeline.addTrack", [kind]);
        } catch (err) {
          notify("error", err instanceof Error ? err.message : String(err));
        }
      })();
      break;
    // Tools / panels
    case "tool.select":
      setTool("select");
      break;
    case "tool.text":
      setTool("text");
      cmd.addTextClipAtPlayhead();
      break;
    case "panel.mediaBin":
      focusPanel("rw-panel-bin");
      break;
    case "panel.timeline":
      focusPanel("rw-panel-timeline");
      break;
    case "panel.inspector":
      focusPanel("rw-panel-inspector");
      break;
    // General
    case "help.shortcuts":
      showShortcutSheet();
      break;
    default:
      shell.announce(`Action ${actionId} has no handler yet.`);
  }
}

function focusPanel(id: string): void {
  const node = document.getElementById(id);
  if (node) node.focus();
}

function seekToEditPoint(dir: 1 | -1): void {
  const s = getState();
  const points = new Set<number>([0]);
  for (const t of s.state?.project?.tracks ?? []) {
    for (const c of t.clips) {
      points.add(c.start);
      points.add(c.start + c.duration);
    }
  }
  const sorted = [...points].sort((a, b) => a - b);
  const cur = s.playhead;
  let target: number | null = null;
  if (dir === 1) {
    for (const p of sorted) {
      if (p > cur + 1) { target = p; break; }
    }
  } else {
    for (let i = sorted.length - 1; i >= 0; i--) {
      if (sorted[i] < cur - 1) { target = sorted[i]; break; }
    }
  }
  if (target !== null) {
    setPlaying(false);
    setPlayhead(target, { snapToFrame: true });
  }
}

window.addEventListener("keydown", (e) => {
  if (e.ctrlKey && e.shiftKey && ["I", "J", "C"].includes(e.key.toUpperCase())) return;
  const action = resolveEvent(e, platform, { inTextInput: isTextInput(e.target) });
  if (!action) return;
  e.preventDefault();
  dispatchAction(action.id);
});

/* ------------------------------------------------------------------ *
 * Shortcut sheet (dialog with focus trap)
 * ------------------------------------------------------------------ */

function showShortcutSheet(): void {
  if (document.getElementById("rw-shortcuts")) return;

  const list = document.createElement("div");
  list.className = "rw-shortcut-sheet__grid";
  for (const { category, actions } of groupedActions()) {
    const col = document.createElement("div");
    col.className = "rw-shortcut-sheet__col";
    const h = document.createElement("h3");
    h.textContent = category;
    col.append(h);
    for (const a of actions) {
      const row = document.createElement("div");
      row.className = "rw-shortcut-sheet__row";
      const label = document.createElement("span");
      label.textContent = a.label;
      const keys = document.createElement("kbd");
      keys.textContent = a.bindings.map((b) => describeBinding(b.key, platform)).join(" / ");
      row.append(label, keys);
      col.append(row);
    }
    list.append(col);
  }

  const dialog = document.createElement("div");
  dialog.id = "rw-shortcuts";
  dialog.className = "rw-dialog-backdrop";
  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("aria-modal", "true");
  dialog.setAttribute("aria-label", "Keyboard shortcuts");

  const panel = document.createElement("div");
  panel.className = "rw-dialog rw-dialog--wide";
  const header = document.createElement("div");
  header.className = "rw-dialog__header";
  const h2 = document.createElement("h2");
  h2.textContent = "Keyboard shortcuts";
  const close = document.createElement("button");
  close.className = "rw-btn rw-btn--icon";
  close.type = "button";
  close.setAttribute("aria-label", "Close");
  close.textContent = "×";
  header.append(h2, close);
  panel.append(header, list);

  const opener = document.activeElement as HTMLElement | null;
  const previousOverflow = document.body.style.overflow;
  document.body.style.overflow = "hidden";

  function closeDialog(): void {
    dialog.remove();
    document.body.style.overflow = previousOverflow;
    window.removeEventListener("keydown", onKey, true);
    opener?.focus();
  }
  function onKey(e: KeyboardEvent): void {
    if (e.key === "Escape") {
      e.stopPropagation();
      closeDialog();
      return;
    }
    if (e.key === "Tab") {
      const focusables = panel.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      );
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  }
  window.addEventListener("keydown", onKey, true);
  close.addEventListener("click", closeDialog);
  dialog.addEventListener("click", (e) => {
    if (e.target === dialog) closeDialog();
  });

  dialog.append(panel);
  document.body.append(dialog);
  close.focus();
}
