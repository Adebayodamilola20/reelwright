import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ProjectStore } from '../store/store.js';
import * as ops from '../ops/timeline.js';
import { TICKS_PER_SECOND, rat } from '../time.js';
import type { ProjectFile } from '../types.js';

const S = TICKS_PER_SECOND;

function makeProject(): ProjectFile {
  const p = ops.makeEmptyProject('prj_1', 'Hist', {
    width: 640, height: 360, frameRate: rat(30), sampleRate: 48000, channels: 2, background: '#000000',
  });
  ops.seedDefaultTracks(p);
  p.assets.push({
    id: 'ast_v', kind: 'video', name: 'v.mp4', source: { path: '/tmp/v.mp4' },
    meta: { durationTicks: 10 * S, probedAt: new Date().toISOString() },
  });
  return p;
}

test('transact commits, undo/redo restore states, dirty tracks saved snapshot', () => {
  const store = new ProjectStore();
  store.load(makeProject());
  assert.equal(store.dirty, false);
  const v1 = store.get().tracks.find((t) => t.kind === 'video')!;
  const clip = store.transact((d) => ops.addClip(d, { trackId: v1.id, assetId: 'ast_v', start: 0, duration: 4 * S }));
  assert.equal(store.dirty, true);
  assert.equal(store.get().tracks[0].clips.length, 1);
  // undo back to the loaded (saved) state → clean again
  assert.ok(store.undo());
  assert.equal(store.get().tracks[0].clips.length, 0);
  assert.equal(store.dirty, false, 'undo back to the saved snapshot is clean');
  assert.ok(store.redo());
  assert.equal(store.dirty, true, 'redo past the saved snapshot is dirty');
  store.markSaved();
  assert.equal(store.dirty, false);
  assert.ok(store.undo());
  assert.equal(store.dirty, true, 'undoing below the save point makes it dirty again');
  assert.ok(store.redo());
  assert.equal(store.dirty, false, 'redo back to the saved state clears dirty');
  void clip;
});

test('failed transact leaves state and history untouched', () => {
  const store = new ProjectStore();
  store.load(makeProject());
  const v1 = store.get().tracks.find((t) => t.kind === 'video')!;
  store.transact((d) => ops.addClip(d, { trackId: v1.id, assetId: 'ast_v', start: 0, duration: 4 * S }));
  const rev = store.revision;
  assert.throws(() => store.transact((d) => ops.addClip(d, { trackId: v1.id, assetId: 'ast_v', start: 2 * S })));
  assert.equal(store.revision, rev, 'revision unchanged after failed op');
  assert.equal(store.get().tracks[0].clips.length, 1);
});

test('batches produce a single undo entry', () => {
  const store = new ProjectStore();
  store.load(makeProject());
  const v1 = store.get().tracks.find((t) => t.kind === 'video')!;
  const clip = store.transact((d) => ops.addClip(d, { trackId: v1.id, assetId: 'ast_v', start: 0, duration: 4 * S }));
  store.beginBatch();
  store.transact((d) => ops.moveClip(d, clip.id, { start: 1 * S }));
  store.transact((d) => ops.moveClip(d, clip.id, { start: 2 * S }));
  store.transact((d) => ops.moveClip(d, clip.id, { start: 3 * S }));
  store.endBatch();
  assert.equal(store.get().tracks[0].clips[0].start, 3 * S);
  assert.ok(store.undo(), 'one undo exits the batch');
  assert.equal(store.get().tracks[0].clips[0].start, 0, 'back before the whole gesture');
  assert.ok(store.redo());
  assert.equal(store.get().tracks[0].clips[0].start, 3 * S);
});

test('history respects its limit', () => {
  const store = new ProjectStore(3);
  store.load(makeProject());
  const v1 = store.get().tracks.find((t) => t.kind === 'video')!;
  for (let i = 0; i < 5; i++) {
    store.transact((d) => ops.addTrack(d, 'audio', `A${i}`));
  }
  let undos = 0;
  while (store.undo()) undos++;
  assert.equal(undos, 3, 'older entries were dropped');
});

test('update() is silent: no undo entry, no revision bump, no dirty flip', () => {
  const store = new ProjectStore();
  store.load(makeProject());
  const rev = store.revision;
  store.update((d) => {
    d.assets[0].source.relPath = 'media/v.mp4';
  });
  assert.equal(store.revision, rev);
  assert.equal(store.dirty, false);
  assert.equal(store.canUndo(), false);
  assert.equal(store.get().assets[0].source.relPath, 'media/v.mp4');
});
