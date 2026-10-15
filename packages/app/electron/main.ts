/**
 * Electron main process (Agent 2's ownership area per contract §Module boundaries).
 *
 * Responsibilities:
 *  - create the BrowserWindow, load the renderer (vite dev server in dev, file in prod)
 *  - wire Agent 1's `createEngineDispatcher(engine)` to ipcMain (`ve:invoke`/`ve:reply`)
 *  - forward engine events on `ve:event`
 *  - native file dialogs (contract review note #7: dialogs are app-side; engine stays headless)
 *  - `--smoke` mode: verify the window + bridge, print JSON, exit (integration evidence)
 *
 * Engine construction is discovered dynamically: @ve/engine's factory name isn't
 * pinned in contract v1 yet (review note #11). If discovery fails, the app still
 * runs honestly WITHOUT window.ve — every engine control disables with a reason.
 */

import { app, BrowserWindow, ipcMain, dialog } from "electron";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isSmoke = process.argv.includes("--smoke");
const VITE_DEV_URL = process.env.VE_VITE_DEV_URL || "";

// NOTE (second head): JSDoc `@type` does not type `let` declarations in .ts
// files — these are explicit TS annotations now (F8).
let win: BrowserWindow | null = null;
let dispatch: ((method: string, params: unknown[]) => Promise<unknown>) | null = null;
let eventSubs: Array<{ event: string; off: () => void }> = [];

const ENGINE_EVENTS = [
  "project:change",
  "project:saved",
  "assets:changed",
  "export:progress",
  "export:done",
  "export:error",
  "export:cancelled",
];

function log(...args: unknown[]) {
  console.log("[main]", ...args);
}

/* ------------------------------------------------------------------ *
 * Engine bootstrap (defensive discovery; honest failure)
 * ------------------------------------------------------------------ */

async function bootstrapEngine() {
  try {
    // Variable specifier: resolved at runtime so this file typechecks even
    // before @ve/engine ships its build output.
    const spec = "@ve/engine";
    const mod = await import(spec);

    const factoryName = ["createEngine", "createEngineApi", "createDefaultEngine"].find(
      (n) => typeof mod[n] === "function",
    );
    if (!factoryName) {
      log(
        "engine factory not found in @ve/engine exports (looked for createEngine/createEngineApi/createDefaultEngine) — running without bridge",
      );
      return;
    }
    const engine = await mod[factoryName]({
      appDataDir: path.join(app.getPath("userData"), "ve-data"),
    });

    const dispatcherName = ["createEngineDispatcher", "createDispatcher"].find(
      (n) => typeof mod[n] === "function",
    );
    if (!dispatcherName) {
      log("createEngineDispatcher not exported yet — running without bridge");
      return;
    }
    dispatch = mod[dispatcherName](engine);

    const on = typeof engine.on === "function" ? engine.on.bind(engine) : null;
    if (on) {
      for (const name of ENGINE_EVENTS) {
        try {
          const off = on(name, (payload: unknown) => {
            if (win && !win.isDestroyed()) {
              win.webContents.send("ve:event", { event: name, payload });
            }
          });
          eventSubs.push({ event: name, off: typeof off === "function" ? off : () => {} });
        } catch (e) {
          log(`engine does not emit '${name}':`, e instanceof Error ? e.message : e);
        }
      }
    }
    log(`engine ready via ${factoryName} + ${dispatcherName}`);
  } catch (err) {
    log(
      "engine bootstrap failed (build @ve/engine first: npm run build -w @ve/engine):",
      err instanceof Error ? err.message : err,
    );
  }
}

/* ------------------------------------------------------------------ *
 * IPC wiring
 * ------------------------------------------------------------------ */

