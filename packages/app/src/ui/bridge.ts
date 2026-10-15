/**
 * Bridge adapter — the ONLY place the UI touches `window.ve`.
 *
 * Contract: docs/PROJECT_CONTRACT.md → "Engine ↔ UI boundary".
 * Errors cross as EngineErrorShape ({ code, message, hint?, details? });
 * we rehydrate them into a typed error class so panels can branch on code.
 */

import type { VeBridge, EngineEvents } from "./ve.js";

/** App-side extras exposed by the preload (dialogs — contract review note #7). */
interface DesktopPickers {
  pickFiles(kind?: "media" | "any"): Promise<string[]>;
  pickDirectory(): Promise<string | null>;
  pickSavePath(defaultName: string, extensions?: string[]): Promise<string | null>;
}

declare global {
  interface Window {
    ve?: VeBridge & Partial<DesktopPickers>;
  }
}

export class EngineCallError extends Error {
  code: string;
  hint?: string;
  details?: unknown;
  constructor(code: string, message: string, hint?: string, details?: unknown) {
    super(message);
    this.name = "EngineCallError";
    this.code = code;
    this.hint = hint;
    this.details = details;
  }
}

export function bridge(): (VeBridge & Partial<DesktopPickers>) | null {
  return typeof window !== "undefined" && window.ve ? window.ve : null;
}

export function isDesktop(): boolean {
  return typeof bridge()?.pickFiles === "function";
}

/** Invoke an engine method; normalize failures to EngineCallError. */
export async function call<T>(method: string, params: unknown[] = []): Promise<T> {
  const b = bridge();
  if (!b) throw new EngineCallError("NOT_FOUND", "Engine is not connected.");
  try {
    return (await b.invoke<T>(method, params)) as T;
  } catch (err) {
    if (err instanceof EngineCallError) throw err;
    const e = err as Partial<EngineCallError> & { message?: string };
    throw new EngineCallError(
      typeof e.code === "string" ? e.code : "IO_ERROR",
      typeof e.message === "string" ? e.message : String(err),
      typeof e.hint === "string" ? e.hint : undefined,
      e.details,
    );
  }
}

/** Subscribe to an engine event; returns unsubscribe. No bridge → no-op. */
export function onEvent<K extends keyof EngineEvents>(
  event: K,
  cb: (payload: EngineEvents[K]) => void,
): () => void {
  return bridge()?.on(event, cb) ?? (() => {});
}

export async function pickMediaFiles(): Promise<string[]> {
  return (await bridge()?.pickFiles?.("media")) ?? [];
}

export async function pickProjectDirectory(): Promise<string | null> {
  return (await bridge()?.pickDirectory?.()) ?? null;
}

export async function pickSaveFile(
  defaultName: string,
  extensions?: string[],
): Promise<string | null> {
  return (await bridge()?.pickSavePath?.(defaultName, extensions)) ?? null;
}

/** Human message from any thrown value, including engine hints. */
export function errorMessage(err: unknown): { message: string; hint?: string; detail?: string } {
  if (err instanceof EngineCallError) {
    return {
      message: err.message,
      hint: err.hint,
      detail: err.details === undefined ? undefined : JSON.stringify(err.details, null, 2),
    };
  }
  if (err instanceof Error) return { message: err.message };
  return { message: String(err) };
}

/* ---------------- bridge presence (honest status) ---------------- */

export interface BridgeStatus {
  connected: boolean;
  reason: string;
}

const NOT_CONNECTED =
  "window.ve is not present. Run the desktop app (npm start -w @ve/app); "
  + "the browser preview only shows the interface shell.";

export function getBridgeStatus(): BridgeStatus {
  const b = bridge();
  if (!b) return { connected: false, reason: NOT_CONNECTED };
  if (typeof b.invoke !== "function" || typeof b.on !== "function") {
    return { connected: false, reason: "The engine bridge is present but incomplete." };
  }
  return { connected: true, reason: "" };
}

/**
 * Mark a control disabled with an honest reason (aria-disabled + title).
 * Charter rule: never let a control look functional when it isn't.
 */
export function disableWithReason(control: HTMLElement, reason: string): void {
  control.setAttribute("aria-disabled", "true");
  control.setAttribute("title", reason);
  if (control instanceof HTMLButtonElement) control.disabled = true;
}
