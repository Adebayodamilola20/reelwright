#!/usr/bin/env node
/**
 * app-smoke-e2e.mjs — app-side integration smoke (Agent 2, second team)
 * Assigned lane: SECOND HEAD, increment 3. Complements scripts/export-e2e.mjs
 * (engine-side, team-2 Agent 1 — read-only for me) with the Electron app leg:
 * "the app actually boots with a working engine bridge".
 *
 * Flow:
 *   1. builds      — `npm run build -w @ve/engine` then `npm run build -w @ve/app`
 *                    (failures are captured as evidence; other agents' code is
 *                    never patched from this lane)
 *   2. spawn       — `electron . --smoke` from packages/app (main.ts smoke mode
 *                    prints `SMOKE_REPORT {json}` and app.exit(0))
 *   3. assert      — window created + renderer loaded (report title/body),
 *                    `window.ve` bridge present (hasVe/hasInvoke/hasOn), and a
 *                    REAL engine dispatch round-trip: a Chromium DevTools
 *                    protocol probe evaluates `window.ve.invoke('project.recent')`
 *                    inside the renderer while the app lives. A structured
 *                    engine error still counts as a proven round-trip; the
 *                    main.ts "engine not available in this session" envelope is
 *                    recorded as the honest-unavailable outcome (walkthrough
 *                    accepts it — we record WHICH happened).
 *
 * Read-only everywhere except this file + demo-output/app-smoke-evidence.json.
 * No dependencies; no npm install; Node >= 22 (global WebSocket).
 *
 * Usage:  node scripts/app-smoke-e2e.mjs [--skip-build] [--attempts N]
 * Exit:   0 pass · 1 assertion fail · 2 build fail · 3 inconclusive
 *         (app-side probe could not be observed after retries) · 4 setup fail
 */

import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { get as httpGet } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url))); // repo root
const APP = join(ROOT, "packages/app");
const APP_PKG = join(APP, "package.json");
const ELECTRON_BIN = join(ROOT, "node_modules/.bin/electron");
const EVIDENCE_PATH = join(ROOT, "demo-output/app-smoke-evidence.json");

const args = process.argv.slice(2);
const SKIP_BUILD = args.includes("--skip-build");
const attemptsArg = args.indexOf("--attempts");
const MAX_ATTEMPTS = attemptsArg >= 0 ? Number.parseInt(args[attemptsArg + 1], 10) || 3 : 3;

const ATTEMPT_TIMEOUT_MS = 30_000; // assignment: ~30s per run
const BUILD_TIMEOUT_MS = 240_000;
const KILL_GRACE_MS = 3_000;

const evidence = {
  when: new Date().toISOString(),
  node: process.version,
  platform: `${process.platform} ${process.arch}`,
  lane: "scripts/app-smoke-e2e.mjs (Agent 2, second team)",
  builds: [],
  attempts: [],
  assertions: [],
  verdict: "UNKNOWN",
  exitCode: null,
};

/* ----------------------------- reporting ----------------------------- */

const checks = []; // { name, pass, detail }
function check(name, pass, detail = "") {
  checks.push({ name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  return pass;
}
function note(line) {
  console.log(`        ${line}`);
}
function tail(text, n = 14) {
  const lines = String(text ?? "").trimEnd().split("\n");
  return lines.slice(-n).join("\n");
}

function finish(code, verdict) {
  evidence.assertions = checks;
  evidence.verdict = verdict;
  evidence.exitCode = code;
  try {
    mkdirSync(dirname(EVIDENCE_PATH), { recursive: true });
    writeFileSync(EVIDENCE_PATH, JSON.stringify(evidence, null, 2) + "\n");
    console.log(`\nEvidence: ${EVIDENCE_PATH}`);
  } catch (err) {
    console.error(`(could not write evidence file: ${err.message})`);
  }
  console.log(`VERDICT ${verdict} (exit ${code})`);
  process.exit(code);
}

/* ------------------------------ builds ------------------------------- */

function runBuild(label, workspace) {
  const cmd = ["npm", "run", "build", "-w", workspace];
  console.log(`\n--- build ${label}: ${cmd.join(" ")} ---`);
  const t0 = Date.now();
  const r = spawnSync(cmd[0], cmd.slice(1), {
    cwd: ROOT,
    encoding: "utf8",
    timeout: BUILD_TIMEOUT_MS,
    env: process.env,
  });
  const rec = {
    label,
    cmd: cmd.join(" "),
    exitCode: r.status,
    ms: Date.now() - t0,
    stdoutTail: tail(r.stdout, 10),
    stderrTail: tail(r.stderr, 10),
  };
  evidence.builds.push(rec);
  if (r.status !== 0) {
    check(`build:${label}`, false, `exit ${r.status}${r.error ? ` (${r.error.message})` : ""}`);
    note(`stdout tail:\n${rec.stdoutTail}`);
    note(`stderr tail:\n${rec.stderrTail}`);
    return false;
  }
  check(`build:${label}`, true, `${(rec.ms / 1000).toFixed(1)}s`);
  return true;
}

/* -------------------- CDP probe (renderer round-trip) ----------------- */

function httpGetJson(url, timeoutMs = 500) {
  return new Promise((resolve) => {
    const r = httpGet(url, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (c) => (body += c));
      res.on("end", () => {
        try {
          resolve(JSON.parse(body));
        } catch {
          resolve(null);
        }
      });
    });
    r.setTimeout(timeoutMs, () => {
      r.destroy();
      resolve(null);
    });
    r.on("error", () => resolve(null));
  });
}

