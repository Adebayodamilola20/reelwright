import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EngineError } from '../errors.js';
import * as ops from '../ops/timeline.js';
import { TICKS_PER_SECOND, rat } from '../time.js';
import type { Asset, ProjectFile } from '../types.js';

const S = TICKS_PER_SECOND;

function makeAsset(kind: Asset['kind'], durationTicks?: number): Asset {
  return {
    id: `ast_${kind}_${Math.random().toString(36).slice(2, 8)}`,
    kind,
    name: `${kind}.bin`,
    source: { path: `/tmp/${kind}.bin` },
    ...(durationTicks !== undefined ? { meta: { durationTicks, probedAt: new Date().toISOString() } } : { meta: { probedAt: new Date().toISOString() } }),
  };
}

function fixture(): { draft: ProjectFile; video: Asset; audio: Asset; image: Asset } {
  const draft = ops.makeEmptyProject('prj_test', 'Test', {
    width: 640, height: 360, frameRate: rat(30), sampleRate: 48000, channels: 2, background: '#000000',
  });
  ops.seedDefaultTracks(draft);
  const video = makeAsset('video', 10 * S);
  const audio = makeAsset('audio', 10 * S);
  const image = makeAsset('image');
  draft.assets.push(video, audio, image);
  return { draft, video, audio, image };
}

function firstTrack(draft: ProjectFile, kind: 'video' | 'audio') {
  return draft.tracks.find((t) => t.kind === kind)!;
}

test('addClip: defaults, placement, no-overlap enforcement', () => {
  const { draft, video } = fixture();
  const v1 = firstTrack(draft, 'video');
  const clip = ops.addClip(draft, { trackId: v1.id, assetId: video.id, start: 0 });
  assert.equal(clip.duration, 10 * S, 'video clip defaults to full asset length');
  assert.throws(
    () => ops.addClip(draft, { trackId: v1.id, assetId: video.id, start: 5 * S }),
    (e: EngineError) => e.code === 'OVERLAP',
  );
  // overwrite mode trims the existing clip's tail
  const over = ops.addClip(draft, { trackId: v1.id, assetId: video.id, start: 5 * S, duration: 2 * S, mode: 'overwrite' });
  assert.equal(clip.duration, 5 * S);
  assert.equal(over.start, 5 * S);
});

test('addClip: kind/track mismatch and bounds rejected', () => {
  const { draft, video, audio, image } = fixture();
  const v1 = firstTrack(draft, 'video');
  const a1 = firstTrack(draft, 'audio');
  assert.throws(() => ops.addClip(draft, { trackId: v1.id, assetId: audio.id, start: 0 }),
    (e: EngineError) => e.code === 'INVALID_ARGUMENT');
  assert.throws(() => ops.addClip(draft, { trackId: a1.id, assetId: video.id, start: 0 }),
    (e: EngineError) => e.code === 'INVALID_ARGUMENT');
  // past end of media
  assert.throws(() => ops.addClip(draft, { trackId: v1.id, assetId: video.id, start: 0, duration: 11 * S }),
    (e: EngineError) => e.code === 'INVALID_ARGUMENT');
  // images have no intrinsic end
  const img = ops.addClip(draft, { trackId: v1.id, assetId: image.id, start: 0 });
  assert.equal(img.duration, 5 * S, 'image default duration is 5s');
});

test('splitClip: halves with adjusted sourceIn, rejects out-of-bounds', () => {
  const { draft, video } = fixture();
  const v1 = firstTrack(draft, 'video');
  const clip = ops.addClip(draft, { trackId: v1.id, assetId: video.id, start: 1 * S });
  const [left, right] = ops.splitClip(draft, clip.id, 4 * S);
  assert.equal(left.duration, 3 * S);
  assert.equal(right.start, 4 * S);
  assert.equal(right.duration, 7 * S);
  assert.equal(right.sourceIn, 3 * S);
  assert.throws(() => ops.splitClip(draft, clip.id, 0), (e: EngineError) => e.code === 'INVALID_ARGUMENT');
  assert.throws(() => ops.splitClip(draft, clip.id, 20 * S), (e: EngineError) => e.code === 'INVALID_ARGUMENT');
});

test('trimClip: in/out edges with media bounds, non-destructive', () => {
  const { draft, video } = fixture();
  const v1 = firstTrack(draft, 'video');
  const clip = ops.addClip(draft, { trackId: v1.id, assetId: video.id, start: 2 * S });
  // trim in: head moves to 4s → sourceIn 2s, duration 8s
  ops.trimClip(draft, clip.id, { edge: 'in', to: 4 * S });
  assert.equal(clip.start, 4 * S);
  assert.equal(clip.sourceIn, 2 * S);
  assert.equal(clip.duration, 8 * S);
  // cannot trim head before source start (sourceIn=2s, start=4s → min 2s)
  assert.throws(() => ops.trimClip(draft, clip.id, { edge: 'in', to: 1 * S }),
    (e: EngineError) => e.code === 'INVALID_ARGUMENT');
  // trim out: cannot pass asset end (start 4s + sourceIn 2s → max end at 12s)
  ops.trimClip(draft, clip.id, { edge: 'out', to: 11 * S });
  assert.equal(clip.duration, 7 * S);
  assert.throws(() => ops.trimClip(draft, clip.id, { edge: 'out', to: 13 * S }),
    (e: EngineError) => e.code === 'INVALID_ARGUMENT');
});

