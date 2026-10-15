/**
 * IPC bridge factory (Electron-agnostic).
 *
 * Agent 2 wires this in the Electron main process; the preload exposes it as
 * `window.ve` per docs/PROJECT_CONTRACT.md ("Engine ↔ UI boundary"):
 *
 *   // main.ts (Agent 2 owns this file)
 *   import { createEngine, createEngineDispatcher, toErrorShape } from '@ve/engine';
 *   const engine = createEngine();
 *   const dispatcher = createEngineDispatcher(engine);
 *   ipcMain.handle('ve:invoke', (_e, msg: { callId: string; method: string; params?: unknown[] }) =>
 *     dispatcher.dispatch(msg.method, msg.params ?? [])
 *       .then((value) => ({ callId: msg.callId, ok: true, value }))
 *       .catch((err) => ({ callId: msg.callId, ok: false, error: toErrorShape(err) })));
 *   engine.onAny?.(...) // or iterate dispatcher.subscribe to forward events:
 *   const unsubscribe = dispatcher.subscribe((event, payload) =>
 *     win.webContents.send('ve:event', { event, payload }));
 *
 *   // preload.ts (contextIsolation on)
 *   contextBridge.exposeInMainWorld('ve', {
 *     invoke: (method, params) => ipcRenderer.invoke('ve:invoke', { callId: crypto.randomUUID(), method, params }),
 *     on: (event, cb) => { const h = (_e, msg) => cb(msg.payload); ipcRenderer.on(`ve:event:${event}`...) },
 *   });
 *
 * The exact preload/main glue is Agent 2's; this file only guarantees:
 *  - dispatch(method, params) → Promise<value>, rejecting with EngineError
 *  - subscribe(cb) → unsubscribe, receiving every EngineEvent
 */

import type { EngineInstance } from '../engine.js';
import type { EngineEvents } from '../api.js';

export interface Dispatcher {
  dispatch(method: string, params?: unknown[]): Promise<unknown>;
  subscribe(cb: (event: keyof EngineEvents, payload: EngineEvents[keyof EngineEvents]) => void): () => void;
}

export function createEngineDispatcher(engine: EngineInstance): Dispatcher {
  const listeners = new Set<(event: keyof EngineEvents, payload: EngineEvents[keyof EngineEvents]) => void>();
  const eventNames: Array<keyof EngineEvents> = [
    'project:change', 'project:saved', 'assets:changed',
    'export:progress', 'export:done', 'export:error', 'export:cancelled',
  ];
  for (const name of eventNames) {
    engine.on(name, (payload) => {
      for (const cb of [...listeners]) {
        try {
          cb(name, payload as EngineEvents[keyof EngineEvents]);
        } catch {
          // listener failures must not break event fan-out
        }
      }
    });
  }
  return {
    dispatch(method: string, params: unknown[] = []): Promise<unknown> {
      return engine.dispatch(method, params);
    },
    subscribe(cb) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
  };
}
