/** Project persistence: atomic save/open, autosave, recent projects. All local. */

import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { EngineError, fail } from '../errors.js';
import { computeRelPath } from '../media/assets.js';
import { TICKS_PER_SECOND } from '../time.js';
import { SCHEMA_VERSION } from '../types.js';
import type { Asset, AutosaveInfo, ProjectFile, RecentEntry } from '../types.js';

const AUTOSAVE_DIR = '.autosave';
const AUTOSAVE_KEEP = 5;
const EXPECTED_TIMEBASE = TICKS_PER_SECOND;

/** Write project JSON atomically: temp file in same dir → rename. */
export function writeProjectAtomic(project: ProjectFile, filePath: string): void {
  const dir = dirname(resolve(filePath));
  mkdirSync(dir, { recursive: true });
  const tmp = join(dir, `.${basename(filePath)}.part-${randomUUID().slice(0, 8)}`);
  const json = JSON.stringify(project, null, 2);
  try {
    writeFileSync(tmp, json, 'utf8');
    renameSync(tmp, filePath);
  } catch (e) {
    try {
      if (existsSync(tmp)) rmSync(tmp, { force: true });
    } catch {
      // best effort
    }
    throw new EngineError('IO_ERROR', `Could not write project file "${filePath}": ${String(e)}`);
  }
}

/** Light structural validation of a parsed project file. */
export function validateProjectShape(data: unknown, filePath: string): ProjectFile {
  const p = data as Partial<ProjectFile> | null;
  if (!p || typeof p !== 'object') {
    fail('INVALID_ARGUMENT', `"${filePath}" is not a project file (not an object).`);
  }
  if (p.schemaVersion !== SCHEMA_VERSION) {
    fail('UNSUPPORTED_FEATURE',
      `"${filePath}" uses schema version ${String(p.schemaVersion)}, this build supports ${SCHEMA_VERSION}.`);
  }
  for (const key of ['id', 'name', 'createdAt', 'modifiedAt'] as const) {
    if (typeof p[key] !== 'string') fail('INVALID_ARGUMENT', `"${filePath}" is corrupt: missing "${key}".`);
  }
  if (p.timebase !== undefined && typeof p.timebase === 'number' && p.timebase !== EXPECTED_TIMEBASE) {
    fail('UNSUPPORTED_FEATURE', `"${filePath}" uses timebase ${p.timebase}; expected ${EXPECTED_TIMEBASE}.`);
  }
  if (!p.settings || typeof p.settings !== 'object') {
    fail('INVALID_ARGUMENT', `"${filePath}" is corrupt: missing "settings".`);
  }
  if (!Array.isArray(p.assets) || !Array.isArray(p.tracks)) {
    fail('INVALID_ARGUMENT', `"${filePath}" is corrupt: assets/tracks must be arrays.`);
  }
  return p as ProjectFile;
}

export function readProject(filePath: string): ProjectFile {
  if (!existsSync(filePath)) fail('NOT_FOUND', `Project file not found: ${filePath}`);
  let text: string;
  try {
    text = readFileSync(filePath, 'utf8');
  } catch (e) {
    throw new EngineError('IO_ERROR', `Could not read "${filePath}": ${String(e)}`);
  }
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (e) {
    throw new EngineError('INVALID_ARGUMENT', `"${filePath}" is not valid JSON: ${String(e)}`);
  }
  return validateProjectShape(data, filePath);
}

/** Mirror relPath onto assets that live inside the project folder (save-time bookkeeping). */
export function withRelPaths(project: ProjectFile, projectFilePath: string): ProjectFile {
  const projectDir = dirname(resolve(projectFilePath));
  const clone = structuredClone(project);
  for (const asset of clone.assets as Asset[]) {
    if (asset.kind === 'text' || !asset.source.path) continue;
    const relPath = computeRelPath(asset.source.path, projectDir);
    if (relPath) asset.source.relPath = relPath;
    else delete asset.source.relPath;
  }
  return clone;
}

export function autosaveDirOf(projectFilePath: string): string {
  return join(dirname(resolve(projectFilePath)), AUTOSAVE_DIR);
}

export function autosaveFilePathFor(projectFilePath: string, now = new Date()): string {
  const stamp = now.toISOString().replace(/[:.]/g, '-');
  return join(autosaveDirOf(projectFilePath), `${basename(projectFilePath)}.${stamp}.veproj`);
}

/** Newest autosave for a project, or null. */
export function newestAutosave(projectFilePath: string): AutosaveInfo | null {
  const list = listAutosaves(projectFilePath);
  return list.length ? list[list.length - 1] : null;
}

export function listAutosaves(projectFilePath: string): AutosaveInfo[] {
  const dir = autosaveDirOf(projectFilePath);
  if (!existsSync(dir)) return [];
  const prefix = `${basename(projectFilePath)}.`;
  const entries: AutosaveInfo[] = [];
  for (const name of readdirSync(dir)) {
    if (!name.startsWith(prefix) || !name.endsWith('.veproj')) continue;
    const path = join(dir, name);
    try {
      entries.push({ path, modifiedMs: Math.round(statSync(path).mtimeMs) });
    } catch {
      // raced with a writer; skip
    }
  }
  entries.sort((a, b) => a.modifiedMs - b.modifiedMs);
  return entries;
}

/** Write one autosave if the project is dirty; prunes old ones. Never throws. */
export function writeAutosave(project: ProjectFile, projectFilePath: string): AutosaveInfo | null {
  try {
    const target = autosaveFilePathFor(projectFilePath);
    writeProjectAtomic(withRelPaths(project, projectFilePath), target);
    pruneAutosaves(projectFilePath);
    return { path: target, modifiedMs: Math.round(statSync(target).mtimeMs) };
  } catch {
    return null;
  }
}

function pruneAutosaves(projectFilePath: string): void {
  const list = listAutosaves(projectFilePath);
  const excess = list.length - AUTOSAVE_KEEP;
  for (let i = 0; i < excess; i++) {
    try {
      rmSync(list[i].path, { force: true });
    } catch {
      // best effort
    }
  }
}

/** Recent projects list, stored in the local app-data dir. */
export class RecentStore {
  private readonly file: string;

  constructor(appDataDir: string) {
    this.file = join(appDataDir, 'recent.json');
  }

  list(): RecentEntry[] {
    try {
      if (!existsSync(this.file)) return [];
      const data = JSON.parse(readFileSync(this.file, 'utf8')) as RecentEntry[];
      return Array.isArray(data) ? data : [];
    } catch {
      return [];
    }
  }

  push(entry: { path: string; name: string }, max = 20): void {
    const resolved = resolve(entry.path);
    const next = [
      { path: resolved, name: entry.name, openedAt: new Date().toISOString() },
      ...this.list().filter((r) => r.path !== resolved),
    ].slice(0, max);
    try {
      mkdirSync(dirname(this.file), { recursive: true });
      writeFileSync(this.file, JSON.stringify(next, null, 2), 'utf8');
    } catch {
      // Recent list is a convenience; failures are non-fatal.
    }
  }
}
