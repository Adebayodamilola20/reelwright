/**
 * Export dialog — settings form driven by `exportMedia.capabilities()`,
 * honest preflight (blocking reasons shown BEFORE starting), real progress
 * from `export:progress`, cancel via `exportMedia.cancel`.
 */

import { el, notify, progressBar, errorState, type ProgressHandle } from "../../states/states.js";
import { call, onEvent, pickSaveFile, errorMessage } from "../../bridge.js";
import { getState, programEndTicks } from "../../state.js";
import type { ExportCapabilities, ExportContainer } from "../../ve.js";

const VIDEO_CONTAINERS: ExportContainer[] = ["mp4", "mov", "mkv", "webm"];
const AUDIO_CONTAINERS: ExportContainer[] = ["mp3", "wav"];

const RESOLUTIONS: Array<{ label: string; w: number; h: number | null }> = [
  { label: "Match project", w: 0, h: null },
  { label: "1080p (1920×1080)", w: 1920, h: 1080 },
  { label: "720p (1280×720)", w: 1280, h: 720 },
  { label: "480p (854×480)", w: 854, h: 480 },
];

const FPS_PRESETS: Array<{ label: string; n: number; d: number }> = [
  { label: "Match project", n: 0, d: 1 },
  { label: "24 fps", n: 24, d: 1 },
  { label: "25 fps", n: 25, d: 1 },
  { label: "30 fps", n: 30, d: 1 },
  { label: "50 fps", n: 50, d: 1 },
  { label: "60 fps", n: 60, d: 1 },
];

let open = false;

