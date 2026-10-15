/**
 * Editor workspace — the four-region layout:
 *
 *   ┌──────────────── toolbar (tools / actions) ────────────────┐
 *   │ media bin │      preview monitor       │   inspector      │
 *   ├───────────┴────────────────────────────┴──────────────────┤
 *   │ timeline (ruler, tracks, playhead)                        │
 *   └──────────────────── status bar (shell) ───────────────────┘
 *
 * Panel *structure* is contract-independent. Panels show honest empty
 * states until the engine bridge is connected; integration wiring lands
 * with contract v1.
 */

import { el, emptyState } from "../../states/states";
import { getServices, NO_ENGINE_REASON } from "../../services";

export interface EditorView {
  root: HTMLElement;
  toolbarHost: HTMLElement;
  mediaBinHost: HTMLElement;
  previewHost: HTMLElement;
  inspectorHost: HTMLElement;
  timelineHost: HTMLElement;
  destroy(): void;
}

export function createEditorView(): EditorView {
  const services = getServices();

  const toolbarHost = el("div", { class: "rw-toolbar__inner", role: "toolbar",
    "aria-label": "Editor tools" });
  const toolbar = el("div", { class: "rw-toolbar" }, [toolbarHost]);

  const mediaBinHost = el("section", {
    class: "rw-panel rw-panel--bin", id: "rw-panel-bin",
    "aria-label": "Media bin", tabindex: "-1",
  });
  const previewHost = el("section", {
    class: "rw-panel rw-panel--preview", id: "rw-panel-preview",
    "aria-label": "Preview monitor", tabindex: "-1",
  });
  const inspectorHost = el("section", {
    class: "rw-panel rw-panel--inspector", id: "rw-panel-inspector",
    "aria-label": "Inspector", tabindex: "-1",
  });
  const timelineHost = el("section", {
    class: "rw-panel rw-panel--timeline", id: "rw-panel-timeline",
    "aria-label": "Timeline", tabindex: "-1",
  });

  const mid = el("div", { class: "rw-editor__mid" }, [mediaBinHost, previewHost, inspectorHost]);
  const body = el("div", { class: "rw-editor__body" }, [mid, timelineHost]);
  const root = el("div", { class: "rw-editor" }, [toolbar, body]);

  // Honest placeholders until contract-v1 integration.
  const reason = services
    ? "Populated once the project model is connected (contract v1)."
    : NO_ENGINE_REASON;

  mediaBinHost.append(
    emptyState({
      icon: "▤",
      title: "Media bin is empty",
      description: "Imported video, audio, and images appear here.",
      hint: services ? reason : NO_ENGINE_REASON,
    }),
  );
  previewHost.append(
    emptyState({
      icon: "▶",
      title: "Nothing to preview",
      description: "Place a clip on the timeline to see it here.",
      hint: services ? reason : NO_ENGINE_REASON,
    }),
  );
  inspectorHost.append(
    emptyState({
      icon: "⚙",
      title: "No selection",
      description: "Select a clip or text layer to edit its properties.",
      hint: services ? reason : NO_ENGINE_REASON,
    }),
  );
  timelineHost.append(
    emptyState({
      icon: "⇄",
      title: "Timeline is empty",
      description: "Drag media from the bin, or press ⌘I to import.",
      hint: services ? reason : NO_ENGINE_REASON,
    }),
  );

  return {
    root, toolbarHost, mediaBinHost, previewHost, inspectorHost, timelineHost,
    destroy() {
      root.replaceChildren();
    },
  };
}
