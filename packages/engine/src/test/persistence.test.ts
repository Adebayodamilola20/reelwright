import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createEngine } from '../engine.js';
import { listAutosaves, newestAutosave, readProject, writeAutosave, writeProjectAtomic } from '../persistence/persistence.js';
import { resolveTool } from '../media/tools.js';
import { rat } from '../time.js';
import * as ops from '../ops/timeline.js';
import type { ProjectFile } from '../types.js';

function tmp(): string {
  return mkdtempSync(join(tmpdir(), 've-persist-'));
}

/** Tiny real audio file (0.2 s) so ffprobe-based import works. */
async function makeWav(path: string): Promise<void> {
  await new Promise<void>((res, rej) => {
    const child = spawn(resolveTool('ffmpeg'), [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-f', 'lavfi', '-i', 'sine=frequency=440:duration=0.2',
      '-ar', '48000', '-c:a', 'pcm_s16le', path,
    ], { stdio: 'ignore' });
    child.on('error', rej);
    child.on('close', (code) => (code === 0 ? res() : rej(new Error(`ffmpeg exited ${code}`))));
  });
}

function baseProject(name = 'P'): ProjectFile {
  const p = ops.makeEmptyProject('prj_p', name, {
    width: 640, height: 360, frameRate: rat(30), sampleRate: 48000, channels: 2, background: '#000000',
  });
  ops.seedDefaultTracks(p);
  return p;
}

test('atomic write + read round trip; corrupt files rejected clearly', () => {
  const dir = tmp();
  const path = join(dir, 'P.veproj');
  writeProjectAtomic(baseProject(), path);
  const back = readProject(path);
  assert.equal(back.name, 'P');
  assert.equal(back.timebase, 70_560_000);
  // wrong schema version
  const bad = { ...baseProject(), schemaVersion: 99 };
  writeProjectAtomic(bad, path);
  assert.throws(() => readProject(path), /schema version 99/);
  // not JSON
  writeFileSync(path, 'definitely not json', 'utf8');
  assert.throws(() => readProject(path), /not valid JSON/);
  rmSync(dir, { recursive: true, force: true });
});

