/**
 * Shared empty / loading / error / progress state components.
 *
 * Pure DOM factories — no engine dependency, usable anywhere in the shell.
 * Rules (charter): states must be honest; never show a control that looks
 * functional but isn't — disable with an accurate reason instead.
 */

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | boolean | undefined> = {},
  children: Array<Node | string> | Node | string = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === false) continue;
    node.setAttribute(k, v === true ? "" : v);
  }
  const list = Array.isArray(children) ? children : [children];
  for (const c of list) node.append(c);
  return node;
}

export interface EmptyStateOptions {
  title: string;
  description?: string;
  /** Primary call-to-action. If the engine can't support it yet, omit it. */
  action?: { label: string; onClick: () => void };
  /** Secondary, non-functional hint — rendered as plain text, not a button. */
  hint?: string;
  icon?: string; // single glyph, original
}

/** A calm, informative empty state for panels with no content yet. */
export function emptyState(opts: EmptyStateOptions): HTMLElement {
  const children: Array<Node | string> = [];
  if (opts.icon) {
    children.push(el("div", { class: "rw-empty__icon", "aria-hidden": "true" }, opts.icon));
  }
  children.push(el("p", { class: "rw-empty__title" }, opts.title));
  if (opts.description) {
    children.push(el("p", { class: "rw-empty__desc dim" }, opts.description));
  }
  if (opts.action) {
    const btn = el("button", { class: "rw-btn rw-btn--primary", type: "button" }, opts.action.label);
    btn.addEventListener("click", opts.action.onClick);
    children.push(btn);
  }
  if (opts.hint) {
    children.push(el("p", { class: "rw-empty__hint faint" }, opts.hint));
  }
  return el("div", { class: "rw-empty", role: "status" }, children);
}

export interface LoadingStateOptions {
  label: string;
  /** 0..1 if determinate; omit for indeterminate */
  value?: number;
}

/** Spinner (or progress bar when `value` given) + accessible live label. */
export function loadingState(opts: LoadingStateOptions): HTMLElement {
  const bar = el("div", {
    class: opts.value === undefined ? "rw-spinner" : "rw-progress",
    role: "progressbar",
    "aria-label": opts.label,
    ...(opts.value !== undefined
      ? { "aria-valuemin": "0", "aria-valuemax": "100",
          "aria-valuenow": String(Math.round(opts.value * 100)) }
      : {}),
  });
  if (opts.value !== undefined) {
    bar.append(el("div", { class: "rw-progress__fill" },
      [document.createTextNode("")]));
    (bar.firstElementChild as HTMLElement).style.width =
      `${Math.max(0, Math.min(100, opts.value * 100))}%`;
  }
  return el("div", { class: "rw-loading" }, [
    bar,
    el("span", { class: "rw-loading__label dim" }, opts.label),
  ]);
}

export interface ErrorStateOptions {
  title: string;
  /** Technical detail collapsed behind a disclosure — kept out of the way. */
  detail?: string;
  retry?: { label: string; onClick: () => void };
  dismissible?: boolean;
  onDismiss?: () => void;
}

/** Inline error with optional retry. Errors are announced assertively. */
export function errorState(opts: ErrorStateOptions): HTMLElement {
  const children: Array<Node | string> = [
    el("div", { class: "rw-error__title" }, [el("strong", {}, opts.title)]),
  ];
  if (opts.detail) {
    const details = el("details", { class: "rw-error__detail" });
    details.append(el("summary", {}, "Details"),
      el("pre", { class: "mono" }, opts.detail));
    children.push(details);
  }
  const row = el("div", { class: "rw-error__actions" });
  if (opts.retry) {
    const btn = el("button", { class: "rw-btn", type: "button" }, opts.retry.label);
    btn.addEventListener("click", opts.retry.onClick);
    row.append(btn);
  }
  if (opts.dismissible && opts.onDismiss) {
    const btn = el("button", { class: "rw-btn rw-btn--ghost", type: "button" }, "Dismiss");
    btn.addEventListener("click", opts.onDismiss);
    row.append(btn);
  }
  if (row.childElementCount) children.push(row);

  return el("div", { class: "rw-error", role: "alert" }, children);
}

export interface ProgressHandle {
  root: HTMLElement;
  /** value 0..1 */
  set(value: number, label?: string): void;
  setIndeterminate(label?: string): void;
}

/**
 * Determinate progress bar with label + percentage — used by import and
 * export flows so progress always reflects the engine's real values.
 */
export function progressBar(label: string): ProgressHandle {
  const fill = el("div", { class: "rw-progress__fill" });
  const pct = el("span", { class: "rw-progress__pct mono" }, "0%");
  const labelText = el("span", { class: "rw-progress__label" }, label);
  const root = el("div", {
    class: "rw-progress rw-progress--determinate",
    role: "progressbar",
    "aria-valuemin": "0",
    "aria-valuemax": "100",
    "aria-valuenow": "0",
    "aria-label": label,
  }, [fill]);
  const header = el("div", { class: "rw-progress__header" }, [labelText, pct]);
  const wrapper = el("div", { class: "rw-progress-block" }, [header, root]);

  return {
    root: wrapper,
    set(value: number, label?: string) {
      const v = Math.max(0, Math.min(1, value));
      fill.style.width = `${v * 100}%`;
      pct.textContent = `${Math.round(v * 100)}%`;
      root.setAttribute("aria-valuenow", String(Math.round(v * 100)));
      root.classList.remove("rw-progress--indeterminate");
      if (label) labelText.textContent = label;
    },
    setIndeterminate(label?: string) {
      root.classList.add("rw-progress--indeterminate");
      pct.textContent = "…";
      root.removeAttribute("aria-valuenow");
      if (label) labelText.textContent = label;
    },
  };
}

/**
 * Toast-style transient messages (info/success/error), stacked bottom-right.
 * Errors persist until dismissed; info auto-dismisses.
 */
export function notify(
  kind: "info" | "success" | "error",
  message: string,
  opts: { timeoutMs?: number; detail?: string } = {},
): void {
  const host = ensureToastHost();
  const node = el("div", {
    class: `rw-toast rw-toast--${kind}`,
    role: kind === "error" ? "alert" : "status",
  }, [el("span", {}, message)]);
  if (opts.detail) {
    const d = el("details", { class: "rw-toast__detail" },
      [el("summary", {}, "Details"), el("pre", { class: "mono" }, opts.detail)]);
    node.append(d);
  }
  if (kind === "error") {
    const close = el("button", { class: "rw-toast__close", type: "button",
      "aria-label": "Dismiss" }, "×");
    close.addEventListener("click", () => node.remove());
    node.append(close);
  }
  host.append(node);
  const ttl = opts.timeoutMs ?? (kind === "success" ? 3200 : 5000);
  if (kind !== "error") {
    setTimeout(() => {
      node.classList.add("rw-toast--out");
      setTimeout(() => node.remove(), 200);
    }, ttl);
  }
}

function ensureToastHost(): HTMLElement {
  let host = document.getElementById("rw-toasts");
  if (!host) {
    host = el("div", { id: "rw-toasts", class: "rw-toasts" });
    document.body.append(host);
  }
  return host;
}
