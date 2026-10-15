/**
 * Preview monitor.
 *
 * v1 playback model (contract review note #1, Designed):
 *  - The UI owns the playhead clock (rAF). The engine stores timeline data only.
 *  - Preview shows the **content under the playhead**: the topmost enabled
 *    video-track clip (video/image) with text clips rendered as an HTML
 *    overlay, or audio-only playback, or an honest empty state.
 *  - This is NOT a full multi-track composited preview; the monitor labels
 *    that limitation honestly (no implied feature parity).
 */

import { el, emptyState } from "../../states/states";
import {
  subscribe, getState, setPlayhead, setPlaying, programEndTicks,
} from "../../state.js";
import type { Asset, Clip, Ticks } from "../../ve.js";
import {
  TICKS_PER_SECOND, secFromTicks, ticksFromSec, formatTimecode, frameDurTicks,
} from "../../ve.js";
import { call, errorMessage } from "../../bridge.js";
import { notify } from "../../states/states";

interface ContentUnderPlayhead {
  base?: { clip: Clip; asset: Asset };
  texts: Array<{ clip: Clip; asset: Asset }>;
  audioOnly?: { clip: Clip; asset: Asset };
  /** count of visual (video/image) clips under playhead, across all tracks */
  visualLayers: number;
}

export interface PreviewMonitor {
  root: HTMLElement;
  destroy(): void;
}