test('project create → save → reopen recovers asset references (incl. relPath)', async () => {
  const dir = tmp();
  const engine = createEngine({ autosaveIntervalMs: 0, appDataDir: join(dir, 'appdata') });
  const mediaDir = join(dir, 'media');
  const mediaFile = join(mediaDir, 'clip.wav');
  try {
    mkdirSync(mediaDir, { recursive: true });
    await makeWav(mediaFile);
    await engine.project.create({ name: 'Relink', dir, settings: { width: 320, height: 180 } });
    const res = await engine.assets.import([mediaFile]);
    assert.equal(res.imported.length, 1, JSON.stringify(res.failed));
    await engine.project.save();
    // simulate the project folder being copied elsewhere: relPath survives, absolute path breaks
    const saved = readProject(join(dir, 'Relink.veproj'));
    assert.equal(saved.assets[0].source.relPath, 'media/clip.wav', 'relPath recorded for media inside project dir');
    const movedDir = tmp();
    mkdirSync(join(movedDir, 'media'), { recursive: true });
    renameSync(join(dir, 'Relink.veproj'), join(movedDir, 'Relink.veproj'));
    renameSync(mediaDir, join(movedDir, 'media'));
    await engine.project.close();
    const reopened = await engine.project.open(join(movedDir, 'Relink.veproj'));
    const missing = reopened.state.assets.filter((a) => a.status === 'missing');
    assert.equal(missing.length, 0, 'relPath resolution recovered the asset in the moved folder');
    rmSync(movedDir, { recursive: true, force: true });
  } finally {
    engine.dispose();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('missing asset → resolution missing → relink verifies and fixes', async () => {
  const dir = tmp();
  const engine = createEngine({ autosaveIntervalMs: 0, appDataDir: join(dir, 'appdata') });
  const mediaA = join(dir, 'a.wav');
  const mediaB = join(dir, 'b.wav');
  try {
    await makeWav(mediaA);
    // same-size copy of a.wav: relink by size must accept it
    writeFileSync(mediaB, readFileSync(mediaA));
    await engine.project.create({ name: 'Miss', dir });
    const res = await engine.assets.import([mediaA]);
    const assetId = res.imported[0].id;
    await engine.project.save();
    renameSync(mediaA, join(dir, 'moved-away.wav'));
    // current() serves cached resolutions; verifyAssets() re-resolves from disk
    const afterMove = await engine.project.verifyAssets();
    assert.equal(afterMove[0].status, 'missing');
    // wrong file (different name AND size) rejected
    writeFileSync(join(dir, 'other.wav'), Buffer.alloc(5, 9));
    await assert.rejects(
      engine.project.relinkAsset(assetId, join(dir, 'other.wav')),
      (e: { code?: string }) => e.code === 'INVALID_ARGUMENT',
    );
    // same-name file (moved away) accepted
    const relinked = await engine.project.relinkAsset(assetId, join(dir, 'moved-away.wav'));
    assert.equal(relinked.resolution.status, 'ok');
    const state = (await engine.project.current())!;
    assert.equal(state.assets[0].status, 'ok');
    assert.equal(state.dirty, true);
    rmSync(dir, { recursive: true, force: true });
  } finally {
    engine.dispose();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('autosave files are listed and a newer autosave surfaces a recovery hint', async () => {
  const dir = tmp();
  const engine = createEngine({ autosaveIntervalMs: 0, appDataDir: join(dir, 'appdata') });
  try {
    const { path } = await engine.project.create({ name: 'Auto', dir });
    await engine.timeline.addTrack('audio', 'A0');
    await engine.project.save();
    await engine.project.close(); // stop the engine so synthetic files stay stable
    const project = readProject(path);
    mkdirSync(join(dir, '.autosave'), { recursive: true });
    for (let i = 0; i < 7; i++) {
      const p = join(dir, '.autosave', `Auto.veproj.2026-10-15T00-00-${String(i).padStart(2, '0')}-000Z.veproj`);
      writeProjectAtomic({ ...project, name: `Auto${i}` }, p);
    }
    const list = listAutosaves(path);
    assert.ok(list.length >= 7, `expected ≥7 autosaves, got ${list.length}`);
    const newest = newestAutosave(path);
    assert.ok(newest, 'newestAutosave returns a file');
    const reopened = await engine.project.open(path);
    assert.ok(reopened.recoveredAutosave, 'open surfaces a newer-autosave hint for the UI');
    assert.equal(reopened.recoveredAutosave!.path, newest!.path);
  } finally {
    engine.dispose();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('writeAutosave keeps only the newest 5', async () => {
  const dir = tmp();
  const engine = createEngine({ autosaveIntervalMs: 0, appDataDir: join(dir, 'appdata') });
  try {
    const { path } = await engine.project.create({ name: 'Prune', dir });
    await engine.project.close();
    const project = readProject(path);
    mkdirSync(join(dir, '.autosave'), { recursive: true });
    for (let i = 0; i < 7; i++) {
      const p = join(dir, '.autosave', `Prune.veproj.2026-10-15T00-00-${String(i).padStart(2, '0')}-000Z.veproj`);
      writeProjectAtomic({ ...project, name: `P${i}` }, p);
    }
    // engine write path prunes (writeAutosave via a fresh engine)
    const engine2 = createEngine({ autosaveIntervalMs: 0, appDataDir: join(dir, 'appdata2') });
    try {
      await engine2.project.open(path);
      await engine2.timeline.addTrack('audio', 'dirty');
      const current = (await engine2.project.current())!.project!;
      const res = writeAutosave(current, path);
      assert.ok(res, 'autosave written');
      assert.ok(listAutosaves(path).length <= 5, 'pruned to at most 5');
    } finally {
      engine2.dispose();
    }
  } finally {
    engine.dispose();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('recent projects list is local and deduplicated', async () => {
  const dir = tmp();
  const engine = createEngine({ autosaveIntervalMs: 0, appDataDir: join(dir, 'appdata') });
  try {
    await engine.project.create({ name: 'R1', dir });
    await engine.project.save();
    await engine.project.close();
    await engine.project.open(join(dir, 'R1.veproj'));
    const recent = await engine.project.recent();
    assert.equal(recent.filter((r) => r.name === 'R1').length, 1, 'deduplicated by path');
    assert.equal(recent[0].name, 'R1');
  } finally {
    engine.dispose();
    rmSync(dir, { recursive: true, force: true });
  }
});
