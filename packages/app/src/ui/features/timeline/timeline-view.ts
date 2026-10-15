/**
 * Multitrack timeline view — ruler, track headers, clips, playhead, snapping,
 * drag/trim, zoom, and the timeline-scoped keyboard actions.
 *
 * Owner: Agent 2 (second team). Mounted into the editor's `timelineHost`
 * via `installTimeline(host)`.
 *
 * Contract with the rest of the UI:
 *  - Reads/writes ONLY through `services.ts` (`getServices()`); when the
 *    engine bridge is absent the timeline renders an honest unavailable
 *    state — never a fake-working one (charter honesty rule).
 *  - Project data is snapshot-driven: engine events → `refresh()` →
 *    `services.getState()` full re-fetch (contract §Events, v1 model).
 *  - Selection, zoom, snap toggle, and scroll are *view* state (the engine
 *    has no selection concept in contract v1).
 *  - All commits are frame-rounded (`timeline-math.roundToFrame`) before
 *    crossing the boundary.
 */

import { el, emptyState, errorState, notify } from "../../states/states";
import {
  getServices,
  NO_ENGINE_REASON,
  disableWithReason,
  type EngineState,
  type AssetInfo,
} from "../../services";
import {
  resolveEvent,
  detectPlatform,
  type KeyboardActionId,
  type Platform,
} from "../../interaction/keyboard-map";
import * as M from "./timeline-math";
import "./timeline.css";

const HEADER_W = () =>
  pxVar("--rw-timeline-header-w", 176);