export function createPreviewMonitor(): PreviewMonitor {
  const root = el("div", { class: "rw-preview" });

  const stage = el("div", { class: "rw-preview__stage", "aria-label": "Program preview" });
  const video = document.createElement("video");
  video.className = "rw-preview__video";
  video.playsInline = true;
  video.preload = "auto";
  const image = document.createElement("img");
  image.className = "rw-preview__image";
  image.alt = "";
  const textLayer = el("div", { class: "rw-preview__text", "aria-hidden": "true" });
  const emptyHost = el("div", { class: "rw-preview__empty" });
  stage.append(video, image, textLayer, emptyHost);

  const limitation = el("div", {
    class: "rw-preview__note faint",
    hidden: true as unknown as boolean,
  }, "Preview shows the top visual layer only — full multi-layer compositing in preview is planned.");

  const textWarning = el("div", {
    class: "rw-preview__note rw-preview__note--warn",
    hidden: true as unknown as boolean,
  }, "Text is visible in preview but cannot be burned into exports in this environment.");

  // ---- Transport ----
  const playBtn = el("button", {
    class: "rw-btn rw-btn--icon rw-btn--primary",
    type: "button",
    "aria-label": "Play or pause (Space)",
    title: "Play / pause (Space)",
  }, "▶");
  const toStartBtn = transportButton("⏮", "Go to start (Home)");
  const stepBackBtn = transportButton("◀", "Step one frame back (←)");
  const stepFwdBtn = transportButton("▶︎", "Step one frame forward (→)");
  const toEndBtn = transportButton("⏭", "Go to end (End)");
  const timecode = el("span", { class: "rw-preview__timecode mono", "aria-live": "off" }, "00:00:00:00 / 00:00:00:00");
  const volume = document.createElement("input");
  volume.type = "range";
  volume.min = "0";
  volume.max = "1";
  volume.step = "0.05";
  volume.value = "1";
  volume.className = "rw-preview__volume";
  volume.setAttribute("aria-label", "Preview volume");

  const transport = el("div", { class: "rw-preview__transport", role: "group",
    "aria-label": "Playback controls" }, [
    toStartBtn, stepBackBtn, playBtn, stepFwdBtn, toEndBtn, timecode,
    el("span", { class: "rw-preview__spacer" }),
    el("span", { class: "faint", "aria-hidden": "true" }, "🔊"), volume,
  ]);

  root.append(stage, limitation, textWarning, transport);

  /* ---------------- content resolution ---------------- */

  function contentAt(t: Ticks): ContentUnderPlayhead | null {
    const project = getState().state?.project;
    if (!project) return null;
    const assets = new Map(project.assets.map((a) => [a.id, a]));
    const out: ContentUnderPlayhead = { texts: [], visualLayers: 0 };
    let best: { clip: Clip; asset: Asset; trackIndex: number } | null = null;
    let audioBest: { clip: Clip; asset: Asset } | null = null;

    project.tracks.forEach((track, trackIndex) => {
      if (track.muted || track.hidden) return;
      for (const clip of track.clips) {
        if (!clip.enabled) continue;
        if (t < clip.start || t >= clip.start + clip.duration) continue;
        const asset = assets.get(clip.assetId);
        if (!asset) continue;
        if (asset.kind === "text" || clip.text) {
          out.texts.push({ clip, asset });
        } else if (asset.kind === "video" || asset.kind === "image") {
          out.visualLayers += 1;
          // later track index renders on top (contract: array order = stacking)
          if (!best || trackIndex >= best.trackIndex) best = { clip, asset, trackIndex };
        } else if (asset.kind === "audio" && !audioBest) {
          audioBest = { clip, asset };
        }
      }
    });

    if (best) {
      out.base = { clip: (best as { clip: Clip }).clip, asset: (best as { asset: Asset }).asset };
    } else if (audioBest) {
      out.audioOnly = { clip: (audioBest as { clip: Clip }).clip, asset: (audioBest as { asset: Asset }).asset };
    } else if (out.texts.length > 0) {
      return out;
    } else {
      return null;
    }
    return out;
  }

  function localUrl(asset: Asset): string {
    // Desktop: absolute path → file URL. encodeURI leaves `#`, `?` and `%`
    // unescaped — a file named "Clip #1.mp4" would parse `#1.mp4` as a URL
    // fragment and fail to load. Encode each path segment instead (also
    // handles spaces and non-ASCII names correctly).
    const encoded = asset.source.path
      .split("/")
      .map((seg) => encodeURIComponent(seg))
      .join("/");
    return "file://" + encoded;
  }

  let currentBaseId: string | null = null;

  function applyContent(t: Ticks): void {
    const content = contentAt(t);
    const hasProject = getState().state?.project != null;
    const programEnd = programEndTicks();

    // base layer
    if (content?.base) {
      const { clip, asset } = content.base;
      const key = `${clip.id}:${asset.source.path}`;
      emptyHost.replaceChildren();
      emptyHost.hidden = true as unknown as boolean;

      if (asset.kind === "video") {
        image.hidden = true as unknown as boolean;
        video.hidden = false as unknown as boolean;
        if (currentBaseId !== key) {
          currentBaseId = key;
          video.src = localUrl(asset);
        }
      } else {
        video.hidden = true as unknown as boolean;
        video.pause();
        image.hidden = false as unknown as boolean;
        if (currentBaseId !== key) {
          currentBaseId = key;
          image.src = localUrl(asset);
        }
      }
    } else {
      video.hidden = true as unknown as boolean;
      video.pause();
      image.hidden = true as unknown as boolean;
      currentBaseId = null;
      emptyHost.hidden = false as unknown as boolean;
      if (emptyHost.childElementCount === 0) {
        emptyHost.append(
          hasProject && programEnd > 0
            ? emptyState({
                icon: "▶",
                title: "Nothing at the playhead",
                description: "Move the playhead over a clip, or drag media from the bin onto the timeline.",
              })
            : emptyState({
                icon: "▶",
                title: "Nothing to preview",
                description: hasProject
                  ? "Import media and place clips on the timeline."
                  : "Open a project to start previewing.",
              }),
        );
      }
    }

    // audio-only
    if (content?.audioOnly && !content.base) {
      const key = `audio:${content.audioOnly.clip.id}:${content.audioOnly.asset.source.path}`;
      if (currentBaseId !== key) {
        currentBaseId = key;
        video.hidden = false as unknown as boolean;
        video.src = localUrl(content.audioOnly.asset);
      }
    }

    // text overlay
    textLayer.replaceChildren();
    for (const { clip } of content?.texts ?? []) {
      const tc = clip.text;
      if (!tc) continue;
      const span = el("span", {
        class: "rw-preview__text-item",
        style: textStyleString(clip),
      }, tc.text);
      textLayer.append(span);
    }
    textLayer.hidden = (content?.texts.length ?? 0) === 0;

    // honest limitation chips
    limitation.hidden = !((content?.visualLayers ?? 0) > 1);
    const projectHasText = (getState().state?.project?.assets ?? []).some((a) => a.kind === "text");
    textWarning.hidden = !projectHasText || !getState().state;
  }

  function textStyleString(clip: Clip): string {
    const tc = clip.text;
    const xf = clip.transform;
    if (!tc) return "";
    const s = tc.style;
    const lines = [
      `font-family:${JSON.stringify(s.fontFamily).slice(1, -1)}, sans-serif`,
      `font-size:${Math.max(10, s.fontSizePx * previewScale(clip))}px`,
      `color:${s.color}`,
      `font-weight:${s.bold ? "700" : "400"}`,
      `font-style:${s.italic ? "italic" : "normal"}`,
      `text-align:${s.align}`,
      `line-height:${s.lineHeight}`,
      `opacity:${xf ? String(xf.opacity) : "1"}`,
      `transform:translate(-50%, -50%) translate(${xf ? xf.x : 0}px, ${xf ? xf.y : 0}px)`,
      `white-space:pre-wrap`,
      `max-width:80%`,
    ];
    if (s.background) lines.push(`background:${s.background}`, `padding:0.15em 0.4em`, `border-radius:0.12em`);
    return lines.join(";");
  }

  /** Scale authored font size from program resolution down to the stage. */
  function previewScale(clip: Clip): number {
    const settings = getState().state?.project?.settings;
    if (!settings) return 1;
    const w = stage.clientWidth || 1;
    return w / settings.width;
  }

  /* ---------------- transport actions ---------------- */

  function frameStep(dir: 1 | -1): void {
    const fps = getState().state?.project?.settings.frameRate;
    const cur = getState().playhead;
    if (fps) {
      const frame = frameDurTicks(fps) * dir;
      setPlayhead(cur + frame, { snapToFrame: false });
    } else {
      setPlayhead(cur + dir * TICKS_PER_SECOND / 30);
    }
  }

  function togglePlay(): void {
    if (!getState().state?.project) return;
    const playing = getState().playing;
    if (!playing && getState().playhead >= programEndTicks()) {
      setPlayhead(0);
    }
    setPlaying(!playing);
  }

  playBtn.addEventListener("click", togglePlay);
  toStartBtn.addEventListener("click", () => { setPlaying(false); setPlayhead(0); });
  toEndBtn.addEventListener("click", () => { setPlaying(false); setPlayhead(programEndTicks()); });
  stepBackBtn.addEventListener("click", () => frameStep(-1));
  stepFwdBtn.addEventListener("click", () => frameStep(1));
  volume.addEventListener("input", () => {
    video.volume = Number(volume.value);
  });

  /** Exposed for the keyboard map (Space etc.). */
  (root as HTMLElement & { veTogglePlay?: () => void }).veTogglePlay = togglePlay;

  /* ---------------- clock ---------------- */

  let raf = 0;
  let last = 0;

  function tick(now: number): void {
    raf = requestAnimationFrame(tick);
    const s = getState();
    if (!last) last = now;
    const dt = (now - last) / 1000;
    last = now;
    if (!s.playing) return;

    const end = programEndTicks();
    const next = s.playhead + ticksFromSec(dt);
    if (next >= end) {
      setPlayhead(end, { snapToFrame: true });
      setPlaying(false);
      return;
    }
    setPlayhead(next);

    // media sync: keep the element playing the clip under the playhead
    const content = contentAt(s.playhead);
    const base = content?.base ?? content?.audioOnly;
    if (base) {
      const want = secFromTicks(base.clip.sourceIn + (s.playhead - base.clip.start));
      if (video.hidden || !video.src) {
        applyContent(s.playhead);
      }
      if (Math.abs(video.currentTime - want) > 0.25) {
        video.currentTime = want;
      }
      if (video.paused) {
        void video.play().catch((err) => {
          notify("error", "Preview playback failed", { detail: errorMessage(err).message });
          setPlaying(false);
        });
      }
    } else if (!video.hidden) {
      video.pause();
      applyContent(s.playhead);
    }
  }
  raf = requestAnimationFrame(tick);

  /* ---------------- render loop ---------------- */

  function render(): void {
    const s = getState();
    const fps = s.state?.project?.settings.frameRate;
    const total = programEndTicks();
    timecode.textContent = fps
      ? `${formatTimecode(s.playhead, fps)} / ${formatTimecode(total, fps)}`
      : `${secFromTicks(s.playhead).toFixed(2)}s / ${secFromTicks(total).toFixed(2)}s`;
    playBtn.textContent = s.playing ? "⏸" : "▶";
    playBtn.setAttribute("aria-label", s.playing ? "Pause (Space)" : "Play (Space)");

    applyContent(s.playhead);
  }

  const unsub = subscribe(render);
  render();

  return {
    root,
    destroy() {
      unsub();
      cancelAnimationFrame(raf);
      video.pause();
      video.removeAttribute("src");
    },
  };
}

function transportButton(glyph: string, label: string): HTMLElement {
  return el("button", {
    class: "rw-btn rw-btn--icon",
    type: "button",
    "aria-label": label,
    title: label,
  }, glyph);
}