export async function openExportDialog(): Promise<void> {
  if (open) return;
  const project = getState().state?.project;
  if (!project) {
    notify("info", "Open a project before exporting.");
    return;
  }
  open = true;

  const backdrop = el("div", { class: "rw-dialog-backdrop" });
  const dialog = el("div", {
    class: "rw-dialog",
    role: "dialog",
    "aria-modal": "true",
    "aria-label": "Export video",
  });

  const title = el("h2", {}, "Export");
  const closeBtn = el("button", { class: "rw-btn rw-btn--icon", type: "button",
    "aria-label": "Close export dialog" }, "×");
  const header = el("div", { class: "rw-dialog__header" }, [title, closeBtn]);
  dialog.append(header);

  const form = el("div", { class: "rw-export__form" });
  dialog.append(form);
  backdrop.append(dialog);
  document.body.append(backdrop);

  const opener = document.activeElement as HTMLElement | null;
  const prevOverflow = document.body.style.overflow;
  document.body.style.overflow = "hidden";

  function close(): void {
    open = false;
    unsubEvents();
    backdrop.remove();
    document.body.style.overflow = prevOverflow;
    window.removeEventListener("keydown", onKey, true);
    opener?.focus();
  }
  function onKey(e: KeyboardEvent): void {
    if (e.key === "Escape") {
      e.stopPropagation();
      close();
    }
  }
  window.addEventListener("keydown", onKey, true);
  closeBtn.addEventListener("click", close);
  backdrop.addEventListener("click", (e) => {
    if (e.target === backdrop) close();
  });

  /* ------------- load capabilities ------------- */

  let caps: ExportCapabilities;
  try {
    caps = await call<ExportCapabilities>("exportMedia.capabilities");
  } catch (err) {
    const e = errorMessage(err);
    form.append(errorState({
      title: "Export is unavailable",
      detail: `${e.message}${e.hint ? `\n${e.hint}` : ""}`,
      retry: { label: "Retry", onClick: () => { close(); void openExportDialog(); } },
      dismissible: true,
      onDismiss: close,
    }));
    return;
  }

  /* ------------- state ------------- */

  let container: ExportContainer = caps.containers.includes("mp4") ? "mp4" : caps.containers[0];
  let outputPath: string | null = null;
  let exporting = false;
  let currentExportId: string | null = null;

  /* ------------- form ------------- */

  // Output path
  const pathInput = document.createElement("input");
  pathInput.type = "text";
  pathInput.className = "rw-input";
  pathInput.placeholder = "Choose an output file…";
  pathInput.addEventListener("change", () => {
    outputPath = pathInput.value.trim() || null;
    refreshStart();
  });
  const browseBtn = el("button", { class: "rw-btn", type: "button" }, "Browse…");
  browseBtn.addEventListener("click", async () => {
    const name = `${project.name || "export"}.${containerExtension(container)}`;
    const picked = await pickSaveFile(name, [containerExtension(container)]);
    if (picked) {
      outputPath = picked;
      pathInput.value = picked;
      refreshStart();
    }
  });
  form.append(field("Output file", el("div", { class: "rw-export__path" }, [pathInput, browseBtn])));

  // Container
  const containerSel = select(
    caps.containers.map((c) => ({ value: c, label: containerLabel(c) })),
    container,
    (v) => {
      container = v as ExportContainer;
      refreshAudioVisibility();
      refreshStart();
    },
  );
  form.append(field("Format", containerSel));

  // Video section
  const videoWrap = el("div", {});
  const resSel = select(RESOLUTIONS.map((r) => ({ value: r.label, label: r.label })), RESOLUTIONS[0].label);
  const fpsSel = select(FPS_PRESETS.map((f) => ({ value: f.label, label: f.label })), FPS_PRESETS[0].label);
  const qualitySel = select(
    [{ value: "draft", label: "Draft (fast)" }, { value: "standard", label: "Standard" }, { value: "high", label: "High (slow)" }],
    "standard",
  );
  const videoCodecSel = select(
    caps.videoCodecs.map((c) => ({ value: c, label: c })),
    caps.videoCodecs.includes("h264") ? "h264" : (caps.videoCodecs[0] ?? "none"),
  );
  videoWrap.append(
    field("Video codec", videoCodecSel),
    field("Resolution", resSel),
    field("Frame rate", fpsSel),
    field("Quality", qualitySel),
  );
  form.append(videoWrap);

  // Audio section
  const audioWrap = el("div", {});
  const audioCodecSel = select(
    [{ value: "auto", label: "Automatic (from format)" }, ...caps.audioCodecs.map((c) => ({ value: c, label: c }))],
    "auto",
  );
  const audioBitrate = select(
    [{ value: "auto", label: "Automatic" }, { value: "128", label: "128 kbps" },
     { value: "192", label: "192 kbps" }, { value: "320", label: "320 kbps" }],
    "auto",
  );
  audioWrap.append(field("Audio codec", audioCodecSel), field("Audio bitrate", audioBitrate));
  form.append(audioWrap);

  function refreshAudioVisibility(): void {
    const isAudioOnly = AUDIO_CONTAINERS.includes(container);
    videoWrap.hidden = isAudioOnly;
    audioWrap.hidden = container === "wav";
  }
  refreshAudioVisibility();

  // Engine info (honesty chips)
  const info = el("div", { class: "rw-export__info faint" },
    `ffmpeg ${caps.ffmpegVersion} · ${caps.ffmpegPath}`);
  form.append(info);

  // Blocking preflight (text clips vs textBurnIn)
  const blockersHost = el("div", {});
  form.append(blockersHost);

  function currentBlockers(): string[] {
    const out: string[] = [];
    const p = getState().state?.project;
    if (!p) {
      out.push("No project is open.");
      return out;
    }
    const hasVideoTracks = p.tracks.some((t) => t.kind === "video" && t.clips.length > 0);
    const hasAudioTracks = p.tracks.some((t) => t.kind === "audio" && t.clips.length > 0);
    const isAudioOnly = AUDIO_CONTAINERS.includes(container);
    if (isAudioOnly ? !hasAudioTracks && !hasVideoTracks : !hasVideoTracks && !hasAudioTracks) {
      out.push("The timeline is empty — add clips before exporting.");
    }
    const hasText = p.assets.some((a) => a.kind === "text");
    if (hasText && !caps.textBurnIn) {
      out.push(
        "This project contains text clips. The local ffmpeg build cannot render text "
        + "(libfreetype is missing), so export would fail. Remove the text clips, or run on "
        + "an ffmpeg build with freetype support.",
      );
    }
    const hasKeyframes = p.tracks.some((t) => t.clips.some((c) => c.keyframes.length > 0));
    if (hasKeyframes) {
      out.push("This project contains keyframes, which the export engine does not render yet — remove them or wait for keyframe export support.");
    }
    const hasSpeed = p.tracks.some((t) => t.clips.some((c) => c.speed.n !== c.speed.d));
    if (hasSpeed) {
      out.push("This project contains speed changes, which the export engine does not render yet.");
    }
    return out;
  }

  function refreshBlockers(): string[] {
    const reasons = currentBlockers();
    blockersHost.replaceChildren();
    if (reasons.length > 0) {
      blockersHost.append(
        el("div", { class: "rw-error", role: "alert" },
          [el("div", { class: "rw-error__title" }, [el("strong", {}, "Export cannot start")]),
           el("ul", { class: "rw-export__blockers" }, reasons.map((r) => el("li", {}, r)))]),
      );
    }
    return reasons;
  }

  /* ------------- footer / progress ------------- */

  let progress: ProgressHandle | null = null;
  const statusHost = el("div", { class: "rw-export__status" });
  const startBtn = el("button", { class: "rw-btn rw-btn--primary", type: "button" }, "Start export");
  const cancelBtn = el("button", { class: "rw-btn rw-btn--danger", type: "button", hidden: true as unknown as boolean }, "Cancel export");
  const doneBtn = el("button", { class: "rw-btn", type: "button" }, "Close");
  doneBtn.addEventListener("click", close);
  const footer = el("div", { class: "rw-dialog__footer" }, [doneBtn, cancelBtn, startBtn]);
  dialog.append(statusHost, footer);

  function refreshStart(): void {
    const reasons = refreshBlockers();
    const ok = reasons.length === 0 && !!outputPath && !exporting;
    startBtn.disabled = !ok;
    // Second head fix: Browse was disabled in start() and never restored —
    // after any export finished/failed/cancelled it stayed dead for the rest
    // of the dialog session. Completion paths all call refreshStart().
    browseBtn.disabled = exporting;
    startBtn.title = !outputPath
      ? "Choose an output file first."
      : reasons.length > 0
        ? "See the list of blocking issues above."
        : "";
  }

  startBtn.addEventListener("click", () => void start());
  cancelBtn.addEventListener("click", () => {
    if (currentExportId) void call("exportMedia.cancel", [currentExportId]).catch(() => {});
  });

  async function start(): Promise<void> {
    if (!outputPath) return;
    exporting = true;
    startBtn.disabled = true;
    browseBtn.disabled = true;
    cancelBtn.hidden = false as unknown as boolean;

    const settings = buildSettings();
    progress = progressBar(`Exporting to ${outputPath}`);
    statusHost.replaceChildren(progress.root);
    progress.setIndeterminate("Starting export…");

    try {
      const { exportId } = await call<{ exportId: string }>("exportMedia.start", [settings]);
      currentExportId = exportId;
    } catch (err) {
      finishWithError(err);
    }
  }

  function buildSettings(): Record<string, unknown> {
    const s = getState().state?.project!.settings;
    const isAudioOnly = AUDIO_CONTAINERS.includes(container);
    const res = RESOLUTIONS.find((r) => r.label === resSel.value);
    const fps = FPS_PRESETS.find((f) => f.label === fpsSel.value);
    const width = res && res.w > 0 ? res.w : s?.width;
    const height = res && res.h ? res.h : s?.height;
    const videoCodec = videoCodecSel.value;

    const video = isAudioOnly || videoCodec === "none"
      ? null
      : {
          codec: videoCodec as "h264" | "prores" | "vp9",
          width,
          height,
          frameRate: fps && fps.n > 0 ? { n: fps.n, d: fps.d } : s?.frameRate,
          quality: qualitySel.value as "draft" | "standard" | "high",
        };

    const audioCodec = container === "wav" ? "pcm_s16le" : audioCodecSel.value === "auto" ? undefined : audioCodecSel.value;
    const audio = audioCodec === "none"
      ? null
      : {
          codec: (audioCodec ?? defaultAudioCodec(container)) as "aac" | "mp3" | "opus" | "pcm_s16le",
          bitrateKbps: audioBitrate.value === "auto" ? undefined : Number(audioBitrate.value),
        };

    return {
      outputPath: outputPath!,
      container,
      video,
      audio,
      range: { start: 0, end: programEndTicks() || undefined },
    };
  }

  function defaultAudioCodec(c: ExportContainer): string {
    if (c === "mp4" || c === "mov" || c === "mkv") return "aac";
    if (c === "webm") return "opus";
    if (c === "mp3") return "mp3";
    return "pcm_s16le";
  }

  /* ------------- events ------------- */

  const startWall = Date.now();
  const unsubEvents = (() => {
    const offs = [
      onEvent("export:progress", ({ exportId, percent }) => {
        if (exportId !== currentExportId || !progress) return;
        if (percent === null) {
          progress.setIndeterminate("Starting export…");
          return;
        }
        const pct = Math.max(0, Math.min(100, percent)) / 100;
        let label = `Exporting… ${Math.round(pct * 100)}%`;
        const elapsed = (Date.now() - startWall) / 1000;
        if (pct > 0.03) {
          const eta = Math.round((elapsed / pct) * (1 - pct));
          if (Number.isFinite(eta) && eta >= 0) label += ` · about ${fmtEta(eta)} left`;
        }
        progress.set(pct, label);
      }),
      onEvent("export:done", ({ exportId, outputPath: out }) => {
        if (exportId !== currentExportId) return;
        exporting = false;
        cancelBtn.hidden = true as unknown as boolean;
        progress?.set(1, "Export complete");
        statusHost.append(
          el("p", { class: "rw-export__done" }, [`Saved to `, el("span", { class: "mono" }, out)]),
        );
        notify("success", `Export complete — ${out}`);
        refreshStart();
      }),
      onEvent("export:error", ({ exportId, error }) => {
        if (exportId !== currentExportId) return;
        finishWithEngineError(error);
      }),
      onEvent("export:cancelled", ({ exportId }) => {
        if (exportId !== currentExportId) return;
        exporting = false;
        cancelBtn.hidden = true as unknown as boolean;
        statusHost.replaceChildren(
          el("p", { class: "dim" }, "Export cancelled. No output file was written."),
        );
        notify("info", "Export cancelled");
        refreshStart();
      }),
    ];
    return () => offs.forEach((off) => off());
  })();

  function finishWithError(err: unknown): void {
    const e = errorMessage(err);
    exporting = false;
    cancelBtn.hidden = true as unknown as boolean;
    statusHost.replaceChildren(errorState({
      title: "Export failed",
      detail: `${e.message}${e.hint ? `\n\n${e.hint}` : ""}${e.detail ? `\n\n${e.detail}` : ""}`,
    }));
    refreshStart();
  }

  function finishWithEngineError(error: { code: string; message: string; hint?: string; details?: unknown }): void {
    exporting = false;
    cancelBtn.hidden = true as unknown as boolean;
    statusHost.replaceChildren(errorState({
      title: `Export failed (${error.code})`,
      detail: `${error.message}${error.hint ? `\n\n${error.hint}` : ""}`,
    }));
    refreshStart();
  }

  refreshStart();
  startBtn.focus();
}