test('trimClip: ripple pulls later clips along', () => {
  const { draft, video } = fixture();
  const v1 = firstTrack(draft, 'video');
  const a = ops.addClip(draft, { trackId: v1.id, assetId: video.id, start: 0, duration: 4 * S });
  const b = ops.addClip(draft, { trackId: v1.id, assetId: video.id, start: 4 * S, duration: 4 * S });
  ops.trimClip(draft, a.id, { edge: 'out', to: 2 * S, ripple: true });
  assert.equal(a.duration, 2 * S);
  assert.equal(b.start, 2 * S, 'ripple closed the gap');
});

test('moveClip: cross-track, overlap reject, overwrite', () => {
  const { draft, video, image } = fixture();
  const v1 = firstTrack(draft, 'video');
  const overlay = ops.addTrack(draft, 'video', 'Overlay');
  const a = ops.addClip(draft, { trackId: v1.id, assetId: video.id, start: 0, duration: 4 * S });
  const b = ops.addClip(draft, { trackId: v1.id, assetId: video.id, start: 4 * S, duration: 4 * S });
  // move a onto b → overlap rejected
  assert.throws(() => ops.moveClip(draft, a.id, { start: 4 * S }),
    (e: EngineError) => e.code === 'OVERLAP');
  // move to another track
  ops.moveClip(draft, b.id, { trackId: overlay.id, start: 1 * S });
  assert.equal(v1.clips.length, 1);
  assert.equal(overlay.clips.length, 1);
  // audio asset cannot go to video track
  const img = ops.addClip(draft, { trackId: overlay.id, assetId: image.id, start: 5 * S });
  assert.equal(img.start, 5 * S);
});

test('moveClip: overwrite removes covered clip portions', () => {
  const { draft, video } = fixture();
  const v1 = firstTrack(draft, 'video');
  const a = ops.addClip(draft, { trackId: v1.id, assetId: video.id, start: 0, duration: 6 * S });
  const b = ops.addClip(draft, { trackId: v1.id, assetId: video.id, start: 6 * S, duration: 4 * S });
  ops.moveClip(draft, b.id, { start: 3 * S, mode: 'overwrite' });
  assert.equal(a.duration, 3 * S);
  assert.equal(b.start, 3 * S);
  assert.equal(v1.clips.length, 2);
});

test('removeClip ripple closes gap; locked tracks reject ops', () => {
  const { draft, video } = fixture();
  const v1 = firstTrack(draft, 'video');
  const a = ops.addClip(draft, { trackId: v1.id, assetId: video.id, start: 0, duration: 3 * S });
  const b = ops.addClip(draft, { trackId: v1.id, assetId: video.id, start: 3 * S, duration: 3 * S });
  ops.removeClip(draft, a.id, { ripple: true });
  assert.equal(b.start, 0);
  ops.setTrackFlags(draft, v1.id, { locked: true });
  assert.throws(() => ops.updateClip(draft, b.id, { enabled: false }),
    (e: EngineError) => e.code === 'INVALID_ARGUMENT');
  ops.setTrackFlags(draft, v1.id, { locked: false });
});

test('updateClip: allowed patches; speed/keyframes honestly rejected', () => {
  const { draft, audio } = fixture();
  const a1 = firstTrack(draft, 'audio');
  const clip = ops.addClip(draft, { trackId: a1.id, assetId: audio.id, start: 0, duration: 4 * S });
  ops.updateClip(draft, clip.id, { audio: { volume: 0.5, fadeIn: S, fadeOut: S } });
  assert.equal(clip.audio.volume, 0.5);
  assert.throws(() => ops.updateClip(draft, clip.id, { audio: { fadeIn: Math.round(3.5 * S) } }),
    (e: EngineError) => e.code === 'INVALID_ARGUMENT', 'fades cannot exceed clip duration');
  assert.throws(() => ops.updateClip(draft, clip.id, { transform: { opacity: 2 } } as never),
    (e: EngineError) => e.code === 'INVALID_ARGUMENT');
  assert.throws(() => ops.assertClipPatchSupported({ speed: { n: 2, d: 1 } }),
    (e: EngineError) => e.code === 'UNSUPPORTED_FEATURE', 'speed changes are honestly rejected');
  assert.throws(() => ops.assertClipPatchSupported({ keyframes: [] }),
    (e: EngineError) => e.code === 'UNSUPPORTED_FEATURE', 'keyframes are honestly rejected');
});

test('text clips: created inline, editable content, export gate', () => {
  const { draft } = fixture();
  const v1 = firstTrack(draft, 'video');
  const { asset, clip } = ops.addTextClip(draft, { trackId: v1.id, start: 0, text: 'Caption one' });
  assert.equal(asset.kind, 'text');
  assert.equal(clip.text?.text, 'Caption one');
  ops.updateClip(draft, clip.id, { text: { text: 'Caption two' } });
  assert.equal(clip.text?.text, 'Caption two');
  assert.equal(asset.text?.text, 'Caption two', 'text asset mirrors clip edits');
  assert.throws(() => ops.addTextClip(draft, { trackId: firstTrack(draft, 'audio').id, start: 0, text: 'x' }),
    (e: EngineError) => e.code === 'INVALID_ARGUMENT');
});

test('duplicateClip: copies content at requested position', () => {
  const { draft, video } = fixture();
  const v1 = firstTrack(draft, 'video');
  const clip = ops.addClip(draft, { trackId: v1.id, assetId: video.id, start: 0, duration: 3 * S });
  const copy = ops.duplicateClip(draft, clip.id);
  assert.equal(copy.start, 3 * S);
  assert.notEqual(copy.id, clip.id);
  assert.throws(() => ops.duplicateClip(draft, clip.id), (e: EngineError) => e.code === 'OVERLAP');
});