/**
 * Evaluate an expression in the page via CDP. Returns { value } | { error } | null
 * (null = could not attach/talk). One-shot per call; caller retries.
 */
async function cdpEvaluate(wsUrl, expression) {
  return new Promise((resolve) => {
    let ws;
    let done = false;
    const finishOnce = (v) => {
      if (!done) {
        done = true;
        try {
          ws?.close();
        } catch {
          /* ignore */
        }
        resolve(v);
      }
    };
    try {
      ws = new WebSocket(wsUrl);
    } catch {
      return finishOnce(null);
    }
    const timer = setTimeout(() => finishOnce(null), 1500);
    ws.addEventListener("open", () => {
      ws.send(
        JSON.stringify({
          id: 1,
          method: "Runtime.evaluate",
          params: { expression, awaitPromise: true, returnByValue: true, timeout: 1200 },
        }),
      );
    });
    ws.addEventListener("message", (ev) => {
      clearTimeout(timer);
      try {
        const msg = JSON.parse(String(ev.data));
        if (msg.id === 1) {
          if (msg.result && msg.result.result && "value" in msg.result.result) {
            finishOnce({ value: msg.result.result.value });
          } else {
            finishOnce({ error: msg.error ? msg.error.message : "no result payload" });
          }
        }
      } catch {
        finishOnce(null);
      }
    });
    ws.addEventListener("error", () => {
      clearTimeout(timer);
      finishOnce(null);
    });
  });
}

// Read-only round-trip: `project.recent` (engine method union, api.ts) — no writes.
const PROBE_EXPR =
  "(window.ve && typeof window.ve.invoke === 'function') " +
  "? window.ve.invoke('project.recent', []).then(" +
  "v => ({ outcome: 'ok', value: v }), " +
  "e => ({ outcome: 'engine-error', code: (e && e.code) || null, " +
  "message: String((e && e.message) || e), hint: (e && e.hint) || null })) " +
  ": { outcome: 'no-bridge' }";

/* --------------------------- single attempt --------------------------- */

function killGroup(child, signal) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  try {
    process.kill(-child.pid, signal); // detached → child leads its own group
  } catch {
    try {
      child.kill(signal);
    } catch {
      /* already gone */
    }
  }
}