function pxVar(name: string, fallback: number): number {
  if (typeof window === "undefined") return fallback;
  const v = getComputedStyle(document.documentElement).getPropertyValue(name);
  const n = parseFloat(v);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/* ------------------------------------------------------------------ *
 * Unified row items: engine clips + text layers
 * ------------------------------------------------------------------ */

type ItemKind = "video" | "audio" | "image" | "text";

interface RowItem {
  id: string;
  kind: ItemKind;
  start: number;
  duration: number;
  label: string;
  trackId: string;
  /** Text layers ride separate services calls in the v1 UI boundary. */
  isTextLayer: boolean;
  thumbUrl?: string;
  missing?: boolean;
}

interface RowTrack {
  id: string;
  kind: "video" | "audio" | "text";
  name: string;
  locked: boolean;
  muted: boolean;
  hidden: boolean;
  items: RowItem[];
}

export interface TimelineView {
  root: HTMLElement;
  /** Push a fresh engine snapshot (also called internally on events). */
  setProjectState(state: EngineState | null): void;
  /** Move the playhead (engine event or local seek). */
  setPlayhead(sec: number, playing?: boolean): void;
  /**
   * Handle a keyboard action from the shared keyboard map. Returns true when
   * consumed (caller must not also handle it).
   */
  handleAction(id: KeyboardActionId): boolean;
  focus(): void;
  destroy(): void;
}

export interface TimelineOptions {
  announce?: (message: string) => void;
}

export function createTimelineView(opts: TimelineOptions = {}): TimelineView {
  const announce = opts.announce ?? (() => {});
  const services = getServices();
  const platform: Platform = detectPlatform();

  /* ---------------- view state ---------------- */
  let state: EngineState | null = null;
  let loadError: string | null = null;
  let playheadSec = 0;
  let playing = false;
  let zoom = M.DEFAULT_ZOOM_PX_PER_SEC;
  let snapOn = true;
  let selection = new Set<string>();
  let rows: RowTrack[] = [];
  let contentSec = 30; // never narrower than 30 s of visible content
  const unsubs: Array<() => void> = [];

  const fps = (): M.FrameRate => {
    const f = state?.project?.fps;
    return f && f > 0 ? { n: Math.round(f), d: 1 } : M.DEFAULT_FPS;
  };

  /* ---------------- DOM skeleton ---------------- */

  const timecodeEl = el("output", { class: "rw-tl__timecode mono" }, ["00:00:00:00"]);
  const durationEl = el("span", { class: "rw-tl__timecode-dim mono" }, ["/ 00:00:00:00"]);

  const snapBtn = toolbarBtn("Snap", "Toggle snapping (N)", () => {
    snapOn = !snapOn;
    snapBtn.setAttribute("aria-pressed", String(snapOn));
    snapBtn.classList.toggle("is-on", snapOn);
    announce(snapOn ? "Snapping on" : "Snapping off");
  });
  snapBtn.setAttribute("aria-pressed", "true");
  snapBtn.classList.add("is-on");

  const addTrackBtn = toolbarBtn("+ Track", "Add a track", () => addTrack());
  const zoomOutBtn = toolbarBtn("−", "Zoom out (−)", () => zoomBy(1 / 1.35));
  const zoomInBtn = toolbarBtn("+", "Zoom in (+)", () => zoomBy(1.35));
  const fitBtn = toolbarBtn("Fit", "Zoom to fit sequence (⇧Z)", () => zoomFit());

  const zoomSlider = el("input", {
    class: "rw-tl__zoom-slider",
    type: "range",
    min: String(M.MIN_ZOOM_PX_PER_SEC),
    max: String(M.MAX_ZOOM_PX_PER_SEC),
    step: "1",
    value: String(zoom),
    "aria-label": "Timeline zoom level",
  }) as HTMLInputElement;
  zoomSlider.addEventListener("input", () => {
    setZoom(parseFloat(zoomSlider.value), null);
  });

  const toolbar = el("div", { class: "rw-tl__bar" }, [
    el("span", { class: "rw-tl__bar-group" }, [timecodeEl, durationEl]),
    el("span", { class: "rw-tl__spacer" }),
    el("span", { class: "rw-tl__bar-group" }, [snapBtn, addTrackBtn]),
    el("span", { class: "rw-tl__bar-group" }, [
      zoomOutBtn, zoomSlider, zoomInBtn, fitBtn,
    ]),
  ]);

  const scroll = el("div", { class: "rw-tl__scroll", tabindex: "0",
    "aria-label": "Timeline tracks" });
  const canvas = el("div", { class: "rw-tl__canvas" });
  const playheadEl = el("div", { class: "rw-tl__playhead", "aria-hidden": "true" },
    [el("div", { class: "rw-tl__playhead-grip" })]);
  const snaplineEl = el("div", { class: "rw-tl__snapline", "aria-hidden": "true" });
  snaplineEl.hidden = true;
  canvas.append(playheadEl, snaplineEl);
  scroll.append(canvas);

  const root = el("div", { class: "rw-tl", role: "group",
    "aria-label": "Timeline editor" }, [toolbar, scroll]);

  /* ---------------- helpers ---------------- */

  function toolbarBtn(label: string, title: string, onClick: () => void): HTMLButtonElement {
    const b = el("button", { class: "rw-btn rw-btn--ghost rw-tl__btn", type: "button",
      title }, [label]) as HTMLButtonElement;
    b.addEventListener("click", onClick);
    return b;
  }

  function buildRows(s: EngineState): RowTrack[] {
    const assetById = new Map<string, AssetInfo>(s.assets.map((a) => [a.id, a]));
    const out: RowTrack[] = s.tracks.map((t) => ({
      id: t.id,
      kind: t.kind,
      name: t.name,
      locked: !!t.locked,
      muted: !!t.muted,
      // TrackInfo in services.ts has no `hidden` flag yet (see contract review note);
      // render false until the boundary exposes it.
      hidden: false,
      items: t.clips.map((c) => {
        const asset = assetById.get(c.assetId);
        const kind: ItemKind =
          asset?.kind === "audio" ? "audio"
          : asset?.kind === "image" ? "image"
          : asset?.kind === "video" ? "video"
          : "video";
        return {
          id: c.id,
          kind,
          start: c.startSec,
          duration: Math.max(0.01, c.durationSec),
          label: asset?.name ?? c.assetId,
          trackId: t.id,
          isTextLayer: false,
          thumbUrl: asset?.thumbUrl,
          missing: asset?.missing,
        };
      }),
    }));

    // Text layers are a separate list at this services boundary (see contract
    // review notes). Attach them to the first compatible track for display;
    // if none exists, synthesize a display-only "Text" row.
    for (const tl of s.textLayers ?? []) {
      const item: RowItem = {
        id: tl.id,
        kind: "text",
        start: tl.startSec,
        duration: Math.max(0.01, tl.durationSec),
        label: tl.text || "Text",
        trackId: tl.trackId,
        isTextLayer: true,
      };
      const track = out.find((t) => t.id === tl.trackId);
      if (track) {
        track.items.push(item);
      } else {
        out.push({
          id: `text-row-${tl.trackId}`, kind: "text", name: "Text",
          locked: false, muted: false, hidden: false, items: [item],
        });
      }
    }
    // Keep clips ordered for neighbour calculations.
    for (const t of out) {
      t.items.sort((a, b) => a.start - b.start);
    }
    return out;
  }

  function computeContentSec(): number {
    let max = 0;
    for (const t of rows) {
      for (const it of t.items) max = Math.max(max, it.start + it.duration);
    }
    max = Math.max(max, playheadSec);
    return Math.max(30, Math.ceil(max + 5));
  }

  function neighbours(track: RowTrack, item: RowItem): {
    prevEnd: number; nextStart: number;
  } {
    let prevEnd = 0;
    let nextStart = Number.POSITIVE_INFINITY;
    for (const o of track.items) {
      if (o.id === item.id) continue;
      if (o.start + o.duration <= item.start + 1e-9) {
        prevEnd = Math.max(prevEnd, o.start + o.duration);
      } else if (o.start >= item.start + item.duration - 1e-9) {
        nextStart = Math.min(nextStart, o.start);
      }
    }
    return { prevEnd, nextStart };
  }

  /* ---------------- rendering ---------------- */

  function render(): void {
    // Honest states first.
    if (!services) {
      root.replaceChildren(
        toolbar,
        emptyState({
          icon: "⇄",
          title: "Timeline unavailable",
          description: "The media engine has not been loaded in this session.",
          hint: NO_ENGINE_REASON,
        }),
      );
      setAddTrackAvailability();
      return;
    }
    if (loadError) {
      root.replaceChildren(
        toolbar,
        errorState({
          title: "Timeline failed to load",
          detail: loadError,
          retry: { label: "Try again", onClick: () => { loadError = null; refresh(); } },
        }),
      );
      setAddTrackAvailability();
      return;
    }
    if (!state) {
      root.replaceChildren(toolbar, scroll);
      canvas.replaceChildren(playheadEl, snaplineEl);
      canvas.append(el("div", { class: "rw-tl__placeholder faint" }, ["Loading project…"]));
      setAddTrackAvailability();
      return;
    }

    rows = buildRows(state);
    contentSec = computeContentSec();
    const contentPx = M.secToPx(contentSec, zoom);
    const headW = HEADER_W();

    const totalItems = rows.reduce((n, t) => n + t.items.length, 0);
    if (totalItems === 0) {
      root.replaceChildren(
        toolbar,
        emptyState({
          icon: "⇄",
          title: "Timeline is empty",
          description: "Import media (⌘I), then drag it here from the media bin.",
          hint: "Clips you add appear as blocks you can drag, trim, and split.",
        }),
      );
      setAddTrackAvailability();
      return;
    }

    root.replaceChildren(toolbar, scroll);
    canvas.replaceChildren(playheadEl, snaplineEl);
    canvas.style.width = `${contentPx + headW}px`;

    // --- ruler row ---
    const corner = el("div", { class: "rw-tl__corner rw-tl__head",
      "aria-hidden": "true" });
    const ruler = el("div", { class: "rw-tl__ruler", "aria-hidden": "true" });
    const major = M.rulerStepSec(zoom);
    const minor = M.rulerMinorStepSec(major);
    for (let t = 0; t <= contentSec + 1e-6; t += minor) {
      const x = M.secToPx(t, zoom);
      const isMajor = Math.abs(t / major - Math.round(t / major)) < 1e-6;
      const tick = el("div", {
        class: `rw-tl__tick${isMajor ? " rw-tl__tick--major" : ""}`,
      });
      tick.style.left = `${x}px`;
      if (isMajor) {
        tick.append(el("span", { class: "rw-tl__tick-label" },
          [M.formatRulerLabel(t, major)]));
      }
      ruler.append(tick);
      if (x > contentPx + major * zoom) break;
    }
    ruler.addEventListener("pointerdown", (e) => startScrub(e));
    canvas.insertBefore(
      el("div", { class: "rw-tl__row rw-tl__row--ruler" }, [corner, ruler]),
      playheadEl,
    );

    // --- track rows ---
    for (const track of rows) {
      const head = trackHeader(track);
      const lane = el("div", {
        class: `rw-tl__lane rw-tl__lane--${track.kind}${track.locked ? " is-locked" : ""}`,
        "data-track": track.id,
      });
      lane.style.width = `${contentPx}px`;
      lane.addEventListener("pointerdown", (e) => {
        if (e.target === lane) {
          if (selection.size > 0) setSelection(new Set());
          startScrub(e, lane);
        }
      });

      for (const item of track.items) {
        lane.append(renderItem(track, item));
      }
      canvas.insertBefore(
        el("div", { class: "rw-tl__row", "data-track-row": track.id }, [head, lane]),
        playheadEl,
      );
    }

    positionPlayhead();
    setAddTrackAvailability();
    updateZoomUI();
  }

  function trackHeader(track: RowTrack): HTMLElement {
    const badges: Node[] = [];
    if (track.locked) {
      badges.push(el("span", { class: "rw-tl__badge", title: "Track locked — edits are rejected by the engine" }, ["🔒"]));
    }
    if (track.muted) {
      badges.push(el("span", { class: "rw-tl__badge", title: "Track muted" }, ["🔇"]));
    }
    if (track.hidden) {
      badges.push(el("span", { class: "rw-tl__badge", title: "Track hidden" }, ["👁‍🗨"]));
    }
    const name = el("span", { class: "rw-tl__head-name" }, [track.name]);
    const kindTag = el("span", { class: `rw-tl__head-kind rw-tl__head-kind--${track.kind}` },
      [track.kind]);
    return el("div", {
      class: "rw-tl__head rw-tl__head--track",
      role: "listitem",
      "aria-label": `${track.name} track, ${track.items.length} clips${track.locked ? ", locked" : ""}`,
    }, [el("span", { class: "rw-tl__head-top" }, [name, ...badges]), kindTag]);
  }

  function renderItem(track: RowTrack, item: RowItem): HTMLElement {
    const w = Math.max(6, M.secToPx(item.duration, zoom));
    const left = M.secToPx(item.start, zoom);
    const selected = selection.has(item.id);
    const clip = el("div", {
      class: `rw-tl__clip rw-tl__clip--${item.kind}${selected ? " is-selected" : ""}` +
        `${item.missing ? " is-missing" : ""}${track.locked ? " is-locked" : ""}`,
      "data-clip": item.id,
      "data-track": item.trackId,
      role: "button",
      tabindex: "-1",
      "aria-pressed": String(selected),
      "aria-label":
        `${item.kind} clip “${item.label}”, starts ${M.formatTimecode(item.start, fps())}, ` +
        `duration ${M.formatDuration(item.duration)}${item.missing ? ", file missing" : ""}`,
      title: item.missing
        ? `${item.label} — source file missing. Relink from the media bin.`
        : `${item.label} · ${M.formatDuration(item.duration)}`,
    });
    clip.style.left = `${left}px`;
    clip.style.width = `${w}px`;
    if (item.thumbUrl) {
      clip.style.backgroundImage = `url(${JSON.stringify(item.thumbUrl)})`;
    }

    const label = el("span", { class: "rw-tl__clip-label" },
      [item.missing ? `⚠ ${item.label}` : item.label]);
    clip.append(label);
    if (w > 56) {
      clip.append(el("span", { class: "rw-tl__clip-dur mono" },
        [M.formatDuration(item.duration)]));
    }

    const startEdge = el("div", { class: "rw-tl__clip-edge rw-tl__clip-edge--start",
      "data-edge": "start", "aria-hidden": "true" });
    const endEdge = el("div", { class: "rw-tl__clip-edge rw-tl__clip-edge--end",
      "data-edge": "end", "aria-hidden": "true" });
    clip.append(startEdge, endEdge);

    clip.addEventListener("pointerdown", (e) => startClipPointer(e, track, item, clip));
    clip.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.stopPropagation();
        setSelection(new Set([item.id]), `Selected “${item.label}”`);
      }
    });
    return clip;
  }

  /* ---------------- selection ---------------- */

  function setSelection(next: Set<string>, announceMsg?: string): void {
    selection = next;
    for (const node of canvas.querySelectorAll<HTMLElement>("[data-clip]")) {
      const on = selection.has(node.dataset.clip!);
      node.classList.toggle("is-selected", on);
      node.setAttribute("aria-pressed", String(on));
    }
    if (announceMsg) announce(announceMsg);
  }

  /* ---------------- scrub / seek ---------------- */

  function timeFromClientX(clientX: number, lane?: Element): number {
    const target = lane ?? canvas.querySelector(".rw-tl__ruler");
    if (!target) return 0;
    const rect = target.getBoundingClientRect();
    return Math.max(0, M.pxToSec(clientX - rect.left, zoom));
  }

  function seek(sec: number, doAnnounce = false): void {
    playheadSec = Math.max(0, sec);
    positionPlayhead();
    updateTimecode();
    if (services) {
      try { services.seek(M.roundToFrame(playheadSec, fps())); } catch { /* bridge hiccup */ }
    }
    if (doAnnounce) {
      announce(`Playhead at ${M.formatTimecode(playheadSec, fps())}`);
    }
  }

  function startScrub(e: PointerEvent, lane?: Element): void {
    if (e.button !== 0) return;
    e.preventDefault();
    const move = (ev: PointerEvent) => seek(timeFromClientX(ev.clientX, lane));
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    move(e);
  }

  function positionPlayhead(): void {
    playheadEl.style.left = `${M.secToPx(playheadSec, zoom)}px`;
  }

  function updateTimecode(): void {
    timecodeEl.textContent = M.formatTimecode(playheadSec, fps());
    durationEl.textContent = `/ ${M.formatTimecode(contentSec, fps())}`;
    timecodeEl.setAttribute("aria-label",
      `Playhead ${M.formatTimecode(playheadSec, fps())} of ${M.formatTimecode(contentSec, fps())}`);
  }

  /* ---------------- clip drag (move) ---------------- */

  function startClipPointer(
    e: PointerEvent, track: RowTrack, item: RowItem, clipEl: HTMLElement,
  ): void {
    if (e.button !== 0) return;
    const edge = (e.target as HTMLElement).closest<HTMLElement>("[data-edge]");
    if (edge && !track.locked) {
      startTrim(e, track, item, clipEl, edge.dataset.edge as "start" | "end");
      return;
    }
    e.preventDefault();
    e.stopPropagation();

    if (!selection.has(item.id)) {
      if (e.shiftKey) setSelection(new Set([...selection, item.id]));
      else setSelection(new Set([item.id]), `Selected “${item.label}”`);
    } else if (e.shiftKey) {
      const next = new Set(selection);
      next.delete(item.id);
      setSelection(next);
      return;
    }

    if (track.locked || !services) return;

    const startX = e.clientX;
    const originStart = item.start;
    let moved = false;
    let targetTrackId = track.id;
    let previewStart = originStart;

    const laneRects = () =>
      [...canvas.querySelectorAll<HTMLElement>(".rw-tl__lane")].map((n) => ({
        id: n.dataset.track!, node: n, rect: n.getBoundingClientRect(),
      }));

    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - startX;
      if (!moved && Math.abs(dx) < 3) return;
      moved = true;
      clipEl.classList.add("is-dragging");

      const proposed = Math.max(0, originStart + M.pxToSec(dx, zoom));
      const lanes = laneRects();
      const over = lanes.find(
        (l) => ev.clientY >= l.rect.top && ev.clientY <= l.rect.bottom);
      if (over) {
        targetTrackId = over.id;
        for (const l of lanes) l.node.classList.toggle("is-drop-target", l.id === over.id);
      }

      const candidates = M.collectSnapCandidates({
        clips: rows.flatMap((t) => t.items.map((i) =>
          ({ id: i.id, start: i.start, duration: i.duration }))),
        movingIds: selection,
        playheadSec,
      });
      const snap = M.snapClipStart({
        proposedStart: proposed,
        duration: item.duration,
        candidates,
        thresholdSec: 8 / zoom,
        fps: fps(),
        enabled: snapOn,
      });
      previewStart = snap.start;
      clipEl.style.left = `${M.secToPx(previewStart, zoom)}px`;
      if (snap.guide !== null) {
        snaplineEl.hidden = false;
        snaplineEl.style.left = `${M.secToPx(snap.guide, zoom)}px`;
      } else {
        snaplineEl.hidden = true;
      }
    };

    const up = async () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      snaplineEl.hidden = true;
      clipEl.classList.remove("is-dragging");
      for (const n of canvas.querySelectorAll(".rw-tl__lane.is-drop-target")) {
        n.classList.remove("is-drop-target");
      }
      if (!moved) return;
      const targetTrack = rows.find((t) => t.id === targetTrackId);
      const committed = M.roundToFrame(previewStart, fps());
      try {
        if (item.isTextLayer) {
          await services.updateTextLayer(item.id, { startSec: committed });
        } else if (targetTrackId !== item.trackId && targetTrack?.locked) {
          announce("Target track is locked — clip stayed on its track.");
        } else {
          await services.moveClip(item.id, targetTrackId, committed);
        }
      } catch (err) {
        notify("error", "Could not move clip", { detail: String(err) });
      }
      refresh();
    };

    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  }

  /* ---------------- trim drag ---------------- */

  function startTrim(
    e: PointerEvent, track: RowTrack, item: RowItem,
    clipEl: HTMLElement, edge: "start" | "end",
  ): void {
    const startX = e.clientX;
    const originStart = item.start;
    const originEnd = item.start + item.duration;
    const { prevEnd, nextStart } = neighbours(track, item);
    let preview = { start: originStart, duration: item.duration };
    let moved = false;

    const move = (ev: PointerEvent) => {
      const dt = M.pxToSec(ev.clientX - startX, zoom);
      if (!moved && Math.abs(ev.clientX - startX) < 3) return;
      moved = true;
      clipEl.classList.add("is-trimming");
      if (edge === "start") {
        preview = M.previewHeadTrim({
          start: originStart, duration: item.duration, deltaSec: dt,
          minStart: prevEnd, maxEnd: nextStart,
        });
        clipEl.style.left = `${M.secToPx(preview.start, zoom)}px`;
        clipEl.style.width = `${M.secToPx(preview.duration, zoom)}px`;
      } else {
        preview = M.previewTrim({
          start: originStart, duration: item.duration, deltaSec: dt,
          minStart: prevEnd, maxEnd: nextStart,
        });
        // previewTrim clamps against maxEnd for duration only
        const newEnd = Math.min(originEnd + dt, nextStart);
        preview = {
          start: originStart,
          duration: Math.max(M.MIN_CLIP_SEC, newEnd - originStart),
        };
        clipEl.style.width = `${M.secToPx(preview.duration, zoom)}px`;
      }
      const guideTime = edge === "start" ? preview.start : preview.start + preview.duration;
      if (snapOn) {
        const snap = M.snapClipStart({
          proposedStart: edge === "start" ? preview.start : preview.start,
          duration: edge === "start" ? preview.duration : preview.duration,
          candidates: M.collectSnapCandidates({
            clips: rows.flatMap((t) => t.items.map((i) =>
              ({ id: i.id, start: i.start, duration: i.duration }))),
            movingIds: new Set([item.id]),
            playheadSec,
          }),
          thresholdSec: 8 / zoom,
          fps: fps(),
          enabled: true,
        });
        void guideTime;
        if (snap.guide !== null) {
          snaplineEl.hidden = false;
          snaplineEl.style.left = `${M.secToPx(snap.guide, zoom)}px`;
        } else {
          snaplineEl.hidden = true;
        }
      }
    };

    const up = async () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      snaplineEl.hidden = true;
      clipEl.classList.remove("is-trimming");
      if (!moved) return;
      const edgeTime = M.roundToFrame(
        edge === "start" ? preview.start : preview.start + preview.duration, fps());
      try {
        const svc = services;
        if (!svc) return;
        if (item.isTextLayer) {
          await svc.updateTextLayer(item.id, edge === "start"
            ? { startSec: edgeTime, durationSec: Math.max(0.1, preview.duration) }
            : { durationSec: Math.max(0.1, edgeTime - preview.start) });
        } else {
          await svc.trimClip(item.id, edge, edgeTime);
        }
      } catch (err) {
        notify("error", "Could not trim clip", { detail: String(err) });
      }
      refresh();
    };

    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  }

  /* ---------------- zoom ---------------- */

  function setZoom(next: number, anchorClientX: number | null): void {
    const zoomBefore = zoom;
    zoom = M.clampZoom(next);
    if (zoom === zoomBefore) return;
    if (anchorClientX !== null) {
      // keep the time under the cursor at the same viewport x
      const rect = canvas.getBoundingClientRect();
      const xBefore = anchorClientX - rect.left;
      const t = M.pxToSec(xBefore, zoomBefore);
      render();
      const xAfter = M.secToPx(t, zoom);
      scroll.scrollLeft += xAfter - xBefore;
    } else {
      render();
    }
    updateZoomUI();
  }

  function zoomBy(factor: number): void {
    const rect = scroll.getBoundingClientRect();
    setZoom(zoom * factor, rect.left + rect.width / 2);
  }

  function zoomFit(): void {
    if (!state) return;
    const maxEnd = rows.reduce(
      (acc, t) => Math.max(acc, ...t.items.map((i) => i.start + i.duration), 0), 0);
    if (maxEnd <= 0) return;
    const usable = Math.max(120, scroll.clientWidth - HEADER_W() - 24);
    setZoom(M.clampZoom(usable / maxEnd), null);
    scroll.scrollLeft = 0;
    announce(`Zoomed to fit ${M.formatDuration(maxEnd)}`);
  }

  function updateZoomUI(): void {
    if (document.activeElement !== zoomSlider) {
      zoomSlider.value = String(Math.round(zoom));
    }
    zoomSlider.setAttribute("aria-valuetext", `${Math.round(zoom)} pixels per second`);
  }

  /* ---------------- tracks / engine actions ---------------- */

  function setAddTrackAvailability(): void {
    const can = typeof (services as unknown as Record<string, unknown>)?.addTrack === "function";
    if (can) {
      addTrackBtn.removeAttribute("aria-disabled");
      addTrackBtn.removeAttribute("title");
      addTrackBtn.disabled = false;
    } else {
      disableWithReason(addTrackBtn,
        "Add track arrives when the engine bridge exposes timeline.addTrack (contract v1).");
    }
  }

  async function addTrack(): Promise<void> {
    const fn = (services as unknown as Record<string, unknown> | null)?.addTrack;
    if (typeof fn !== "function" || !services) {
      notify("info",
        "Add track is unavailable until the engine bridge exposes timeline.addTrack.");
      return;
    }
    try {
      await (fn as (kind: string) => Promise<void>).call(services, "video");
      refresh();
    } catch (err) {
      notify("error", "Could not add track", { detail: String(err) });
    }
  }

  /* ---------------- refresh / events ---------------- */

  function refresh(): void {
    if (!services) { render(); return; }
    try {
      state = services.getState();
      loadError = null;
    } catch (err) {
      state = null;
      loadError = String(err);
    }
    render();
    updateTimecode();
  }

  if (services) {
    // "assets:changed" is requested in contract review note (services.ts mismatch)
    // but is not yet part of EngineEvents, so it is intentionally omitted here
    // until the boundary adds it.
    for (const event of ["timeline:changed", "project:loaded",
      "import:completed"] as const) {
      try {
        unsubs.push(services.on(event, () => refresh()));
      } catch { /* event name not provided by this bridge */ }
    }
    try {
      unsubs.push(services.on("playhead:update", (p) => {
        playheadSec = p.timeSec;
        playing = p.playing;
        positionPlayhead();
        updateTimecode();
      }));
    } catch { /* optional event */ }
    refresh();
  } else {
    render();
  }

  /* ---------------- wheel: scroll + zoom at cursor ---------------- */

  scroll.addEventListener("wheel", (e) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      const factor = e.deltaY < 0 ? 1.2 : 1 / 1.2;
      setZoom(zoom * factor, e.clientX);
    }
  }, { passive: false });

  /* ---------------- keyboard: timeline-scoped actions ---------------- */

  const handledActions = new Set<KeyboardActionId>([
    "playback.toggle", "playback.jumpStart", "playback.jumpEnd",
    "playback.frameBack", "playback.frameFwd",
    "playback.nextEdit", "playback.prevEdit",
    "edit.split", "edit.delete", "edit.duplicate", "edit.selectAll",
    "edit.trimStart", "edit.trimEnd",
    "timeline.zoomIn", "timeline.zoomOut", "timeline.zoomFit",
    "timeline.snapToggle", "timeline.addTrack",
  ]);

  function onKeyCapture(e: KeyboardEvent): void {
    if (!root.isConnected) return;
    const target = e.target as HTMLElement | null;
    const inTextInput = !!target && (
      target.isContentEditable ||
      ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));
    const action = resolveEvent(e, platform, { inTextInput });
    if (!action || !handledActions.has(action.id)) return;
    if (handleAction(action.id)) {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
    }
  }
  window.addEventListener("keydown", onKeyCapture, true);

  function editPoints(): number[] {
    const pts = new Set<number>([0]);
    for (const t of rows) {
      for (const i of t.items) {
        pts.add(M.roundToFrame(i.start, fps()));
        pts.add(M.roundToFrame(i.start + i.duration, fps()));
      }
    }
    return [...pts].sort((a, b) => a - b);
  }

  function selectedItems(): Array<{ track: RowTrack; item: RowItem }> {
    const out: Array<{ track: RowTrack; item: RowItem }> = [];
    for (const t of rows) {
      for (const i of t.items) {
        if (selection.has(i.id)) out.push({ track: t, item: i });
      }
    }
    return out;
  }

  function handleAction(id: KeyboardActionId): boolean {
    if (!services) return false; // let the shell explain the engine is absent
    const fd = M.frameDurationSec(fps());

    switch (id) {
      case "playback.toggle":
        try {
          if (playing) services.pause(); else services.play();
          playing = !playing;
          announce(playing ? "Playing" : "Paused");
        } catch { return false; }
        return true;
      case "playback.jumpStart":
        seek(0, true); return true;
      case "playback.jumpEnd":
        seek(Math.max(0, contentSec - 1), true); return true;
      case "playback.frameBack":
        seek(Math.max(0, playheadSec - fd), true); return true;
      case "playback.frameFwd":
        seek(playheadSec + fd, true); return true;
      case "playback.prevEdit": {
        const pts = editPoints();
        const prev = [...pts].reverse().find((p) => p < playheadSec - 1e-6);
        if (prev !== undefined) { seek(prev, true); return true; }
        return true;
      }
      case "playback.nextEdit": {
        const pts = editPoints();
        const next = pts.find((p) => p > playheadSec + 1e-6);
        if (next !== undefined) seek(next, true);
        else seek(contentSec, true);
        return true;
      }

      case "edit.split": {
        const at = M.roundToFrame(playheadSec, fps());
        let targets = selectedItems()
          .map((s) => s.item)
          .filter((i) => !i.isTextLayer && i.start < at && i.start + i.duration > at);
        if (targets.length === 0) {
          // no valid selection under playhead → split whatever straddles it
          targets = rows.flatMap((t) => t.items)
            .filter((i) => !i.isTextLayer && i.start < at && i.start + i.duration > at);
        }
        if (targets.length === 0) {
          announce("Nothing to split at the playhead.");
          return true;
        }
        void (async () => {
          let done = 0;
          for (const t of targets) {
            try {
              await services!.splitClip(t.id, at);
              done++;
            } catch (err) {
              notify("error", `Could not split “${t.label}”`, { detail: String(err) });
            }
          }
          if (done > 0) announce(`Split ${done} clip${done > 1 ? "s" : ""} at ${M.formatTimecode(at, fps())}`);
          refresh();
        })();
        return true;
      }

      case "edit.delete": {
        const targets = selectedItems();
        if (targets.length === 0) return true;
        void (async () => {
          try {
            await services!.removeClips(targets.map((t) => t.item.id));
            announce(`Deleted ${targets.length} clip${targets.length > 1 ? "s" : ""}`);
          } catch (err) {
            notify("error", "Could not delete", { detail: String(err) });
          }
          selection = new Set();
          refresh();
        })();
        return true;
      }

      case "edit.duplicate": {
        const targets = selectedItems();
        if (targets.length === 0) return true;
        void (async () => {
          let done = 0;
          for (const t of targets) {
            try {
              if (t.item.isTextLayer) {
                await services!.addTextLayer({
                  text: t.item.label,
                  startSec: t.item.start + t.item.duration,
                  durationSec: t.item.duration,
                });
              } else {
                await services!.duplicateClip(t.item.id);
              }
              done++;
            } catch (err) {
              notify("error", "Could not duplicate", { detail: String(err) });
            }
          }
          if (done) announce(`Duplicated ${done} item${done > 1 ? "s" : ""}`);
          refresh();
        })();
        return true;
      }

      case "edit.selectAll": {
        const all = new Set(rows.flatMap((t) => t.items.map((i) => i.id)));
        setSelection(all, `Selected ${all.size} clips`);
        return true;
      }

      case "edit.trimStart":
      case "edit.trimEnd": {
        const edge = id === "edit.trimStart" ? "start" : "end";
        const targets = selectedItems();
        if (targets.length === 0) return true;
        const at = M.roundToFrame(playheadSec, fps());
        void (async () => {
          for (const t of targets) {
            const valid = edge === "start"
              ? at > t.item.start && at < t.item.start + t.item.duration - M.MIN_CLIP_SEC
              : at < t.item.start + t.item.duration && at > t.item.start + M.MIN_CLIP_SEC;
            if (!valid) continue;
            try {
              if (t.item.isTextLayer) {
                await services!.updateTextLayer(t.item.id, edge === "start"
                  ? { startSec: at, durationSec: t.item.start + t.item.duration - at }
                  : { durationSec: at - t.item.start });
              } else {
                await services!.trimClip(t.item.id, edge, at);
              }
            } catch (err) {
              notify("error", "Could not trim", { detail: String(err) });
            }
          }
          announce(`Trimmed ${edge === "start" ? "start" : "end"} to playhead`);
          refresh();
        })();
        return true;
      }

      case "timeline.zoomIn": zoomBy(1.35); return true;
      case "timeline.zoomOut": zoomBy(1 / 1.35); return true;
      case "timeline.zoomFit": zoomFit(); return true;
      case "timeline.snapToggle":
        snapOn = !snapOn;
        snapBtn.setAttribute("aria-pressed", String(snapOn));
        snapBtn.classList.toggle("is-on", snapOn);
        announce(snapOn ? "Snapping on" : "Snapping off");
        return true;
      case "timeline.addTrack":
        void addTrack();
        return true;
      default:
        return false;
    }
  }

  /* ---------------- lifecycle ---------------- */

  return {
    root,
    setProjectState(s) {
      state = s;
      loadError = null;
      render();
      updateTimecode();
    },
    setPlayhead(sec, isPlaying) {
      playheadSec = Math.max(0, sec);
      if (isPlaying !== undefined) playing = isPlaying;
      positionPlayhead();
      updateTimecode();
    },
    handleAction,
    focus() {
      scroll.focus({ preventScroll: true });
    },
    destroy() {
      window.removeEventListener("keydown", onKeyCapture, true);
      for (const u of unsubs) {
        try { u(); } catch { /* already gone */ }
      }
      root.replaceChildren();
    },
  };
}

/**
 * Convenience mount: clears `host` and mounts a fresh timeline, returning the
 * view (caller must `destroy()` when unmounting). This is the seam for
 * `editor-view.ts` to integrate: `installTimeline(view.timelineHost)`.
 */
export function installTimeline(
  host: HTMLElement, opts: TimelineOptions = {},
): TimelineView {
  const view = createTimelineView(opts);
  host.replaceChildren(view.root);
  return view;
}
