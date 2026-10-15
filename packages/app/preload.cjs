/**
 * Electron preload — exposes the contract's `window.ve` bridge.
 * Contract: docs/PROJECT_CONTRACT.md → "Engine ↔ UI boundary".
 *
 *   invoke(method, params?) → Promise<value>   (ve:invoke request/response)
 *   on(event, cb) → unsubscribe                (ve:event channel)
 *
 * Transport matches @ve/engine's createEngineDispatcher: main wires
 * ipcMain.handle('ve:invoke', ...) to dispatcher(method, params), which
 * returns the value or throws an EngineErrorShape. Errors are rehydrated
 * into an Error carrying .code/.hint/.details for the UI's error states.
 *
 * Plain CommonJS (sandboxed preload restriction) — no build step on purpose.
 */
"use strict";

const { contextBridge, ipcRenderer } = require("electron");

const listeners = new Map(); // event -> Set<cb>

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
  async invoke(method, params) {
    if (typeof method !== "string" || !method.includes(".")) {
      throw new Error(`Invalid engine method path: ${String(method)}`);
    }
    // Envelope protocol (see main.ts): Electron drops custom properties on
    // thrown errors, so results/errors travel as plain data.
    const res = await ipcRenderer.invoke("ve:invoke", {
      callId: crypto.randomUUID(),
      method,
      params: params || [],
    });
    if (res && res.ok) return res.value;
    const shape = (res && res.error) || {};
    const err = new Error(shape.message || "Engine request failed");
    err.code = shape.code;
    err.hint = shape.hint;
    err.details = shape.details;
    throw err;
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

  // App-side native dialogs (contract review note #7 — engine stays headless).
  pickFiles(kind) {
    return ipcRenderer.invoke("ve:pickFiles", kind);
  },
  pickDirectory() {
    return ipcRenderer.invoke("ve:pickDirectory");
  },
  pickSavePath(defaultName, extensions) {
    return ipcRenderer.invoke("ve:pickSavePath", defaultName, extensions);
  },
});
