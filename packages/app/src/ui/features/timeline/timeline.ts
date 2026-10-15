/**
 * Multitrack timeline.
 *
 * Interactions (v1):
 *  - click ruler / lanes → seek; drag → scrub
 *  - click clip → select (⇧/⌘ toggles); drag body → move (engine moveClip, batched)
 *  - drag clip edges (8px handles) → trim (engine trimClip, batched)
 *  - drag media from the bin → drop onto a track (engine addClip)
 *  - snapping to playhead + clip edges with a visible snap line
 *  - zoom: ⌘+wheel over the timeline, toolbar buttons, ⇧Z fit
 *  - keyboard: split (S), delete, duplicate via the global key map
 *
 * All mutations go through the engine; the UI never edits project data.
 */

import { el, emptyState, notify } from "../../states/states";
import { call, errorMessage } from "../../bridge.js";
import {
  subscribe, getState, setPlayhead, selectClip, clearSelection,
  ticksToPx, pxToTicks, programEndTicks, setBusy, setZoom,
} from "../../state.js";
import type { Clip, Ticks, Track } from "../../ve.js";
import { TICKS_PER_SECOND, secFromTicks, ticksFromSec, formatTimecode } from "../../ve.js";

const LANE_H = 44;
const HEADER_W = 176;
const RULER_H = 28;
const SNAP_PX = 8;
const MIN_CLIP_PX = 3;

const RULER_STEPS_SEC = [
  1 / 25, 1 / 12, 1 / 6, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600,
];

export interface TimelinePanel {
  root: HTMLElement;
  destroy(): void;
}

