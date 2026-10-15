/**
 * Home / project library view.
 *
 * Honest states:
 *  - engine absent → create/open disabled with reason; explanatory banner
 *  - engine present, no projects → empty state with New project CTA
 *  - loading/error → shared primitives
 */

import { el, emptyState, loadingState, errorState, notify } from "../../states/states";
import { getServices, NO_ENGINE_REASON, disableWithReason, type ProjectSummary } from "../../services";
import { navigateTo } from "../../router";

export interface HomeView {
  root: HTMLElement;
  /** Re-read the project list (called on show) */
  refresh(): Promise<void>;
  destroy(): void;
}

const MAX_NAME_LEN = 80;

export function createHomeView(announce: (m: string, a?: boolean) => void): HomeView {
  const root = el("div", { class: "rw-home" });
  const services = getServices();

  // ---- Hero header ---- */
  const title = el("h1", {}, "Projects");
  const sub = el("p", {
    class: "dim",
  }, "Create a project, import media, and edit on the timeline. Everything stays on this computer.");

  const newBtn = el("button", { class: "rw-btn rw-btn--primary", type: "button" },
    "＋ New project");
  const importBtn = el("button", { class: "rw-btn", type: "button" },
    "⬇ Import media");

  if (!services) {
    disableWithReason(newBtn, NO_ENGINE_REASON);
    disableWithReason(importBtn, NO_ENGINE_REASON);
  }

  const hero = el("div", { class: "rw-home__hero" }, [
    el("div", { class: "rw-home__heroText" }, [title, sub]),
    el("div", { class: "rw-home__actions" }, [importBtn, newBtn]),
  ]);
  root.append(hero);

  // ---- Engine warning banner when disconnected ----
  if (!services) {
    root.append(
      errorState({
        title: "Media engine not connected",
        detail:
          "window.ve bridge is not present. The UI shell is running, but project " +
          "creation, import, playback, and export are unavailable until the engine " +
          "package is loaded.",
      }),
    );
  }

  // ---- Project list ----
  const listHost = el("section", {
    class: "rw-home__list",
    "aria-label": "Recent projects",
  });
  root.append(listHost);

  function renderList(projects: ProjectSummary[]): void {
    listHost.replaceChildren();
    if (projects.length === 0) {
      listHost.append(
        emptyState({
          icon: "▦",
          title: "No projects yet",
          description: "Create your first project to start editing video, audio, images, and text.",
          ...(services
            ? { action: { label: "New project", onClick: () => void promptNew() } }
            : { hint: NO_ENGINE_REASON }),
        }),
      );
      return;
    }
    const grid = el("div", { class: "rw-project-grid" });
    for (const p of projects) {
      const card = el("article", { class: "rw-project-card" });
      const openBtn = el("button", {
        class: "rw-project-card__open",
        type: "button",
        "aria-label": `Open project ${p.name}`,
      }, [
        el("div", { class: "rw-project-card__thumb mono" }, "▶"),
        el("div", { class: "rw-project-card__meta" }, [
          el("h3", { class: "rw-project-card__name" }, p.name),
          el("p", { class: "rw-project-card__stats faint mono" },
            `${p.clipCount} clips · ${formatDuration(p.durationSec)} · ${formatDate(p.modifiedAt)}`),
        ]),
      ]);
      openBtn.addEventListener("click", () => {
        void openProject(p);
      });
      card.append(openBtn);
      grid.append(card);
    }
    listHost.append(grid);
  }

  async function openProject(p: ProjectSummary): Promise<void> {
    if (!services) return;
    try {
      listHost.replaceChildren(loadingState({ label: `Opening ${p.name}…` }));
      await services.openProject(p.id);
      announce(`Opened project ${p.name}`);
      navigateTo({ view: "editor", projectId: p.id });
    } catch (err) {
      listHost.replaceChildren(
        errorState({
          title: `Could not open “${p.name}”`,
          detail: err instanceof Error ? err.message : String(err),
          retry: { label: "Try again", onClick: () => void refresh() },
          dismissible: true,
          onDismiss: () => void refresh(),
        }),
      );
    }
  }

  async function promptNew(): Promise<void> {
    if (!services) return;
    const name = window.prompt("Project name", "Untitled project");
    if (name === null) return;
    const trimmed = name.trim().slice(0, MAX_NAME_LEN) || "Untitled project";
    try {
      await services.createProject(trimmed);
      announce(`Created project ${trimmed}`);
      await refresh();
      navigateTo({ view: "editor" });
    } catch (err) {
      notify("error", "Could not create project", {
        detail: err instanceof Error ? err.message : String(err),
      });
    }
  }

  newBtn.addEventListener("click", () => void promptNew());
  importBtn.addEventListener("click", () => {
    // Media import from home: not wired until contract defines dialog ownership.
    notify("info", "Import from the project home arrives with contract v1 — open a project first.");
  });

  async function refresh(): Promise<void> {
    if (!services) return;
    try {
      const projects = await services.listProjects();
      renderList(projects);
    } catch (err) {
      listHost.replaceChildren(
        errorState({
          title: "Could not load projects",
          detail: err instanceof Error ? err.message : String(err),
          retry: { label: "Retry", onClick: () => void refresh() },
        }),
      );
    }
  }

  return {
    root,
    refresh,
    destroy() {
      root.replaceChildren();
    },
  };
}

function formatDuration(sec: number): string {
  if (!Number.isFinite(sec) || sec <= 0) return "0:00";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  if (m >= 60) {
    const h = Math.floor(m / 60);
    return `${h}:${String(m % 60).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }
  return `${m}:${String(s).padStart(2, "0")}`;
}

function formatDate(ts: number): string {
  try {
    return new Date(ts).toLocaleString(undefined, {
      month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
    });
  } catch {
    return "";
  }
}
