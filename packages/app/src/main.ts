/**
 * Renderer entry — mounts the shell, wires routing + global keyboard map.
 *
 * Engine integration: subscribes to window.ve when present; when absent the
 * app still runs as an honest shell (all engine controls disabled with
 * reasons). Contract v1 integration extends this file — do not assume event
 * names beyond services.ts until the contract review notes are resolved.
 */

import "./ui/styles/tokens.css";
import "./ui/styles/base.css";
import "./ui/styles/components.css";
import "./ui/styles/shell.css";

import { createAppShell } from "./ui/shell/app-shell";
import { createHomeView, type HomeView } from "./ui/features/home/home-view";
import { createEditorView, type EditorView } from "./ui/features/editor/editor-view";
import { currentRoute, onRouteChange, navigateTo, type RouteChange } from "./ui/router";
import { resolveEvent, detectPlatform, groupedActions, describeBinding } from "./ui/interaction/keyboard-map";
import { getServices, type EngineServices } from "./ui/services";
import { notify } from "./ui/states/states";

const shell = createAppShell();
document.body.append(shell.root);

const platform = detectPlatform();
const services = getServices();

let homeView: HomeView | null = null;
let editorView: EditorView | null = null;

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
    if (!route.projectId && services) {
      shell.setStatus("No project selected", "error");
    }
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
  switch (actionId) {
    case "help.shortcuts":
      showShortcutSheet();
      break;
    case "project.new":
      navigateTo({ view: "home" });
      if (services) notify("info", "Use “New project” on the home screen.");
      break;
    case "export.open":
      notify("info", "Export dialog arrives with contract v1 integration.");
      break;
    default:
      // Engine-backed actions will be wired once the contract lands.
      shell.announce(`Action ${actionId} not yet wired to the engine.`);
      break;
  }
}

window.addEventListener("keydown", (e) => {
  // Never swallow browser devtools / system combos.
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
      keys.textContent = a.bindings
        .map((b) => describeBinding(b.key, platform))
        .join(" / ");
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
      // simple focus trap
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

/* ------------------------------------------------------------------ *
 * Engine bridge presence — reflect honestly in status bar
 * ------------------------------------------------------------------ */

if (!services) {
  shell.setStatus("Running without engine bridge", "error");
} else {
  wireEngine(services);
}

function wireEngine(ve: EngineServices): void {
  ve.on("project:dirty", () => shell.setDirty(true));
  ve.on("project:saved", () => {
    shell.setDirty(false);
    shell.announce("Project saved");
  });
  ve.on("error", ({ scope, message, detail }) => {
    shell.setStatus(message, "error");
    notify("error", `${scope}: ${message}`, detail ? { detail } : {});
  });
  ve.on("export:progress", ({ pct, stage }) => {
    shell.setStatus(`${stage} — ${Math.round(pct * 100)}%`, "busy");
  });
  ve.on("export:completed", ({ outputPath }) => {
    shell.setStatus("Export complete", "normal");
    notify("success", `Exported to ${outputPath}`);
  });
  ve.on("import:progress", ({ done, total }) => {
    shell.setStatus(`Importing ${done}/${total}…`, "busy");
  });
}