export function createTimeline(): TimelinePanel {
  const root = el("div", { class: "rw-tl" });

  // ---- structure ----
  const corner = el("div", { class: "rw-tl__corner", "aria-hidden": "true" });
  const headerList = el("div", { class: "rw-tl__headers", role: "rowgroup" });
  const cornerTime = el("span", { class: "mono rw-tl__corner-time" }, "00:00:00:00");
  corner.append(cornerTime);
  const headers = el("div", { class: "rw-tl__header-col" }, [corner, headerList]);

  const ruler = el("div", { class: "rw-tl__ruler", "aria-label": "Timeline ruler" });
  const lanes = el("div", { class: "rw-tl__lanes", role: "group", "aria-label": "Tracks" });
  const playheadEl = el("div", { class: "rw-tl__playhead", "aria-hidden": "true" },
    [el("div", { class: "rw-tl__playhead-head" })]);
  const snaplineEl = el("div", { class: "rw-tl__snapline", "aria-hidden": "true", hidden: true as unknown as boolean });
  const content = el("div", { class: "rw-tl__content" }, [ruler, lanes, playheadEl, snaplineEl]);

  const scroller = el("div", { class: "rw-tl__scroll", tabindex: "0" }, [content]);
  const scrollerRow = el("div", { class: "rw-tl__scrollrow" }, [headers, scroller]);

  const emptyOverlay = el("div", { class: "rw-tl__empty" });
  root.append(scrollerRow, emptyOverlay);

  /* ---------------- helpers ---------------- */

  function fps() {
    return getState().state?.project?.settings.frameRate;
  }

  function contentWidth(): number {
    const end = Math.max(programEndTicks(), ticksFromSec(30));
    return Math.max(secFromTicks(end) * getState().pxPerSec + 320, scroller.clientWidth || 800);
  }

  function snapCandidates(excludeIds: Set<string>): Ticks[] {
    if (!getState().snapping) return [];
    const pts: Ticks[] = [0, getState().playhead];
    for (const t of getState().state?.project?.tracks ?? []) {
      for (const c of t.clips) {
        if (excludeIds.has(c.id)) continue;
        pts.push(c.start, c.start + c.duration);
      }
    }
    return pts;
  }

  /** Snap a tick value to the nearest candidate within SNAP_PX. Returns snapped + the candidate for the line. */
  function snapTick(t: Ticks, candidates: Ticks[]): { value: Ticks; line: Ticks | null } {
    const px = getState().pxPerSec;
    let best: { d: number; v: Ticks } | null = null;
    for (const c of candidates) {
      const d = Math.abs(ticksToPx(c - t));
      if (d <= SNAP_PX && (!best || d < best.d)) best = { d, v: c };
    }
    return best ? { value: best.v, line: best.v } : { value: t, line: null };
  }

  function showSnapline(t: Ticks | null): void {
    if (t === null || !getState().snapping) {
      snaplineEl.hidden = true as unknown as boolean;
      return;
    }
    snaplineEl.hidden = false as unknown as boolean;
    snaplineEl.style.left = `${ticksToPx(t)}px`;
  }

  /* ---------------- rendering ---------------- */

  function render(): void {
    const s = getState();
    const project = s.state?.project;
    const w = contentWidth();
    content.style.width = `${w}px`;

    renderRuler(w);
    renderHeaders(project?.tracks ?? []);
    renderLanes(project?.tracks ?? []);
    renderPlayhead();

    const isEmpty = !project || project.tracks.every((t) => t.clips.length === 0);
    emptyOverlay.hidden = !isEmpty;
    if (isEmpty && emptyOverlay.childElementCount === 0) {
      emptyOverlay.append(emptyState({
        icon: "⇄",
        title: project ? "Timeline is empty" : "No project open",
        description: project
          ? "Drag media from the bin onto a track, or double-click an asset to place it at the playhead."
          : "Open or create a project to edit.",
      }));
    }
  }

  function renderRuler(width: number): void {
    const px = getState().pxPerSec;
    const targetSec = 70 / px; // aim ~70px between labeled ticks
    const stepSec = RULER_STEPS_SEC.find((v) => v >= targetSec) ?? 600;
    const step = ticksFromSec(stepSec);
    const total = ticksFromSec(width / px);
    const f = fps();

    const frag = document.createDocumentFragment();
    for (let t = 0; t <= total; t += step) {
      const x = ticksToPx(t);
      const tick = el("div", { class: "rw-tl__tick", style: `left:${x}px` });
      frag.append(tick);
      if (stepSec >= 1) {
        const label = f ? formatTimecode(t, f) : secFromTicks(t).toFixed(2);
        tick.append(el("span", { class: "rw-tl__tick-label mono" }, label));
      }
    }
    ruler.replaceChildren(frag);
    ruler.style.height = `${RULER_H}px`;
  }

  function renderHeaders(tracks: Track[]): void {
    headerList.replaceChildren();
    for (const track of tracks) {
      const row = el("div", {
        class: `rw-tl__header rw-tl__header--${track.kind}${track.locked ? " rw-tl__header--locked" : ""}`,
        style: `height:${LANE_H}px`,
      });
      row.append(
        el("span", { class: "rw-tl__header-icon", "aria-hidden": "true" },
          track.kind === "audio" ? "♪" : "▶"),
        el("span", { class: "rw-tl__header-name", title: track.name }, track.name),
      );
      const flags = el("div", { class: "rw-tl__header-flags" });
      flags.append(
        flagButton(track, "muted", track.kind === "audio" ? "Mute track" : "Hide track"),
        flagButton(track, "locked", "Lock track"),
      );
      row.append(flags);
      headerList.append(row);
    }
    // vertical spacer so headers scroll in sync is handled by shared row heights
  }

  function flagButton(track: Track, flag: "muted" | "locked", label: string): HTMLElement {
    const on = flag === "muted" ? track.muted : track.locked;
    const glyph = flag === "muted" ? (track.kind === "audio" ? "🔇" : "👁") : "🔒";
    const btn = el("button", {
      class: `rw-tl__flag${on ? " rw-tl__flag--on" : ""}`,
      type: "button",
      "aria-pressed": String(on),
      "aria-label": `${label}: ${track.name}`,
      title: `${label} (${track.name})`,
    }, glyph);
    btn.addEventListener("click", () => {
      void setTrackFlag(track.id, flag, !on);
    });
    return btn;
  }

  async function setTrackFlag(trackId: string, flag: "muted" | "locked", value: boolean): Promise<void> {
    try {
      await call("timeline.setTrackFlags", [trackId, { [flag]: value }]);
    } catch (err) {
      const e = errorMessage(err);
      notify("error", e.message, e.hint ? { detail: e.hint } : {});
    }
  }

  function renderLanes(tracks: Track[]): void {
    lanes.replaceChildren();
    lanes.style.height = `${Math.max(tracks.length * LANE_H, 120)}px`;
    const s = getState();

    tracks.forEach((track, index) => {
      const lane = el("div", {
        class: `rw-tl__lane rw-tl__lane--${track.kind}`
          + (track.muted || track.hidden ? " rw-tl__lane--dimmed" : "")
          + (track.locked ? " rw-tl__lane--locked" : ""),
        style: `top:${index * LANE_H}px;height:${LANE_H - 2}px`,
        "data-track-id": track.id,
      });
      lane.addEventListener("pointerdown", (e) => {
        if (e.target === lane) {
          // click empty lane → seek (and start scrub)
          clearSelection();
          scrubFromEvent(e);
        }
      });
      for (const clip of track.clips) {
        lane.append(clipEl(clip, track));
      }
      lanes.append(lane);
    });
  }

  function clipEl(clip: Clip, track: Track): HTMLElement {
    const asset = getState().state?.project?.assets.find((a) => a.id === clip.assetId);
    const kind = asset?.kind ?? "video";
    const node = el("div", {
      class: `rw-tl__clip rw-tl__clip--${kind}`
        + (s_selection().has(clip.id) ? " rw-tl__clip--selected" : "")
        + (clip.enabled ? "" : " rw-tl__clip--disabled")
        + (track.locked ? " rw-tl__clip--locked" : ""),
      style: `left:${ticksToPx(clip.start)}px;width:${Math.max(ticksToPx(clip.duration), MIN_CLIP_PX)}px`,
      "data-clip-id": clip.id,
      tabindex: "0",
      role: "button",
      "aria-label": `${asset?.name ?? "clip"} on ${track.name}, starts ${secFromTicks(clip.start).toFixed(2)} seconds, duration ${secFromTicks(clip.duration).toFixed(2)} seconds`,
      title: asset?.name ?? "clip",
    });
    node.append(
      el("div", { class: "rw-tl__clip-label" }, asset?.name ?? "clip"),
      el("div", { class: "rw-tl__trim rw-tl__trim--in", "data-edge": "in", "aria-hidden": "true" }),
      el("div", { class: "rw-tl__trim rw-tl__trim--out", "data-edge": "out", "aria-hidden": "true" }),
    );

    node.addEventListener("pointerdown", (e) => onClipPointerDown(e, clip, track, node));
    node.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.stopPropagation();
        selectClip(clip.id, e.shiftKey ? "toggle" : "replace");
      }
    });
    return node;
  }

  function s_selection() {
    return getState().selection;
  }

  function renderPlayhead(): void {
    const s = getState();
    playheadEl.style.left = `${ticksToPx(s.playhead)}px`;
    const f = fps();
    cornerTime.textContent = f
      ? formatTimecode(s.playhead, f)
      : secFromTicks(s.playhead).toFixed(2);
  }

  /* ---------------- scrubbing ---------------- */

  function scrubFromEvent(e: PointerEvent): void {
    const rect = content.getBoundingClientRect();
    const x = e.clientX - rect.left;
    setPlayhead(pxToTicks(x), { snapToFrame: true });
    const onMove = (ev: PointerEvent) => {
      const xx = ev.clientX - rect.left;
      setPlayhead(pxToTicks(xx), { snapToFrame: true });
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  ruler.addEventListener("pointerdown", (e) => scrubFromEvent(e));

  /* ---------------- clip drag (move) & trim ---------------- */

  function onClipPointerDown(
    e: PointerEvent, clip: Clip, track: Track, node: HTMLElement,
  ): void {
    e.stopPropagation();
    const s = getState();
    const mode = e.shiftKey || e.metaKey || e.ctrlKey ? "toggle" : "replace";
    selectClip(clip.id, mode);

    const edge = (e.target as HTMLElement).dataset?.edge as "in" | "out" | undefined;
    if (track.locked) {
      if (!edge) notify("info", `Track “${track.name}” is locked — unlock it to edit its clips.`);
      return;
    }

    const startX = e.clientX;
    const startY = e.clientY;
    const startTicks = clip.start;
    const durTicks = clip.duration;
    const px0 = ticksToPx(startTicks);
    const widthPx = Math.max(ticksToPx(durTicks), MIN_CLIP_PX);
    let moved = false;
    let batched = false;

    const targetTrackLanes = [...lanes.querySelectorAll<HTMLElement>(".rw-tl__lane")];

    const onMove = async (ev: PointerEvent): Promise<void> => {
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      if (!moved && Math.abs(dx) < 3 && Math.abs(dy) < 3) return;
      moved = true;
      if (!batched) {
        batched = true;
        try { await call("history.beginBatch"); } catch { /* non-fatal */ }
      }

      if (edge === "in") {
        let to = pxToTicks(px0 + dx);
        const { value, line } = snapForEdge(to, clip);
        to = clampInEdge(value, clip);
        node.style.left = `${ticksToPx(to)}px`;
        node.style.width = `${Math.max(widthPx + (px0 - ticksToPx(to)), MIN_CLIP_PX)}px`;
        showSnapline(line);
      } else if (edge === "out") {
        let to = pxToTicks(px0 + widthPx + dx);
        const { value, line } = snapForEdge(to, clip);
        to = clampOutEdge(value, clip);
        node.style.width = `${Math.max(ticksToPx(to - startTicks), MIN_CLIP_PX)}px`;
        showSnapline(line);
      } else {
        // move: horizontal = time, vertical = track
        let to = pxToTicks(px0 + dx);
        const { value, line } = snapForMove(to, clip);
        node.style.left = `${ticksToPx(value)}px`;
        showSnapline(line);
        const laneUnder = laneAtY(ev.clientY, targetTrackLanes);
        const underId = laneUnder?.dataset.trackId;
        const canDropTo =
          underId !== undefined &&
          underId !== track.id &&
          (s.state?.project?.tracks.some(
            (t) => t.id === underId && !t.locked && t.kind === track.kind,
          ) ?? false);
        if (canDropTo) {
          node.style.top = "";
          node.classList.add("rw-tl__clip--ghosting");
        } else {
          // Second head fix (T2): the ghost class was never cleared when the
          // pointer moved back over the original/invalid lane — a stale drop
          // affordance stayed visible mid-drag.
          node.classList.remove("rw-tl__clip--ghosting");
        }
      }
    };

    const onUp = async (ev: PointerEvent): Promise<void> => {
      window.removeEventListener("pointermove", onMove as unknown as EventListener);
      window.removeEventListener("pointerup", onUp as unknown as EventListener);
      showSnapline(null);
      if (!moved) return;
      setBusy("Applying edit…");
      try {
        if (edge === "in") {
          let to = pxToTicks(nodeLeftPx(node));
          to = clampInEdge(to, clip);
          await call("timeline.trimClip", [clip.id, { edge: "in", to }]);
        } else if (edge === "out") {
          const w = nodeWidthPx(node);
          let to = pxToTicks(nodeLeftPx(node) + w);
          to = clampOutEdge(to, clip);
          await call("timeline.trimClip", [clip.id, { edge: "out", to }]);
        } else {
          let to = pxToTicks(nodeLeftPx(node));
          const laneUnder = laneAtY(ev.clientY, targetTrackLanes);
          const targetTrackId =
            laneUnder &&
            laneUnder.dataset.trackId !== track.id &&
            s.state?.project?.tracks.find((t) => t.id === laneUnder.dataset.trackId && !t.locked && t.kind === track.kind)
              ? laneUnder.dataset.trackId
              : undefined;
          await call("timeline.moveClip", [clip.id, targetTrackId ? { start: to, trackId: targetTrackId } : { start: to }]);
        }
      } catch (err) {
        const e2 = errorMessage(err);
        notify("error", e2.message, e2.hint ? { detail: e2.hint } : undefined);
      } finally {
        if (batched) {
          try { await call("history.endBatch"); } catch { /* non-fatal */ }
        }
        setBusy(null);
      }
    };

    window.addEventListener("pointermove", onMove as unknown as EventListener);
    window.addEventListener("pointerup", onUp as unknown as EventListener);
  }

  function nodeLeftPx(node: HTMLElement): number {
    return Number.parseFloat(node.style.left || "0");
  }
  function nodeWidthPx(node: HTMLElement): number {
    return Number.parseFloat(node.style.width || "0");
  }

  function clampInEdge(to: Ticks, clip: Clip): Ticks {
    const maxTo = clip.start + clip.duration - ticksFromSec(0.05);
    return Math.max(0, Math.min(to, maxTo));
  }
  function clampOutEdge(to: Ticks, clip: Clip): Ticks {
    const minTo = clip.start + ticksFromSec(0.05);
    return Math.max(minTo, to);
  }

  function snapForMove(to: Ticks, clip: Clip): { value: Ticks; line: Ticks | null } {
    const cands = snapCandidates(new Set([clip.id]));
    // Also snap the clip's TAIL onto candidates: tail = to + dur should land on
    // candidate c, i.e. to = c - dur.
    const head = snapTick(to, cands);
    if (head.line !== null) return head;
    // Second head fix (T1): the previous version pre-mapped candidates by -dur
    // BEFORE snapTick, which measured |c - to - 2*dur| — triggering a snap when
    // the head reached c - 2*dur and then jumping the clip to c - dur (a
    // phantom jump up to a full clip-length away, or missing tail snaps).
    // Snap the raw candidates against the tail position, then derive `to`.
    const tail = snapTick(to + clip.duration, cands);
    if (tail.line !== null && tail.value - clip.duration >= 0) {
      return { value: tail.value - clip.duration, line: tail.value };
    }
    return head;
  }

  function snapForEdge(to: Ticks, clip: Clip): { value: Ticks; line: Ticks | null } {
    const cands = snapCandidates(new Set([clip.id]));
    return snapTick(to, cands);
  }

  function laneAtY(clientY: number, lanesEls: HTMLElement[]): HTMLElement | null {
    for (const lane of lanesEls) {
      const r = lane.getBoundingClientRect();
      if (clientY >= r.top && clientY <= r.bottom) return lane;
    }
    return null;
  }

  /* ---------------- drop from media bin ---------------- */

  lanes.addEventListener("dragover", (e) => {
    if (!e.dataTransfer?.types.includes("application/x-ve-asset")) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  });

  lanes.addEventListener("drop", (e) => {
    const assetId = e.dataTransfer?.getData("application/x-ve-asset");
    if (!assetId) return;
    e.preventDefault();
    const rect = content.getBoundingClientRect();
    let at = pxToTicks(e.clientX - rect.left);
    const { value, line } = snapTick(at, snapCandidates(new Set()));
    at = Math.max(0, value);
    showSnapline(line);
    setTimeout(() => showSnapline(null), 500);

    const lane = laneAtY(e.clientY, [...lanes.querySelectorAll<HTMLElement>(".rw-tl__lane")]);
    void placeAsset(assetId, at, lane?.dataset.trackId);
  });

  async function placeAsset(assetId: string, at: Ticks, trackId?: string): Promise<void> {
    const s = getState();
    const asset = s.state?.project?.assets.find((a) => a.id === assetId);
    if (!asset) return;
    setBusy(`Adding “${asset.name}”…`);
    try {
      let targetId = trackId;
      const wanted = asset.kind === "audio" ? "audio" : "video";
      if (targetId) {
        const t = s.state?.project?.tracks.find((x) => x.id === targetId);
        if (!t || t.locked || t.kind !== wanted) targetId = undefined;
      }
      if (!targetId) {
        targetId = s.state?.project?.tracks.find((t) => t.kind === wanted && !t.locked)?.id ?? "";
      }
      if (!targetId) {
        const t = await call<Track>("timeline.addTrack", [wanted]);
        targetId = t.id;
      }
      await call("timeline.addClip", [{ trackId: targetId, assetId, start: at }]);
    } catch (err) {
      const e = errorMessage(err);
      notify("error", e.message, e.hint ? { detail: e.hint } : undefined);
    } finally {
      setBusy(null);
    }
  }

  /* ---------------- zoom (⌘/ctrl + wheel over timeline) ---------------- */

  scroller.addEventListener("wheel", (e) => {
    if (!e.metaKey && !e.ctrlKey) return;
    e.preventDefault();
    const rect = content.getBoundingClientRect();
    const anchorX = e.clientX - rect.left;
    const anchorTick = pxToTicks(anchorX);
    const factor = e.deltaY < 0 ? 1.2 : 1 / 1.2;
    const px = Math.max(8, Math.min(800, getState().pxPerSec * factor));
    setZoomKeepingAnchor(px, anchorTick, anchorX);
  }, { passive: false });

  function setZoomKeepingAnchor(px: number, anchorTick: Ticks, anchorX: number): void {
    setZoom(px);
    requestAnimationFrame(() => {
      scroller.scrollLeft = Math.max(0, ticksToPx(anchorTick) - anchorX);
    });
  }

  /* ---------------- auto-scroll during playback ---------------- */

  function followPlayhead(): void {
    if (!getState().playing) return;
    const x = ticksToPx(getState().playhead);
    const view = scroller.clientWidth;
    if (x < scroller.scrollLeft + 40 || x > scroller.scrollLeft + view - 60) {
      scroller.scrollLeft = Math.max(0, x - view / 3);
    }
  }

  const unsub = subscribe(() => {
    render();
    followPlayhead();
  });

  render();

  return {
    root,
    destroy() {
      unsub();
    },
  };
}
