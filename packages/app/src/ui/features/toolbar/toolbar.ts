/**
 * Toolbar — global editing actions with honest disabled states.
 * Actions delegate to ui/commands.ts (shared with the keyboard map).
 */

import { el, notify } from "../../states/states";
import { call } from "../../bridge.js";
import { subscribe, getState, toggleSnap, setZoom, programEndTicks } from "../../state.js";
import * as cmd from "../../commands.js";
import { openExportDialog } from "../export-dialog/export-dialog.js";

export interface Toolbar {
  root: HTMLElement;
  destroy(): void;
}

export function createToolbar(): Toolbar {
  const root = el("div", { class: "rw-toolbar__inner", role: "toolbar", "aria-label": "Editor tools" });

  const undoBtn = btn("Undo (⌘Z)", "↩");
  const redoBtn = btn("Redo (⇧⌘Z)", "↪");
  const splitBtn = btn("Split clip at playhead (S)", "✂", "Split");
  const dupBtn = btn("Duplicate selection (⌘D)", "⧉");
  const delBtn = btn("Delete selection (⌫)", "🗑");
  const importBtn = btn("Import media… (⌘I)", "＋", "Import");
  const textBtn = btn("Add text clip at playhead (T)", "T", "Text");
  const snapBtn = btn("Toggle snapping (N)", "🧲");
  const zoomOutBtn = btn("Zoom out (−)", "−");
  const zoomInBtn = btn("Zoom in (=)", "＋");
  const zoomFitBtn = btn("Zoom to fit (⇧Z)", "⤢");
  const saveBtn = btn("Save project (⌘S)", "💾", "Save");
  const exportBtn = el("button", { class: "rw-btn rw-btn--primary", type: "button" }, "Export…");
  const timecodeEl = el("span", { class: "rw-toolbar__timecode", "aria-live": "off" }, "00:00:00:00");

  root.append(
    group(undoBtn, redoBtn),
    sep(),
    group(splitBtn, dupBtn, delBtn),
    sep(),
    group(importBtn, textBtn),
    sep(),
    group(snapBtn, zoomOutBtn, zoomFitBtn, zoomInBtn),
    el("div", { class: "rw-toolbar__spacer" }),
    timecodeEl,
    el("div", { class: "rw-toolbar__spacer" }),
    group(saveBtn, exportBtn),
  );

  undoBtn.addEventListener("click", () => void cmd.undo());
  redoBtn.addEventListener("click", () => void cmd.redo());
  splitBtn.addEventListener("click", () => void cmd.splitAtPlayhead());
  dupBtn.addEventListener("click", () => void cmd.duplicateSelection());
  delBtn.addEventListener("click", () => void cmd.deleteSelection());
  importBtn.addEventListener("click", () => void cmd.importMedia());
  textBtn.addEventListener("click", () => void cmd.addTextClipAtPlayhead());
  snapBtn.addEventListener("click", toggleSnap);
  zoomOutBtn.addEventListener("click", cmd.zoomOut);
  zoomInBtn.addEventListener("click", cmd.zoomIn);
  zoomFitBtn.addEventListener("click", () => {
    const editorWidth = root.closest(".rw-editor")?.clientWidth ?? 1200;
    cmd.zoomFit(editorWidth - 260);
  });
  saveBtn.addEventListener("click", () => void cmd.saveProject());
  exportBtn.addEventListener("click", () => void openExportDialog());

  /* ------------- honest disabled states ------------- */

  let canUndo = false;
  let canRedo = false;

  async function refreshFlags(): Promise<void> {
    const s = getState();
    const open = !!s.state?.project;
    const engine = s.connected;

    if (engine && open) {
      try {
        [canUndo, canRedo] = await Promise.all([
          call<boolean>("history.canUndo"),
          call<boolean>("history.canRedo"),
        ]);
      } catch {
        canUndo = canRedo = false;
      }
    } else {
      canUndo = canRedo = false;
    }

    const noProject = "Open a project to use this.";
    setDisabled(undoBtn, !canUndo, canUndo ? "" : "Nothing to undo.");
    setDisabled(redoBtn, !canRedo, canRedo ? "" : "Nothing to redo.");
    setDisabled(splitBtn, !open, open ? "" : noProject);
    setDisabled(dupBtn, s.selection.size === 0, s.selection.size ? "" : "Select clips in the timeline first.");
    setDisabled(delBtn, s.selection.size === 0, s.selection.size ? "" : "Select clips in the timeline first.");
    setDisabled(importBtn, !engine, engine ? "" : "Import needs the engine (desktop app).");
    setDisabled(textBtn, !open, open ? "" : noProject);
    setDisabled(saveBtn, !open, open ? "" : noProject);
    setDisabled(exportBtn, !open, open ? "" : noProject);

    snapBtn.classList.toggle("rw-btn--active", s.snapping);
    snapBtn.setAttribute("aria-pressed", String(s.snapping));
    timecodeEl.textContent = timecodeOf(s.playhead);
  }

  const unsub = subscribe(() => void refreshFlags());
  void refreshFlags();

  return {
    root,
    destroy() {
      unsub();
    },
  };
}

/* ---------------- helpers ---------------- */

import { TICKS_PER_SECOND, formatTimecode } from "../../ve.js";
import type { Ticks } from "../../ve.js";

function timecodeOf(t: Ticks): string {
  const fps = getState().state?.project?.settings.frameRate;
  return fps ? formatTimecode(t, fps) : `${(t / TICKS_PER_SECOND).toFixed(2)}s`;
}

function btn(label: string, glyph: string, text?: string): HTMLButtonElement {
  return el("button", {
    class: "rw-btn",
    type: "button",
    "aria-label": label,
    title: label,
  }, text ?? glyph) as HTMLButtonElement;
}

function group(...items: HTMLElement[]): HTMLElement {
  return el("div", { class: "rw-toolbar__group" }, items);
}

function sep(): HTMLElement {
  return el("div", { class: "rw-toolbar__sep", "aria-hidden": "true" });
}

function setDisabled(node: HTMLElement, disabled: boolean, reason: string): void {
  if (node instanceof HTMLButtonElement) node.disabled = disabled;
  node.setAttribute("aria-disabled", String(disabled));
  if (disabled && reason) node.title = reason;
  else if (!disabled) {
    const t = node.getAttribute("aria-label");
    if (t) node.title = t;
  }
}
