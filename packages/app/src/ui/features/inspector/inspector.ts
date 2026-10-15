/**
 * Inspector — property editor for the current selection.
 *
 * - No selection → project summary (honest default content)
 * - One clip → timing (read-only), enabled, audio (volume/fades/mute),
 *   transform (video/image/text), text editing (text clips), remove/duplicate
 * - Multiple clips → summary + bulk actions
 *
 * Every write goes through the engine (`timeline.updateClip` etc.).
 * Controls for features the engine cannot yet render are disabled WITH the
 * accurate reason (never fake-functional).
 */

import { el, emptyState, notify } from "../../states/states";
import { call, errorMessage, isDesktop } from "../../bridge.js";
import { subscribe, getState, selectedClips, assetById } from "../../state.js";
import type { Clip, Ticks } from "../../ve.js";
import { secFromTicks, ticksFromSec, formatTimecode, fsec } from "../../ve.js";

export interface Inspector {
  root: HTMLElement;
  destroy(): void;
}

export function createInspector(): Inspector {
  const root = el("div", { class: "rw-inspector" });
  const title = el("div", { class: "rw-panel__title" }, [el("span", {}, "Inspector")]);
  const body = el("div", { class: "rw-inspector__body" });
  root.append(title, body);

  function render(): void {
    const s = getState();
    body.replaceChildren();
    if (!s.state?.project) {
      body.append(emptyState({
        icon: "⚙",
        title: "No project open",
        description: "Open a project to see and edit clip properties.",
      }));
      return;
    }
    const sel = selectedClips();
    if (sel.length === 0) {
      body.append(projectSummary());
      return;
    }
    if (sel.length === 1) {
      body.append(clipEditor(sel[0].clip, sel[0].trackId));
      return;
    }
    body.append(multiEditor(sel.length));
  }

  /* ---------------- project summary ---------------- */

  function projectSummary(): HTMLElement {
    const project = getState().state!.project!;
    const wrap = el("div", { class: "rw-inspector__section" });
    wrap.append(el("h4", {}, "Project"));
    const rows: Array<[string, string]> = [
      ["Name", project.name],
      ["Resolution", `${project.settings.width}×${project.settings.height}`],
      ["Frame rate", `${(project.settings.frameRate.n / project.settings.frameRate.d).toFixed(3)} fps`],
      ["Sample rate", `${project.settings.sampleRate} Hz · ${project.settings.channels}ch`],
      ["Tracks", String(project.tracks.length)],
      ["Assets", String(project.assets.length)],
    ];
    const dl = el("dl", { class: "rw-kv" });
    for (const [k, v] of rows) {
      dl.append(el("dt", {}, k), el("dd", { class: "mono" }, v));
    }
    wrap.append(dl);
    wrap.append(el("p", { class: "faint" }, "Select a clip on the timeline to edit its properties."));
    return wrap;
  }

  /* ---------------- single clip ---------------- */

  function clipEditor(clip: Clip, trackId: string): HTMLElement {
    const wrap = el("div", {});
    const asset = assetById(clip.assetId);
    const kind = asset?.kind ?? "video";

    // ---- header ----
    const header = el("div", { class: "rw-inspector__section" }, [
      el("h4", {}, `${kindLabel(kind)} clip`),
      el("div", { class: "rw-inspector__asset mono faint", title: asset?.source.path ?? "" },
        asset?.name ?? "(missing asset)"),
    ]);
    if (asset && getState().missing.has(asset.id)) {
      header.append(
        el("p", { class: "rw-field__hint rw-field__hint--warn" },
          "Source file is missing — relink it from the media bin."),
      );
    }
    wrap.append(header);

    // ---- timing (read-only; edits happen in the timeline, honestly labeled) ----
    const fps = getState().state!.project!.settings.frameRate;
    const timing = section("Timing");
    const dl = el("dl", { class: "rw-kv" });
    const rows: Array<[string, string]> = [
      ["Start", formatTimecode(clip.start, fps)],
      ["Duration", formatTimecode(clip.duration, fps)],
      ["Source in", fsec(clip.sourceIn)],
    ];
    if (asset?.meta.durationTicks) {
      rows.push(["Asset length", fsec(asset.meta.durationTicks as Ticks)]);
    }
    for (const [k, v] of rows) dl.append(el("dt", {}, k), el("dd", { class: "mono" }, v));
    timing.append(dl);
    timing.append(el("p", { class: "faint" },
      "Timing is edited by dragging the clip or its edges in the timeline."));
    wrap.append(timing);

    // ---- enabled ----
    const gen = section("General");
    gen.append(checkbox("Enabled", clip.enabled, (v) => update(clip.id, { enabled: v })));
    if (kind === "video" || kind === "image") {
      const speedRow = el("div", { class: "rw-field" }, [
        el("span", { class: "rw-field__label" }, "Speed"),
        el("select", { class: "rw-select", disabled: true, title: SPEED_UNAVAILABLE },
          [el("option", {}, "1× (normal)")]),
        el("span", { class: "rw-field__hint rw-field__hint--warn" }, SPEED_UNAVAILABLE),
      ]);
      gen.append(speedRow);
    }
    wrap.append(gen);

    // ---- audio ----
    if (asset?.kind !== "image" && asset?.kind !== "text") {
      wrap.append(audioSection(clip));
    }

    // ---- transform ----
    if (kind === "video" || kind === "image" || kind === "text") {
      wrap.append(transformSection(clip));
    }

    // ---- text ----
    if (kind === "text" && clip.text) {
      wrap.append(textSection(clip));
    }

    // ---- danger zone ----
    const danger = section("Actions");
    const row = el("div", { class: "rw-inspector__row" });
    const dup = el("button", { class: "rw-btn", type: "button" }, "Duplicate");
    dup.addEventListener("click", () => void act(() => call("timeline.duplicateClip", [clip.id])));
    const rm = el("button", { class: "rw-btn rw-btn--danger", type: "button" }, "Remove");
    rm.addEventListener("click", () => void act(() => call("timeline.removeClip", [clip.id])));
    row.append(dup, rm);
    danger.append(row);
    wrap.append(danger);

    return wrap;
  }

  const SPEED_UNAVAILABLE =
    "Speed changes are not yet rendered by the export engine (contract v1 rejects speed ≠ 1).";
  const KEYFRAME_NOTE = "Keyframes are stored by the project model but not yet evaluated — controls come later.";

  /* ---------------- sections ---------------- */

  function section(name: string): HTMLElement {
    return el("div", { class: "rw-inspector__section" }, [el("h4", {}, name)]);
  }

  function field(label: string, input: HTMLElement, hint?: string, warn?: boolean): HTMLElement {
    const f = el("div", { class: "rw-field" }, [
      el("span", { class: "rw-field__label" }, label),
      input,
    ]);
    if (hint) f.append(el("span", { class: `rw-field__hint${warn ? " rw-field__hint--warn" : ""}` }, hint));
    return f;
  }

  function numberInput(
    value: number, min: number, max: number, step: number,
    commit: (v: number) => void,
  ): HTMLInputElement {
    const input = document.createElement("input");
    input.type = "number";
    input.className = "rw-input";
    input.value = String(value);
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    input.addEventListener("change", () => {
      const v = Number(input.value);
      if (Number.isFinite(v)) commit(Math.max(min, Math.min(max, v)));
    });
    return input;
  }

  function checkbox(label: string, value: boolean, commit: (v: boolean) => void): HTMLElement {
    const id = `cb-${Math.random().toString(36).slice(2, 8)}`;
    const input = document.createElement("input");
    input.type = "checkbox";
    input.id = id;
    input.checked = value;
    input.addEventListener("change", () => commit(input.checked));
    return el("div", { class: "rw-field rw-field--inline" }, [
      input, el("label", { for: id }, label),
    ]);
  }

  function audioSection(clip: Clip): HTMLElement {
    const s = section("Audio");
    const a = clip.audio;
    s.append(
      field("Volume", rangeInput(a.volume, 0, 2, 0.05, (v) => patchAudio(clip.id, { volume: v }),
        (v) => `${Math.round(20 * Math.log10(Math.max(v, 0.0001)))} dB`)),
      field("Fade in (s)", numberInput(secFromTicks(a.fadeIn), 0, 60, 0.1,
        (v) => patchAudio(clip.id, { fadeIn: ticksFromSec(v) }))),
      field("Fade out (s)", numberInput(secFromTicks(a.fadeOut), 0, 60, 0.1,
        (v) => patchAudio(clip.id, { fadeOut: ticksFromSec(v) }))),
      checkbox("Mute clip audio", a.muted, (v) => patchAudio(clip.id, { muted: v })),
    );
    const panWrap = rangeInput(a.pan, -1, 1, 0.05, () => {}, () => "");
    const pan = panWrap.querySelector("input") as HTMLInputElement | null;
    if (pan) {
      pan.disabled = true;
      pan.title = PAN_UNAVAILABLE;
    }
    s.append(field("Pan (L/R)", panWrap, PAN_UNAVAILABLE, true));
    return s;
  }

  const PAN_UNAVAILABLE =
    "Pan is not rendered by the export engine yet (contract v1 rejects pan ≠ 0).";

  function transformSection(clip: Clip): HTMLElement {
    const s = section("Transform");
    const t = clip.transform ?? { x: 0, y: 0, scale: 1, rotationDeg: 0, opacity: 1 };
    const patch = (p: Partial<typeof t>) =>
      void act(() => call("timeline.updateClip", [clip.id, { transform: { ...t, ...p } }]), { silent: true });
    s.append(
      field("X (px)", numberInput(t.x, -4000, 4000, 1, (v) => patch({ x: v }))),
      field("Y (px)", numberInput(t.y, -4000, 4000, 1, (v) => patch({ y: v }))),
      field("Scale", numberInput(t.scale, 0.01, 10, 0.01, (v) => patch({ scale: v }))),
      field("Rotation (°)", numberInput(t.rotationDeg, -360, 360, 1, (v) => patch({ rotationDeg: v })),
        "Rotation is stored in the project but not yet rendered on export.", true),
      field("Opacity", rangeInput(t.opacity, 0, 1, 0.01, (v) => patch({ opacity: v }),
        (v) => `${Math.round(v * 100)}%`)),
      el("p", { class: "faint rw-inspector__note" }, KEYFRAME_NOTE),
    );
    return s;
  }

  function textSection(clip: Clip): HTMLElement {
    const s = section("Text");
    const tc = clip.text!;
    const ta = document.createElement("textarea");
    ta.className = "rw-textarea";
    ta.rows = 4;
    ta.value = tc.text;
    let editing = false;
    ta.addEventListener("focus", () => {
      editing = true;
      void call("history.beginBatch").catch(() => {});
    });
    ta.addEventListener("input", () => {
      void call("timeline.updateClip", [clip.id, { text: { ...tc, text: ta.value } }]).catch(() => {});
    });
    ta.addEventListener("blur", () => {
      if (editing) {
        editing = false;
        void call("history.endBatch").catch(() => {});
      }
    });

    const size = numberInput(tc.style.fontSizePx, 8, 400, 1, (v) =>
      patchTextStyle(clip, { fontSizePx: v }));
    const color = colorInput(tc.style.color, (v) => patchTextStyle(clip, { color: v }));
    const bold = checkbox("Bold", tc.style.bold, (v) => patchTextStyle(clip, { bold: v }));
    const italic = checkbox("Italic", tc.style.italic, (v) => patchTextStyle(clip, { italic: v }));
    const alignSel = document.createElement("select");
    alignSel.className = "rw-select";
    for (const a of ["left", "center", "right"] as const) {
      const opt = document.createElement("option");
      opt.value = a;
      opt.textContent = a[0].toUpperCase() + a.slice(1);
      if (tc.style.align === a) opt.selected = true;
      alignSel.append(opt);
    }
    alignSel.addEventListener("change", () =>
      patchTextStyle(clip, { align: alignSel.value as "left" | "center" | "right" }));

    s.append(
      field("Text", ta),
      field("Font size (px)", size),
      field("Color", color),
      bold, italic,
      field("Align", alignSel),
    );
    return s;
  }

  function colorInput(value: string, commit: (v: string) => void): HTMLInputElement {
    const input = document.createElement("input");
    input.type = "color";
    input.className = "rw-input rw-input--color";
    input.value = /^#[0-9a-fA-F]{6}$/.test(value) ? value : "#ffffff";
    input.addEventListener("change", () => commit(input.value));
    return input;
  }

  function rangeInput(
    value: number, min: number, max: number, step: number,
    commit: (v: number) => void, display?: (v: number) => string,
  ): HTMLElement {
    const wrapEl = el("div", { class: "rw-range" });
    const input = document.createElement("input");
    input.type = "range";
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    input.value = String(value);
    input.className = "rw-range__slider";
    const label = el("span", { class: "rw-range__value mono" }, display ? display(value) : String(value));
    input.addEventListener("input", () => {
      const v = Number(input.value);
      label.textContent = display ? display(v) : String(v);
    });
    input.addEventListener("change", () => commit(Number(input.value)));
    wrapEl.append(input, label);
    return wrapEl;
  }

  function patchAudio(clipId: string, patch: Record<string, unknown>): void {
    void act(() => call("timeline.updateClip", [clipId, { audio: patch }]), { silent: true });
  }

  function patchTextStyle(clip: Clip, patch: Record<string, unknown>): void {
    const tc = clip.text;
    if (!tc) return;
    void act(
      () => call("timeline.updateClip", [clip.id, { text: { ...tc, style: { ...tc.style, ...patch } } }]),
      { silent: true },
    );
  }

  /* ---------------- multi selection ---------------- */

  function multiEditor(count: number): HTMLElement {
    const wrap = section(`${count} clips selected`);
    const row = el("div", { class: "rw-inspector__row" });
    const dup = el("button", { class: "rw-btn", type: "button" }, "Duplicate all");
    dup.addEventListener("click", () =>
      void act(async () => {
        for (const { clip } of selectedClips()) {
          await call("timeline.duplicateClip", [clip.id]);
        }
      }));
    const rm = el("button", { class: "rw-btn rw-btn--danger", type: "button" }, "Remove all");
    rm.addEventListener("click", () =>
      void act(async () => {
        for (const { clip } of selectedClips()) {
          await call("timeline.removeClip", [clip.id]);
        }
      }));
    row.append(dup, rm);
    wrap.append(row);
    return wrap;
  }

  /* ---------------- engine write helper ---------------- */

  async function update(clipId: string, patch: Record<string, unknown>): Promise<void> {
    await act(() => call("timeline.updateClip", [clipId, patch]), { silent: true });
  }

  async function act(fn: () => Promise<unknown>, opts: { silent?: boolean } = {}): Promise<void> {
    try {
      await fn();
    } catch (err) {
      const e = errorMessage(err);
      if (!opts.silent) notify("error", e.message, e.hint ? { detail: e.hint } : undefined);
      else notify("error", e.message, e.hint ? { detail: e.hint } : undefined);
    }
  }

  const unsub = subscribe(render);
  render();

  return {
    root,
    destroy() {
      unsub();
    },
  };
}

function kindLabel(kind: string): string {
  return kind === "text" ? "Text" : kind === "image" ? "Image" : kind === "audio" ? "Audio" : "Video";
}
