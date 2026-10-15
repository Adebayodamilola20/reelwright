#!/usr/bin/env node
/**
 * fix-electron-install.mjs — durable OFFLINE repair for a half-extracted
 * node_modules/electron install (second head; Observed 2026-10-15).
 *
 * Symptom: electron's own install.js can exit 0 while extracting only part of
 * the archive (dist/Contents/{MacOS,Resources} present but Frameworks missing,
 * or no dist at all) even though `path.txt` was written — so `electron .`
 * dies with "Electron failed to install correctly". Any fresh install can
 * re-trigger it until the upstream installer is fixed.
 *
 * This script verifies the install and, when broken, re-extracts from npm's
 * electron cache zip (~/Library/Caches/electron/**) and rewrites path.txt.
 * No network. No package.json changes. No agent files touched.
 *
 * Usage:
 *   node scripts/fix-electron-install.mjs           # verify + repair if needed
 *   node scripts/fix-electron-install.mjs --check   # verify only (exit 1 if a
 *                                                   # repair would be needed)
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const ELEC = path.join(ROOT, "node_modules", "electron");
const CHECK_ONLY = process.argv.includes("--check");

const ok = (m) => console.log(`  ok   ${m}`);
const bad = (m) => console.error(`  FAIL ${m}`);

/** What `electron .` actually needs on this (darwin) platform. */
function problems() {
  const out = [];
  if (!fs.existsSync(ELEC)) return ["node_modules/electron missing entirely"];
  const ptPath = path.join(ELEC, "path.txt");
  if (!fs.existsSync(ptPath)) {
    out.push("path.txt missing");
    return out;
  }
  const rel = fs.readFileSync(ptPath, "utf-8").trim();
  const exe = path.join(ELEC, "dist", rel);
  if (!fs.existsSync(exe)) out.push(`binary missing: dist/${rel}`);
  if (process.platform === "darwin") {
    // rel = "Electron.app/Contents/MacOS/Electron" → Frameworks sits two levels
    // up from the binary, inside the same Electron.app bundle.
    const fw = path.join(path.dirname(path.dirname(exe)), "Frameworks");
    if (!fs.existsSync(fw) || fs.readdirSync(fw).length === 0) {
      out.push("Contents/Frameworks missing or empty");
    }
  }
  return out;
}

function findCachedZip(version) {
  const want = `electron-v${version}-${process.platform}-${process.arch}.zip`;
  const base = path.join(os.homedir(), "Library", "Caches", "electron");
  if (!fs.existsSync(base)) return null;
  for (const dir of fs.readdirSync(base)) {
    const zip = path.join(base, dir, want);
    if (fs.existsSync(zip)) return zip;
  }
  return null;
}

function main() {
  const before = problems();
  if (before.length === 0) {
    ok("electron install is intact — nothing to do");
    return 0;
  }
  for (const p of before) bad(p);
  if (CHECK_ONLY) {
    console.error("--check: a repair is needed (run without --check, or npm install with network).");
    return 1;
  }
  if (process.platform !== "darwin") {
    bad("automatic repair currently supports darwin only — reinstall electron with network access.");
    return 1;
  }

  const version = JSON.parse(
    fs.readFileSync(path.join(ELEC, "package.json"), "utf-8"),
  ).version;
  const zip = findCachedZip(version);
  if (!zip) {
    bad(`no cached zip for electron ${version} (${process.platform}-${process.arch}) — run npm install with network access.`);
    return 1;
  }
  console.log(`  ..   repairing from cache: ${zip}`);
  const dist = path.join(ELEC, "dist");
  fs.rmSync(dist, { recursive: true, force: true });
  fs.mkdirSync(dist, { recursive: true });
  // unzip -o: overwrite; archive root contains Electron.app/
  execFileSync("unzip", ["-o", "-q", zip, "-d", dist], { stdio: "inherit" });
  fs.writeFileSync(
    path.join(ELEC, "path.txt"),
    path.join("Electron.app", "Contents", "MacOS", "Electron"),
  );

  const after = problems();
  if (after.length > 0) {
    for (const p of after) bad(p);
    return 1;
  }
  ok("electron install repaired — app can boot (verify: node scripts/app-smoke-e2e.mjs --skip-build)");
  return 0;
}

process.exit(main());