function wireIpc() {
  ipcMain.on("ve:invoke", async (event, req) => {
    const { callId, method, params } = req || {};
    const sender = event.sender;
    if (typeof callId !== "number") return;

    if (!dispatch) {
      sender.send("ve:reply", {
        callId,
        ok: false,
        error: {
          code: "NOT_FOUND",
          message: "Engine is not available in this session.",
          hint: "Build @ve/engine (npm run build -w @ve/engine) and restart the app.",
        },
      });
      return;
    }
    try {
      const value = await dispatch(method, Array.isArray(params) ? params : []);
      sender.send("ve:reply", { callId, ok: true, value });
    } catch (err) {
      // Contract: errors cross as EngineErrorShape, never raw stacks.
      const shape =
        err && typeof err === "object" && "code" in err && "message" in err
          ? {
              code: String((err).code),
              message: String((err).message),
              hint:
                "hint" in err && (err as { hint?: unknown }).hint
                  ? String((err as { hint: unknown }).hint)
                  : undefined,
              details: "details" in err ? (err as { details?: unknown }).details : undefined,
            }
          : {
              code: "IO_ERROR",
              message: err instanceof Error ? err.message : String(err),
            };
      sender.send("ve:reply", { callId, ok: false, error: shape });
    }
  });

  // Native dialogs live app-side (contract review note #7).
  ipcMain.handle("ve:pickFiles", async (_event, kind) => {
    const result = await dialog.showOpenDialog(win ?? undefined, {
      properties: ["openFile", "multiSelections"],
      ...(kind === "media"
        ? {
            filters: [
              {
                name: "Media",
                extensions: ["mp4", "mov", "mkv", "webm", "m4v", "mp3", "wav", "m4a", "aac", "png", "jpg", "jpeg", "gif", "webp"],
              },
            ],
          }
        : {}),
    });
    return result.canceled ? [] : result.filePaths;
  });

  ipcMain.handle("ve:pickDirectory", async () => {
    const result = await dialog.showOpenDialog(win ?? undefined, {
      properties: ["openDirectory", "createDirectory"],
    });
    return result.canceled ? null : result.filePaths[0] ?? null;
  });

  ipcMain.handle("ve:pickSavePath", async (_event, defaultName) => {
    const result = await dialog.showSaveDialog(win ?? undefined, {
      defaultPath: typeof defaultName === "string" ? defaultName : "export.mp4",
      filters: [{ name: "Video", extensions: ["mp4", "mov", "mkv", "webm"] }],
    });
    return result.canceled || !result.filePath ? null : result.filePath;
  });
}

/* ------------------------------------------------------------------ *
 * Window
 * ------------------------------------------------------------------ */

async function createWindow() {
  win = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 960,
    minHeight: 600,
    show: false,
    backgroundColor: "#0e1013",
    title: "Reelwright",
    webPreferences: {
      preload: path.join(__dirname, "../../preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false,
    },
  });

  win.once("ready-to-show", () => win?.show());

  if (VITE_DEV_URL) {
    await win.loadURL(VITE_DEV_URL);
  } else {
    const indexHtml = path.join(__dirname, "../ui/index.html");
    if (!fs.existsSync(indexHtml)) {
      log("renderer not built — run: npm run build -w @ve/app (or use VE_VITE_DEV_URL)");
    }
    await win.loadFile(indexHtml);
  }
}

/* ------------------------------------------------------------------ *
 * Smoke mode — integration evidence, exits after reporting
 * ------------------------------------------------------------------ */

async function runSmoke() {
  const report = await win?.webContents.executeJavaScript(
    `({
       hasVe: typeof window.ve === 'object' && window.ve !== null,
       hasInvoke: typeof (window.ve && window.ve.invoke) === 'function',
       hasOn: typeof (window.ve && window.ve.on) === 'function',
       title: document.title,
       bodyChildren: document.body ? document.body.children.length : 0,
       textSample: (document.body ? document.body.innerText : '').slice(0, 400),
     })`,
    true,
  );
  console.log("SMOKE_REPORT " + JSON.stringify(report));
  app.exit(0);
}

app.whenReady().then(async () => {
  wireIpc();
  await bootstrapEngine();
  await createWindow();

  if (isSmoke) {
    // Give the renderer a moment to mount.
    setTimeout(() => void runSmoke(), 800);
  }

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) void createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  for (const { off } of eventSubs) {
    try {
      off();
    } catch {
      /* ignore */
    }
  }
});
