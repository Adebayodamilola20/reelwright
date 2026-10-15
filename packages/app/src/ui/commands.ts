/**
 * User commands — single implementation used by the toolbar, keyboard map,
 * and (later) menus/command palette. Every command goes through the engine.
 */

import { notify } from "./states/states";
import { call, errorMessage } from "./bridge.js";
import {
  getState, selectedClips, setBusy, setPlaying, setZoom, toggleSnap,
  programEndTicks, setPlayhead, verifyAssets,
} from "./state.js";
import type { ImportResult } from "./ve.js";
import { pickMediaFiles, isDesktop } from "./bridge.js";

function report(err: unknown): void {
  const e = errorMessage(err);
  notify("error", e.message, e.hint ? { detail: e.hint } : (e.detail ? { detail: e.detail } : {}));
}

/* ---------------- history ---------------- */

export async function undo(): Promise<void> {
  try {
    const did = await call<boolean>("history.undo");
    if (!did) notify("info", "Nothing to undo");
  } catch (err) {
    report(err);
  }
}

export async function redo(): Promise<void> {
  try {
    const did = await call<boolean>("history.redo");
    if (!did) notify("info", "Nothing to redo");
  } catch (err) {
    report(err);
  }
}

/* ---------------- clip ops ---------------- */

export async function splitAtPlayhead(): Promise<void> {
  const s = getState();
  const at = s.playhead;
  let did = 0;
  try {
    for (const { clip } of selectedClips()) {
      if (at > clip.start && at < clip.start + clip.duration) {
        await call("timeline.splitClip", [clip.id, at]);
        did++;
      }
    }
    if (did === 0) {
      notify("info", "Select a clip that crosses the playhead, then split.");
    }
  } catch (err) {
    report(err);
  }
}

export async function deleteSelection(): Promise<void> {
  const sel = selectedClips();
  if (sel.length === 0) {
    notify("info", "Select one or more clips to delete.");
    return;
  }
  setBusy("Deleting…");
  try {
    for (const { clip } of sel) await call("timeline.removeClip", [clip.id]);
  } catch (err) {
    report(err);
  } finally {
    setBusy(null);
  }
}

export async function duplicateSelection(): Promise<void> {
  const sel = selectedClips();
  if (sel.length === 0) {
    notify("info", "Select one or more clips to duplicate.");
    return;
  }
  setBusy("Duplicating…");
  try {
    for (const { clip } of sel) await call("timeline.duplicateClip", [clip.id]);
  } catch (err) {
    report(err);
  } finally {
    setBusy(null);
  }
}

/* ---------------- text ---------------- */

export async function addTextClipAtPlayhead(): Promise<void> {
  const s = getState();
  if (!s.state?.project) {
    notify("info", "Open a project first.");
    return;
  }
  try {
    const existing = s.state.project.tracks.find((t) => t.kind === "video" && !t.locked);
    let trackId: string;
    if (existing) {
      trackId = existing.id;
    } else {
      const created = await call<{ id: string }>("timeline.addTrack", ["video", "Video 1"]);
      trackId = created.id;
    }
    await call("timeline.addTextClip", [{
      trackId,
      start: s.playhead,
      text: "New text",
      style: {
        fontFamily: "Helvetica",
        fontSizePx: 72,
        color: "#ffffff",
        bold: true,
        italic: false,
        align: "center",
        background: null,
        lineHeight: 1.2,
      },
    }]);
    notify("info", "Text clip added — edit it in the Inspector panel.");
  } catch (err) {
    report(err);
  }
}

/* ---------------- project ---------------- */

export async function saveProject(): Promise<void> {
  try {
    setBusy("Saving…");
    await call("project.save");
    notify("success", "Project saved");
  } catch (err) {
    report(err);
  } finally {
    setBusy(null);
  }
}

/* ---------------- import ---------------- */

export async function importMedia(): Promise<void> {
  if (!isDesktop()) {
    notify("info", "Import requires the desktop app (native file dialog).");
    return;
  }
  const paths = await pickMediaFiles();
  if (paths.length === 0) return;
  let imported = 0;
  for (let i = 0; i < paths.length; i++) {
    setBusy(`Importing ${i + 1}/${paths.length}: ${paths[i].split("/").pop()}`);
    try {
      const res = await call<ImportResult>("assets.import", [paths[i]]);
      imported += res.imported.length;
      for (const f of res.failed) {
        notify("error", `Could not import ${f.path.split("/").pop()}`, { detail: f.error.message });
      }
    } catch (err) {
      report(err);
    }
  }
  setBusy(null);
  if (imported > 0) notify("success", `Imported ${imported} file${imported === 1 ? "" : "s"}`);
  await verifyAssets();
}

/* ---------------- playback ---------------- */

export function togglePlay(): void {
  const s = getState();
  if (!s.state?.project) return;
  if (!s.playing && s.playhead >= programEndTicks()) setPlayhead(0);
  setPlaying(!s.playing);
}

export function stepFrame(dir: 1 | -1): void {
  const fps = getState().state?.project?.settings.frameRate;
  const cur = getState().playhead;
  if (fps) {
    const frameTicks = (70_560_000 * fps.d) / fps.n;
    setPlayhead(cur + dir * Math.round(frameTicks), { snapToFrame: false });
  } else {
    setPlayhead(cur + (dir * 70_560_000) / 30, { snapToFrame: false });
  }
}

export function goStart(): void {
  setPlaying(false);
  setPlayhead(0);
}

export function goEnd(): void {
  setPlaying(false);
  setPlayhead(programEndTicks());
}

/* ---------------- view ---------------- */

export function zoomIn(): void {
  setZoom(getState().pxPerSec * 1.4);
}

export function zoomOut(): void {
  setZoom(getState().pxPerSec / 1.4);
}

export function zoomFit(viewWidthPx: number): void {
  const endSec = programEndTicks() / 70_560_000;
  if (endSec > 0) {
    setZoom(Math.max(8, Math.min(800, viewWidthPx / endSec)));
  }
}

export { toggleSnap };