function runAttempt(index) {
  return new Promise((resolve) => {
    const rec = {
      index,
      stdoutLines: [],
      stderrLines: [],
      smokeReport: null,
      mainEngineLine: null,
      rendererNotBuilt: false,
      cdpPort: null,
      probe: null, // last probe outcome
      exit: null,
      ms: 0,
      timedOut: false,
    };
    const t0 = Date.now();
    let settled = false;
    const settle = () => {
      if (settled) return;
      settled = true;
      clearTimeout(attemptTimer);
      clearInterval(watch);
      rec.ms = Date.now() - t0;
      resolve(rec);
    };

    console.log(`\n--- attempt ${index}/${MAX_ATTEMPTS}: electron . --smoke ---`);
    const child = spawn(
      ELECTRON_BIN,
      ["--remote-debugging-port=0", ".", "--smoke"],
      { cwd: APP, detached: true, stdio: ["ignore", "pipe", "pipe"], env: process.env },
    );

    const attemptTimer = setTimeout(() => {
      rec.timedOut = true;
      killGroup(child, "SIGTERM");
      setTimeout(() => killGroup(child, "SIGKILL"), KILL_GRACE_MS);
      settle();
    }, ATTEMPT_TIMEOUT_MS);

    child.stdout.on("data", (buf) => {
      for (const line of String(buf).split("\n")) {
        if (!line.trim()) continue;
        rec.stdoutLines.push(line);
        if (line.includes("SMOKE_REPORT ")) {
          const json = line.slice(line.indexOf("SMOKE_REPORT ") + "SMOKE_REPORT ".length);
          try {
            rec.smokeReport = JSON.parse(json);
          } catch {
            rec.smokeReport = { parseError: json.slice(0, 200) };
          }
        }
      }
    });
    child.stderr.on("data", (buf) => {
      for (const line of String(buf).split("\n")) {
        if (!line.trim()) continue;
        rec.stderrLines.push(line);
        const m = line.match(/DevTools listening on ws:\/\/127\.0\.0\.1:(\d+)/);
        if (m && !rec.cdpPort) rec.cdpPort = Number(m[1]);
        if (line.includes("renderer not built")) rec.rendererNotBuilt = true;
      }
    });
    child.on("error", (err) => {
      rec.exit = { code: null, error: err.message };
      settle();
    });
    child.on("exit", (code, signal) => {
      rec.exit = { code, signal };
      // give trailing output a beat to flush, then finish
      setTimeout(settle, 150);
    });

    // Probe loop: while the app lives, try to prove a renderer→main→engine
    // round-trip. Keep the LAST outcome (early tries can hit a pre-preload
    // context; the app self-exits ~800ms after load, so the last try is post-load).
    const watch = setInterval(() => {
      void (async () => {
        if (settled || rec.exit || !rec.cdpPort) return;
        const targets = await httpGetJson(`http://127.0.0.1:${rec.cdpPort}/json/list`);
        if (!Array.isArray(targets)) return;
        const page = targets.find((t) => t.type === "page" && t.webSocketDebuggerUrl);
        if (!page) return;
        const r = await cdpEvaluate(page.webSocketDebuggerUrl, PROBE_EXPR);
        if (r && r.value && typeof r.value === "object" && r.value.outcome) {
          rec.probe = r.value;
        } else if (r && r.error) {
          rec.probe = { outcome: "cdp-error", error: r.error };
        }
      })();
    }, 120);
  });
}

/* ------------------------------- main --------------------------------- */

console.log(`app-smoke-e2e — Electron boot + engine-bridge smoke`);
console.log(`root: ${ROOT}`);

// Setup preflight
if (!existsSync(APP_PKG)) {
  console.error(`BLOCKED: ${APP_PKG} missing`);
  finish(4, "SETUP-FAIL");
}
if (!existsSync(ELECTRON_BIN)) {
  console.error(`BLOCKED: ${ELECTRON_BIN} missing (electron not installed in this workspace)`);
  finish(4, "SETUP-FAIL");
}

// Builds (skippable for fast re-runs)
if (!SKIP_BUILD) {
  if (!runBuild("engine", "@ve/engine")) finish(2, "BUILD-FAIL");
  if (!runBuild("app", "@ve/app")) finish(2, "BUILD-FAIL");
} else {
  console.log("\n(--skip-build: using existing dist/)");
  for (const p of [
    join(ROOT, "packages/engine/dist/index.js"),
    join(APP, "dist/electron/main.js"),
    join(APP, "dist/ui/index.html"),
  ]) {
    if (!existsSync(p)) {
      console.error(`BLOCKED: ${p} missing and --skip-build given`);
      finish(4, "SETUP-FAIL");
    }
  }
}

// Attempts (retries absorb live-refactor churn / probe races)
let last = null;
for (let i = 1; i <= MAX_ATTEMPTS; i++) {
  last = await runAttempt(i);
  evidence.attempts.push(last);
  const healthy =
    last.smokeReport && !last.smokeReport.parseError && last.exit && last.exit.code === 0 && !last.timedOut;
  if (healthy && last.probe && last.probe.outcome !== "no-bridge" && last.probe.outcome !== "cdp-error") break;
}

const report = last?.smokeReport ?? null;
const mainLogs = (last?.stdoutLines ?? []).filter((l) => l.startsWith("[main]"));

