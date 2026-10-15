/**
 * Media bin — imported assets list with import, drag-to-timeline,
 * missing-file badges + relink. Honest empty/loading/error states.
 */

import { el, emptyState, loadingState, errorState, notify } from "../../states/states";
import { call, pickMediaFiles, isDesktop, errorMessage } from "../../bridge.js";
import {
  subscribe, getState, setPlayhead, programEndTicks, verifyAssets,
} from "../../state.js";
import type { Asset, Ticks } from "../../ve.js";
import { TICKS_PER_SECOND, fsec } from "../../ve.js";

const KIND_ICON: Record<string, string> = {
  video: "▶", audio: "♪", image: "🖼", text: "T",
};

export interface MediaBin {
  root: HTMLElement;
  refresh(): void;
  destroy(): void;
}

export function createMediaBin(): MediaBin {
  const root = el("section", { class: "rw-bin" });
  const title = el("div", { class: "rw-panel__title" }, [
    el("span", {}, "Media"),
  ]);
  const importBtn = el("button", {
    class: "rw-btn rw-btn--primary",
    type: "button",
  }, "＋ Import");
  title.append(importBtn);
  const list = el("div", { class: "rw-bin__list", role: "list" });
  root.append(title, list);

  if (!isDesktop()) {
    importBtn.disabled = true;
    importBtn.title = "Import requires the desktop app (native file dialog).";
  }

  importBtn.addEventListener("click", () => void importMedia());

  async function importMedia(): Promise<void> {
    const { importMedia: runImport } = await import("../../commands.js");
    await runImport();
    refresh();
  }

  function refresh(): void {
    const { state, missing, connected } = getState();
    list.replaceChildren();

    if (!connected) {
      list.append(emptyState({
        icon: "▤",
        title: "Media bin is offline",
        description: "The engine is not connected, so there are no project assets to show.",
      }));
      return;
    }
    if (!state?.project) {
      list.append(emptyState({ icon: "▤", title: "No project open" }));
      return;
    }
    const assets = state.project.assets.filter((a) => a.kind !== "text");
    if (assets.length === 0) {
      list.append(emptyState({
        icon: "▤",
        title: "No media yet",
        description: "Import video, audio, or image files to start editing.",
        ...(isDesktop()
          ? { action: { label: "Import media", onClick: () => void importMedia() } }
          : { hint: "Import requires the desktop app." }),
      }));
      return;
    }
    for (const asset of assets) {
      list.append(assetItem(asset, missing.has(asset.id)));
    }
  }

  function assetItem(asset: Asset, isMissing: boolean): HTMLElement {
    const item = el("div", {
      class: `rw-bin__item${isMissing ? " rw-bin__item--missing" : ""}`,
      role: "listitem",
      draggable: "true",
      tabindex: "0",
      title: isMissing
        ? "File is missing — use Relink to locate it"
        : "Drag to the timeline, or double-click to append at the playhead",
    });

    const meta = asset.meta;
    const stats: string[] = [];
    if (meta.durationTicks) stats.push(fsec(meta.durationTicks as Ticks));
    if (meta.video) stats.push(`${meta.video.width}×${meta.video.height}`);
    if (meta.audio && !meta.video) {
      stats.push(`${meta.audio.channels}ch ${Math.round(meta.audio.sampleRate / 1000)}kHz`);
    }

    item.append(
      el("span", { class: "rw-bin__icon", "aria-hidden": "true" }, KIND_ICON[asset.kind] ?? "•"),
      el("div", { class: "rw-bin__meta" }, [
        el("div", { class: "rw-bin__name", title: asset.source.path }, asset.name),
        el("div", { class: "rw-bin__stats faint mono" }, stats.join(" · ")),
      ]),
    );

    if (isMissing) {
      const badge = el("span", { class: "rw-badge rw-badge--warn" }, "Missing");
      item.append(badge);
      const relink = el("button", {
        class: "rw-btn rw-btn--ghost rw-btn--icon",
        type: "button",
        title: "Locate the file in its new location",
        "aria-label": `Relink ${asset.name}`,
      }, "⟳");
      relink.addEventListener("click", (e) => {
        e.stopPropagation();
        void relinkAsset(asset);
      });
      item.append(relink);
    }

    item.addEventListener("dragstart", (e) => {
      e.dataTransfer?.setData("application/x-ve-asset", asset.id);
      if (e.dataTransfer) e.dataTransfer.effectAllowed = "copy";
    });

    item.addEventListener("dblclick", () => void appendAtPlayhead(asset));
    item.addEventListener("keydown", (e) => {
      if (e.key === "Enter") void appendAtPlayhead(asset);
    });

    return item;
  }

  /** Double-click: append the asset at the playhead on a matching track. */
  async function appendAtPlayhead(asset: Asset): Promise<void> {
    const kind = asset.kind === "audio" ? "audio" : "video";
    try {
      let trackId = pickTrackFor(kind);
      if (!trackId) {
        const t = await call<{ id: string }>("timeline.addTrack", [kind]);
        trackId = t.id;
      }
      const at = Math.max(getState().playhead, 0);
      await call("timeline.addClip", [{ trackId, assetId: asset.id, start: at }]);
      refresh();
    } catch (err) {
      const e = errorMessage(err);
      notify("error", e.message, e.hint ? { detail: e.hint } : {});
    }
  }

  function pickTrackFor(kind: "video" | "audio"): string | null {
    const tracks = getState().state?.project?.tracks ?? [];
    const match = tracks.find((t) => t.kind === kind && !t.locked);
    return match?.id ?? null;
  }

  async function relinkAsset(asset: Asset): Promise<void> {
    const paths = await pickMediaFiles();
    if (paths.length === 0) return;
    try {
      await call("project.relinkAsset", [asset.id, paths[0]]);
      notify("success", `Relinked “${asset.name}”`);
      await verifyAssets();
      refresh();
    } catch (err) {
      const e = errorMessage(err);
      notify("error", `Relink failed: ${e.message}`, e.hint ? { detail: e.hint } : {});
    }
  }

  const unsub = subscribe(refresh);

  return {
    root,
    refresh,
    destroy() {
      unsub();
    },
  };
}