/* ---------------- small form helpers ---------------- */

function field(label: string, control: HTMLElement): HTMLElement {
  return el("div", { class: "rw-field" }, [
    el("span", { class: "rw-field__label" }, label),
    control,
  ]);
}

function select(
  options: Array<{ value: string; label: string }>,
  initial: string,
  onChange?: (v: string) => void,
): HTMLSelectElement {
  const s = document.createElement("select");
  s.className = "rw-select";
  for (const o of options) {
    const opt = document.createElement("option");
    opt.value = o.value;
    opt.textContent = o.label;
    if (o.value === initial) opt.selected = true;
    s.append(opt);
  }
  if (onChange) s.addEventListener("change", () => onChange(s.value));
  return s;
}

function containerLabel(c: ExportContainer): string {
  const map: Record<string, string> = {
    mp4: "MP4 (H.264 + AAC) — recommended",
    mov: "MOV (QuickTime)",
    mkv: "MKV (Matroska)",
    webm: "WebM (VP9 + Opus)",
    mp3: "MP3 (audio only)",
    wav: "WAV (audio only, lossless)",
  };
  return map[c] ?? c.toUpperCase();
}

function containerExtension(c: ExportContainer): string {
  return c;
}

function fmtEta(sec: number): string {
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  return `${m}m ${sec % 60}s`;
}