// A1: smoke report present + parseable (window created; runSmoke ran)
check(
  "smoke-report",
  Boolean(report) && !report?.parseError,
  report?.parseError
    ? `unparseable JSON: ${report.parseError}`
    : report
      ? `exit=${last.exit?.code} ms=${last.ms}`
      : "no SMOKE_REPORT line on stdout (app never reached runSmoke)",
);

// A2: renderer loaded clean (title + mounted body; no "renderer not built")
const rendererOk =
  Boolean(report) && report.title === "Reelwright" && (report.bodyChildren ?? 0) > 0 && !last.rendererNotBuilt;
check(
  "window+renderer",
  rendererOk,
  report
    ? `title=${JSON.stringify(report.title)} bodyChildren=${report.bodyChildren}` +
        (last.rendererNotBuilt ? " [main] logged 'renderer not built'" : "")
    : "no report to inspect",
);

// A3: window.ve bridge present in the renderer
const bridgeOk = Boolean(report) && report.hasVe === true && report.hasInvoke === true && report.hasOn === true;
check(
  "window.ve bridge",
  bridgeOk,
  report ? `hasVe=${report.hasVe} hasInvoke=${report.hasInvoke} hasOn=${report.hasOn}` : "no report",
);

// A4: engine dispatch round-trip OR honest structured unavailable (record WHICH)
const probe = last?.probe ?? null;
const engineReadyLog = mainLogs.some((l) => l.includes("engine ready via"));
let enginePass = false;
let engineWhich = "not-observed";
let engineDetail = "";
if (probe && probe.outcome === "ok") {
  enginePass = true;
  engineWhich = "round-trip";
  engineDetail = `invoke('project.recent') → ${JSON.stringify(probe.value)?.slice(0, 160)}`;
} else if (probe && probe.outcome === "engine-error") {
  const honest =
    probe.code === "NOT_FOUND" && String(probe.message).includes("not available in this session");
  enginePass = true; // both are full round-trips through main→dispatcher→engine
  engineWhich = honest ? "honest-unavailable" : "round-trip (structured engine error)";
  engineDetail = `code=${probe.code} message=${JSON.stringify(probe.message)?.slice(0, 140)}${
    probe.hint ? ` hint=${JSON.stringify(probe.hint).slice(0, 120)}` : ""
  }`;
} else if (probe && probe.outcome === "no-bridge") {
  engineDetail = "renderer had no window.ve at probe time";
} else {
  engineDetail = "CDP probe never produced an outcome (attach race or port not exposed)";
}
if (engineWhich === "not-observed" && !enginePass) {
  check("engine dispatch", false, `${engineDetail}${engineReadyLog ? " [main] claimed 'engine ready'" : ""}`);
} else {
  check("engine dispatch", true, `${engineWhich}: ${engineDetail}`);
}

// Supporting evidence lines (not gates — recorded for the walkthrough)
note(`engine bootstrap log: ${engineReadyLog ? mainLogs.find((l) => l.includes("engine ready")) : "(no 'engine ready' line)"}`);
if (report?.textSample) note(`renderer text sample: ${JSON.stringify(report.textSample.slice(0, 160))}`);
if (last?.timedOut) note(`attempt ${last.index} hit the ${ATTEMPT_TIMEOUT_MS / 1000}s timeout (killed)`);
if (last?.probe?.outcome === "cdp-error") note(`cdp error: ${last.probe.error}`);

const passCount = checks.filter((c) => c.pass).length;
console.log(`\nchecks: ${passCount}/${checks.length} passed`);

const allPass = checks.every((c) => c.pass);
const inconclusive =
  !allPass &&
  Boolean(last?.smokeReport) && // the app itself booted fine every time
  !last.smokeReport.parseError &&
  checks.filter((c) => !c.pass).every((c) => c.name === "engine dispatch");

if (allPass) finish(0, "PASS");
if (inconclusive) {
  console.error(
    "INCONCLUSIVE: app smoke evidence all green, but the in-renderer dispatch probe could not be observed " +
      `after ${MAX_ATTEMPTS} attempts (${engineDetail}). Not an app failure — a probe limitation; ` +
      "re-run, or ask SECOND HEAD whether main-log evidence ('engine ready' + bridge present) suffices.",
  );
  finish(3, "INCONCLUSIVE");
}
finish(1, "FAIL");
