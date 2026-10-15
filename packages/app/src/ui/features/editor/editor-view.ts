/**
 * Editor workspace assembly:
 *
 *   toolbar
 *   media bin │ preview monitor │ inspector
 *   timeline
 *
 * Panels subscribe to the shared UI state; engine wiring lives in state.ts.
 */

import { el, emptyState } from "../../states/states";
import { getBridgeStatus } from "../../bridge.js";
import { createToolbar, type Toolbar } from "../toolbar/toolbar.js";
import { createMediaBin, type MediaBin } from "../media-bin/media-bin.js";
import { createPreviewMonitor, type PreviewMonitor } from "../preview/preview.js";
import { createInspector, type Inspector } from "../inspector/inspector.js";
import { createTimeline, type TimelinePanel } from "../timeline/timeline.js";

export interface EditorView {
  root: HTMLElement;
  destroy(): void;
}

export function createEditorView(): EditorView {
  const status = getBridgeStatus();

  const toolbar: Toolbar = createToolbar();

  const mediaBin: MediaBin = createMediaBin();
  const binPanel = panel("Media", mediaBin.root);
  const previewPanel = el("section", {
    class: "rw-panel rw-panel--preview",
    id: "rw-panel-preview",
    "aria-label": "Preview monitor",
    tabindex: "-1",
  });
  const preview: PreviewMonitor = createPreviewMonitor();
  previewPanel.append(preview.root);
  const inspector: Inspector = createInspector();
  const inspectorPanel = el("section", {
    class: "rw-panel rw-panel--inspector",
    id: "rw-panel-inspector",
    "aria-label": "Inspector",
    tabindex: "-1",
  }, [inspector.root]);
  const timeline: TimelinePanel = createTimeline();
  const timelinePanel = el("section", {
    class: "rw-panel rw-panel--timeline",
    id: "rw-panel-timeline",
    "aria-label": "Timeline",
    tabindex: "-1",
  }, [timeline.root]);

  const mid = el("div", { class: "rw-editor__mid" }, [binPanel, previewPanel, inspectorPanel]);
  const body = el("div", { class: "rw-editor__body" }, [mid, timelinePanel]);
  const root = el("div", { class: "rw-editor" }, [toolbar.root, body]);

  if (!status.connected) {
    root.prepend(
      el("div", { class: "rw-banner rw-banner--warn", role: "status" },
        ["Engine not connected — the editor is read-only. ", status.reason]),
    );
  }

  return {
    root,
    destroy() {
      toolbar.destroy();
      mediaBin.destroy();
      preview.destroy();
      inspector.destroy();
      timeline.destroy();
      root.replaceChildren();
    },
  };
}

function panel(label: string, child: HTMLElement): HTMLElement {
  return el("section", {
    class: `rw-panel rw-panel--bin`,
    id: "rw-panel-bin",
    "aria-label": label,
    tabindex: "-1",
  }, [child]);
}
