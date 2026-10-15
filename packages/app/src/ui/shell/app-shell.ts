/**
 * App shell — persistent frame around the active view.
 *
 * Provides: skip link, live region for announcements, view host,
 * status bar (autosave indicator, engine status, keyboard hint).
 * All state here is honest: engine status shows "not connected" until
 * getServices() returns the bridge.
 */

import { emptyState, el } from "../states/states";
import { bridge, getBridgeStatus, disableWithReason } from "../bridge";
import { detectPlatform, describeBinding } from "../interaction/keyboard-map";

export interface AppShell {
  root: HTMLElement;
  /** View host — router mounts/unmounts views here */
  viewHost: HTMLElement;
  /** Screen-reader announcements (import progress, save, errors) */
  announce(message: string, assertive?: boolean): void;
  /** Status bar hooks */
  setStatus(text: string, kind?: "normal" | "busy" | "error"): void;
  setDirty(dirty: boolean): void;
}

export function createAppShell(): AppShell {
  const bridgeStatus = getBridgeStatus();
  const hasEngine = bridgeStatus.connected;
  const platform = detectPlatform();

  const root = el("div", { class: "rw-shell" });

  const skip = el("a", {
    class: "skip-link",
    href: "#rw-main",
  }, "Skip to main content");
  root.append(skip);

  // ---- Header ----
  const brand = el("div", { class: "rw-brand" }, [
    el("span", { class: "rw-brand__mark", "aria-hidden": "true" }, "◆"),
    el("span", { class: "rw-brand__name" }, "Reelwright"),
  ]);

  const headerSlot = el("div", { class: "rw-header__slot" });
  const header = el("header", { class: "rw-header" }, [brand, headerSlot]);
  root.append(header);

  // ---- Main view host ----
  const viewHost = el("main", {
    class: "rw-main",
    id: "rw-main",
    tabindex: "-1",
  });
  root.append(viewHost);

  // ---- Status bar ----
  const dirtyEl = el("span", { class: "rw-status__item" }, "All changes saved");
  const statusEl = el("span", { class: "rw-status__item dim" }, "");
  const engineEl = el(
    "span",
    {
      class: `rw-status__item ${hasEngine ? "" : "rw-status__item--warn"}`,
      title: hasEngine ? "Media engine connected" : bridgeStatus.reason,
    },
    hasEngine ? "Engine ready" : "Engine not connected",
  );
  const hintEl = el(
    "span",
    { class: "rw-status__item faint" },
    `${describeBinding("?", platform)} shortcuts`,
  );
  const statusbar = el("footer", {
    class: "rw-statusbar",
    role: "contentinfo",
  }, [engineEl, statusEl, dirtyEl, hintEl]);
  root.append(statusbar);

  // ---- Live regions ----
  const politeRegion = el("div", {
    class: "sr-only", role: "status", "aria-live": "polite",
  });
  const assertiveRegion = el("div", {
    class: "sr-only", role: "alert", "aria-live": "assertive",
  });
  root.append(politeRegion, assertiveRegion);

  let announceTimer = 0;
  return {
    root,
    viewHost,
    announce(message: string, assertive = false) {
      const region = assertive ? assertiveRegion : politeRegion;
      // clear then set so identical messages re-announce
      region.textContent = "";
      window.clearTimeout(announceTimer);
      announceTimer = window.setTimeout(() => {
        region.textContent = message;
      }, 30);
    },
    setStatus(text, kind = "normal") {
      statusEl.textContent = text;
      statusEl.classList.toggle("rw-status__item--error", kind === "error");
      statusEl.classList.toggle("dim", kind !== "error");
    },
    setDirty(dirty) {
      dirtyEl.textContent = dirty ? "Unsaved changes" : "All changes saved";
      dirtyEl.classList.toggle("rw-status__item--warn", dirty);
    },
  };
}

/** Expose header slot so views can inject toolbar controls. */
export function headerSlotOf(shell: AppShell): HTMLElement | null {
  return shell.root.querySelector(".rw-header__slot");
}
