/**
 * Home / project library view (contract v1 API):
 *  - `project.recent` → list of { path, name, openedAt }
 *  - `project.open(path)` → offers newer autosave when hinted (nothing auto-overwritten)
 *  - `project.create({ name, dir })` → native directory picker + name prompt
 *
 * Honest states throughout: engine absent → disabled with reason; empty → CTA.
 */

import { el, emptyState, loadingState, errorState, notify } from "../../states/states";
import { call, pickProjectDirectory, errorMessage, isDesktop } from "../../bridge.js";
import { wireEngineEvents, refreshState, verifyAssets } from "../../state.js";
import { navigateTo } from "../../router";
import type { AutosaveInfo, OpenProjectResult, RecentEntry } from "../../ve.js";

export interface HomeView {
  root: HTMLElement;
  refresh(): Promise<void>;
  destroy(): void;
}

const MAX_NAME_LEN = 80;

export function createHomeView(announce: (m: string, a?: boolean) => void): HomeView {
  const root = el("div", { class: "rw-home" });
  const engineHere = isDesktop() || typeof window.ve === "object";

  const title = el("h1", {}, "Reelwright");
  const sub = el("p", { class: "dim" },
    "Local-first video editing. Create a project, import media, cut on the timeline, and export — everything stays on this computer.");

  const newBtn = el("button", { class: "rw-btn rw-btn--primary", type: "button" }, "＋ New project");
  const hero = el("div", { class: "rw-home__hero" }, [
    el("div", { class: "rw-home__heroText" }, [title, sub]),
    el("div", { class: "rw-home__actions" }, [newBtn]),
  ]);
  root.append(hero);

  if (!window.ve) {
    root.append(
      errorState({
        title: "Engine not connected",
        detail:
          "You are viewing the interface shell only. Run the desktop build "
          + "(npm start -w @ve/app) to create, open, and edit projects.",
      }),
    );
    newBtn.disabled = true;
    newBtn.title = "Requires the desktop app with the engine connected.";
  }

  const listHost = el("section", { class: "rw-home__list", "aria-label": "Recent projects" });
  root.append(listHost);

  /* ---------------- create ---------------- */

  newBtn.addEventListener("click", () => void promptNew());

  async function promptNew(): Promise<void> {
    if (!window.ve) return;
    // Directory first (native dialog), then name.
    const dir = await pickProjectDirectory();
    if (!dir) return;
    const name = window.prompt("Project name", "Untitled project");
    if (name === null) return;
    const trimmed = name.trim().slice(0, MAX_NAME_LEN) || "Untitled project";
    try {
      await call("project.create", [{ name: trimmed, dir }]);
      wireEngineEvents();
      await refreshState();
      await verifyAssets();
      announce(`Created project ${trimmed}`);
      navigateTo({ view: "editor" });
    } catch (err) {
      const e = errorMessage(err);
      notify("error", `Could not create project: ${e.message}`, e.hint ? { detail: e.hint } : {});
    }
  }

  /* ---------------- list ---------------- */

  async function refresh(): Promise<void> {
    if (!window.ve) return;
    try {
      const recent = await call<RecentEntry[]>("project.recent");
      renderList(recent);
    } catch (err) {
      listHost.replaceChildren(
        errorState({
          title: "Could not load recent projects",
          detail: errorMessage(err).message,
          retry: { label: "Retry", onClick: () => void refresh() },
        }),
      );
    }
  }

  function renderList(recent: RecentEntry[]): void {
    listHost.replaceChildren();
    if (recent.length === 0) {
      listHost.append(
        emptyState({
          icon: "▦",
          title: "No projects yet",
          description: "Create your first project — you choose the folder where it lives.",
          action: { label: "New project", onClick: () => void promptNew() },
        }),
      );
      return;
    }
    const h = el("h2", { class: "rw-home__section" }, "Recent projects");
    const grid = el("div", { class: "rw-project-grid" });
    for (const entry of recent) {
      grid.append(projectCard(entry));
    }
    listHost.append(h, grid);
  }

  function projectCard(entry: RecentEntry): HTMLElement {
    const card = el("article", { class: "rw-project-card" });
    const openBtn = el("button", {
      class: "rw-project-card__open",
      type: "button",
      "aria-label": `Open project ${entry.name}`,
    }, [
      el("div", { class: "rw-project-card__thumb mono" }, "▶"),
      el("div", { class: "rw-project-card__meta" }, [
        el("h3", { class: "rw-project-card__name" }, entry.name),
        el("p", { class: "rw-project-card__stats faint mono", title: entry.path },
          `${entry.path.split("/").slice(-2).join("/")} · ${formatDate(entry.openedAt)}`),
      ]),
    ]);
    openBtn.addEventListener("click", () => void openEntry(entry));
    card.append(openBtn);
    return card;
  }

  async function openEntry(entry: RecentEntry): Promise<void> {
    listHost.replaceChildren(loadingState({ label: `Opening ${entry.name}…` }));
    try {
      const result = await call<OpenProjectResult>("project.open", [entry.path]);
      wireEngineEvents();
      await refreshState();
      await verifyAssets();
      announce(`Opened project ${entry.name}`);
      navigateTo({ view: "editor" });
      if (result.recoveredAutosave) {
        offerAutosave(entry, result.recoveredAutosave);
      }
    } catch (err) {
      const e = errorMessage(err);
      listHost.replaceChildren(
        errorState({
          title: `Could not open “${entry.name}”`,
          detail: `${e.message}${e.hint ? `\n${e.hint}` : ""}`,
          retry: { label: "Try again", onClick: () => void refresh() },
          dismissible: true,
          onDismiss: () => void refresh(),
        }),
      );
    }
  }

  /** Contract: nothing is auto-overwritten — the UI offers recovery explicitly. */
  function offerAutosave(entry: RecentEntry, autosave: AutosaveInfo): void {
    const when = formatDate(autosave.modifiedMs);
    const box = el("div", { class: "rw-error", role: "alert", style: "margin:0 0 16px" }, [
      el("div", { class: "rw-error__title" }, [
        el("strong", {}, `A newer autosave of “${entry.name}” exists (${when})`),
      ]),
      el("p", { class: "dim" }, "The project file opened as saved. Recover the newer autosave instead?"),
    ]);
    const row = el("div", { class: "rw-error__actions" });
    const recover = el("button", { class: "rw-btn rw-btn--primary", type: "button" }, "Recover autosave");
    const keep = el("button", { class: "rw-btn", type: "button" }, "Keep the saved version");
    row.append(recover, keep);
    box.append(row);
    root.prepend(box);

    recover.addEventListener("click", async () => {
      try {
        await call("persistence.autosaveRecover", [autosave.path]);
        await refreshState();
        await verifyAssets();
        notify("success", `Recovered autosave of “${entry.name}” — save to keep it.`);
        navigateTo({ view: "editor" });
      } catch (err) {
        const e = errorMessage(err);
        notify("error", `Recovery failed: ${e.message}`, e.hint ? { detail: e.hint } : {});
      } finally {
        box.remove();
      }
    });
    keep.addEventListener("click", () => box.remove());
  }

  return {
    root,
    refresh,
    destroy() {
      root.replaceChildren();
    },
  };
}

function formatDate(ts: number | string): string {
  const d = typeof ts === "string" ? new Date(ts) : new Date(ts);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString(undefined, {
    month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
  });
}
