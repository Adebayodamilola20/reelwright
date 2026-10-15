/**
 * Electron preload — exposes the contract's `window.ve` bridge.
 * Contract: docs/PROJECT_CONTRACT.md → "Engine ↔ UI boundary".
 *
 *   invoke(method, params?) → Promise<value>   (ve:invoke / ve:reply, callId correlation)
 *   on(event, cb) → unsubscribe                (ve:event channel)
 *
 * Plain CommonJS (sandboxed preload restriction) — no build step on purpose.
 */
"use strict";

const { contextBridge, ipcRenderer } = require("electron");

let seq = 0;
const pending = new Map(); // callId -> { resolve, reject }
const listeners = new Map(); // event -> Set<cb>

ipcRenderer.on("ve:reply", (_event, msg) => {
  if (!msg || typeof msg.callId !== "number") return;
  const entry = pending.get(msg.callId);
  if (!entry) return;
  pending.delete(msg.callId);
  if (msg.ok) {
    entry.resolve(msg.value);
  } else {
    const err = new Error(
      (msg.error && msg.error.message) || "Engine request failed",
    );
    if (msg.error) {
      err.code = msg.error.code;
      err.hint = msg.error.hint;
      err.details = msg.error.details;
    }
    entry.reject(err);
  }
});

ipcRenderer.on("ve:event", (_event, msg) => {
  if (!msg || typeof msg.event !== "string") return;
  const set = listeners.get(msg.event);
  if (!set) return;
  for (const cb of set) {
    try {
      cb(msg.payload);
    } catch (e) {
      console.error("[ve] event listener error", msg.event, e);
    }
  }
});

contextBridge.exposeInMainWorld("ve", {
  invoke(method, params) {
    return new Promise((resolve, reject) => {
      if (typeof method !== "string" || !method.includes(".")) {
        reject(new Error(`Invalid engine method path: ${String(method)}`));
        return;
      }
      const callId = ++seq;
      pending.set(callId, { resolve, reject });
      ipcRenderer.send("ve:invoke", { callId, method, params: params || [] });
    });
  },
  on(event, cb) {
    if (typeof event !== "string" || typeof cb !== "function") {
      return () => {};
    }
    let set = listeners.get(event);
    if (!set) {
      set = new Set();
      listeners.set(event, set);
    }
    set.add(cb);
    return () => {
      set.delete(cb);
    };
  },
});
