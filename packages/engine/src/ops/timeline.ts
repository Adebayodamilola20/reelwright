/**
 * Timeline operations — pure functions over a mutable *draft* of ProjectFile.
 * Callers go through ProjectStore.transact(), which clones first, so a throw
 * here leaves the real project and history untouched.
 *
 * Non-destructive by construction: ops only edit project data, never media.
 */

import { fail } from '../errors.js';
import { newId } from '../ids.js';
import { TICKS_PER_SECOND, rat, ratValue, type Ticks } from '../time.js';
import { SCHEMA_VERSION } from '../types.js';
import type {
  Asset,
  AssetKind,
  Clip,
  ClipAudio,
  ProjectFile,
  TextContent,
  Track,
  TrackKind,
  Transform,
} from '../types.js';
import type { AddClipInput, AddTextClipInput, MoveClipTarget, OverwriteMode, TrimClipChange, UpdateClipPatch } from '../api.js';

/** Rounding tolerance for media bounds (probe durations are rounded). */
const BOUND_TOLERANCE = Math.round(TICKS_PER_SECOND / 1000); // 1 ms

export const DEFAULT_STILL_DURATION: Ticks = 5 * TICKS_PER_SECOND;

export function defaultClipAudio(): ClipAudio {
  return { volume: 1, fadeIn: 0, fadeOut: 0, muted: false, pan: 0 };
}

export function defaultTransform(): Transform {
  return { x: 0, y: 0, scale: 1, rotationDeg: 0, opacity: 1 };
}

export function defaultTextStyle(): TextContent['style'] {
  return {
    fontFamily: 'Helvetica',
    fontSizePx: 72,
    color: '#ffffff',
    bold: false,
    italic: false,
    align: 'center',
    background: null,
    lineHeight: 1.2,
  };
}

function sortClips(track: Track): void {
  track.clips.sort((a, b) => a.start - b.start || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

function clipsOverlap(a: Pick<Clip, 'start' | 'duration'>, b: Pick<Clip, 'start' | 'duration'>): boolean {
  return a.start < b.start + b.duration && b.start < a.start + a.duration;
}

function assertNoOverlaps(track: Track): void {
  sortClips(track);
  for (let i = 0; i < track.clips.length - 1; i++) {
    const a = track.clips[i];
    const b = track.clips[i + 1];
    if (clipsOverlap(a, b)) {
      fail('OVERLAP', `Clips "${a.id}" and "${b.id}" overlap on track "${track.name}".`,
        'Adjust positions or use overwrite mode.');
    }
  }
}

export function findTrack(draft: ProjectFile, trackId: string): Track {
  const track = draft.tracks.find((t) => t.id === trackId);
  if (!track) fail('NOT_FOUND', `Track ${trackId} not found.`);
  return track;
}

export function findClip(draft: ProjectFile, clipId: string): { track: Track; clip: Clip } {
  for (const track of draft.tracks) {
    const clip = track.clips.find((c) => c.id === clipId);
    if (clip) return { track, clip };
  }
  fail('NOT_FOUND', `Clip ${clipId} not found.`);
}

export function getAsset(draft: ProjectFile, assetId: string): Asset {
  const asset = draft.assets.find((a) => a.id === assetId);
  if (!asset) fail('NOT_FOUND', `Asset ${assetId} not found.`);
  return asset;
}

export function clipCountForAsset(draft: ProjectFile, assetId: string): number {
  let n = 0;
  for (const t of draft.tracks) n += t.clips.filter((c) => c.assetId === assetId).length;
  return n;
}

function assertTrackAcceptsAsset(track: Track, asset: Asset): void {
  const want: TrackKind = asset.kind === 'audio' ? 'audio' : 'video';
  if (track.kind !== want) {
    fail('INVALID_ARGUMENT',
      `Asset kind "${asset.kind}" cannot be placed on a ${track.kind} track.`,
      `Add it to a ${want} track instead.`);
  }
}

function assertUnlocked(track: Track): void {
  if (track.locked) fail('INVALID_ARGUMENT', `Track "${track.name}" is locked.`, 'Unlock the track first.');
}

function assertMediaBounds(clip: Pick<Clip, 'sourceIn' | 'duration' | 'speed'>, asset: Asset): void {
  if (clip.sourceIn < 0) fail('INVALID_ARGUMENT', 'sourceIn cannot be negative.');
  if (asset.meta.durationTicks === undefined) return; // image/text: no intrinsic end
  const sourceEnd = clip.sourceIn + clip.duration * ratValue(clip.speed);
  if (sourceEnd > asset.meta.durationTicks + BOUND_TOLERANCE) {
    fail('INVALID_ARGUMENT', `Clip extends past the end of asset "${asset.name}".`,
      `Asset duration: ${asset.meta.durationTicks} ticks.`);
  }
}

function assertNonNegative(t: Ticks, what: string): void {
  if (!Number.isInteger(t) || t < 0) fail('INVALID_ARGUMENT', `${what} must be a non-negative integer (ticks), got ${t}.`);
}

/** Trim/erase [from, to) on a track — supports overwrite placement. */
function clearRange(track: Track, from: Ticks, to: Ticks, ignoreId: string): void {
  const next: Clip[] = [];
  for (const c of track.clips) {
    if (c.id === ignoreId) {
      next.push(c);
      continue;
    }
    const end = c.start + c.duration;
    if (end <= from || c.start >= to) {
      next.push(c);
      continue;
    }
    if (c.start >= from && end <= to) continue; // fully covered → removed
    if (c.start < from && end > from && end <= to) {
      // left of range survives, tail trimmed
      c.duration = from - c.start;
      next.push(c);
    } else if (c.start >= from && c.start < to && end > to) {
      // right of range survives, head trimmed
      const delta = to - c.start;
      c.start = to;
      c.duration = end - to;
      c.sourceIn += Math.round(delta * ratValue(c.speed));
      next.push(c);
    } else if (c.start < from && end > to) {
      // spans the range → hole in the middle (rare; keep both sides)
      const right: Clip = structuredClone(c);
      right.id = newId('clip');
      right.start = to;
      right.duration = end - to;
      right.sourceIn = c.sourceIn + Math.round((to - c.start) * ratValue(c.speed));
      c.duration = from - c.start;
      next.push(c, right);
    }
  }
  track.clips = next;
  sortClips(track);
}

function placeClip(track: Track, clip: Clip, mode: OverwriteMode): void {
  if (mode === 'overwrite') {
    clearRange(track, clip.start, clip.start + clip.duration, clip.id);
    track.clips.push(clip);
    sortClips(track);
  } else {
    track.clips.push(clip);
    assertNoOverlaps(track);
  }
}

/** ---------- Tracks ---------- */

export function addTrack(draft: ProjectFile, kind: TrackKind, name?: string): Track {
  if (kind !== 'video' && kind !== 'audio') fail('INVALID_ARGUMENT', `Unknown track kind "${kind}".`);
  const count = draft.tracks.filter((t) => t.kind === kind).length + 1;
  const track: Track = {
    id: newId('trk'),
    kind,
    name: name?.trim() || `${kind === 'video' ? 'Video' : 'Audio'} ${count}`,
    locked: false,
    muted: false,
    hidden: false,
    clips: [],
  };
  draft.tracks.push(track);
  return track;
}

export function removeTrack(draft: ProjectFile, trackId: string): void {
  const idx = draft.tracks.findIndex((t) => t.id === trackId);
  if (idx === -1) fail('NOT_FOUND', `Track ${trackId} not found.`);
  draft.tracks.splice(idx, 1);
}

export function renameTrack(draft: ProjectFile, trackId: string, name: string): Track {
  const track = findTrack(draft, trackId);
  if (!name.trim()) fail('INVALID_ARGUMENT', 'Track name cannot be empty.');
  track.name = name.trim();
  return track;
}

export function setTrackFlags(
  draft: ProjectFile,
  trackId: string,
  flags: Partial<Pick<Track, 'locked' | 'muted' | 'hidden' | 'name'>>,
): Track {
  const track = findTrack(draft, trackId);
  if (flags.locked !== undefined) track.locked = flags.locked;
  if (flags.muted !== undefined) track.muted = flags.muted;
  if (flags.hidden !== undefined) track.hidden = flags.hidden;
  if (flags.name !== undefined) {
    if (!flags.name.trim()) fail('INVALID_ARGUMENT', 'Track name cannot be empty.');
    track.name = flags.name.trim();
  }
  return track;
}

/** ---------- Clips ---------- */

export function addClip(draft: ProjectFile, input: AddClipInput): Clip {
  const track = findTrack(draft, input.trackId);
  const asset = getAsset(draft, input.assetId);
  assertUnlocked(track);
  assertTrackAcceptsAsset(track, asset);

  const sourceIn = input.sourceIn ?? 0;
  assertNonNegative(sourceIn, 'sourceIn');
  assertNonNegative(input.start, 'start');

  let duration = input.duration;
  if (duration === undefined) {
    duration = asset.meta.durationTicks !== undefined
      ? Math.max(1, asset.meta.durationTicks - sourceIn)
      : DEFAULT_STILL_DURATION;
  }
  if (!Number.isInteger(duration) || duration <= 0) {
    fail('INVALID_ARGUMENT', `duration must be a positive integer (ticks), got ${duration}.`);
  }

  const clip: Clip = {
    id: newId('clip'),
    assetId: asset.id,
    start: input.start,
    duration,
    sourceIn,
    speed: rat(1),
    enabled: true,
    audio: { ...defaultClipAudio(), ...(input.audio ?? {}) },
    keyframes: [],
  };
  if (input.transform) clip.transform = { ...defaultTransform(), ...input.transform };
  if (asset.kind === 'text' && asset.text) clip.text = structuredClone(asset.text);
  assertMediaBounds(clip, asset);
  placeClip(track, clip, input.mode ?? 'reject');
  return clip;
}

export function addTextClip(draft: ProjectFile, input: AddTextClipInput): { asset: Asset; clip: Clip } {
  const track = findTrack(draft, input.trackId);
  assertUnlocked(track);
  if (track.kind !== 'video') fail('INVALID_ARGUMENT', 'Text clips require a video track.');
  if (!input.text.trim()) fail('INVALID_ARGUMENT', 'Text clip content cannot be empty.');

  const asset: Asset = {
    id: newId('ast'),
    kind: 'text',
    name: input.text.slice(0, 24) + (input.text.length > 24 ? '…' : ''),
    source: { path: '' }, // generated asset — no file on disk
    meta: { probedAt: new Date().toISOString() },
    text: {
      text: input.text,
      style: { ...defaultTextStyle(), ...(input.style ?? {}) },
    },
  };
  draft.assets.push(asset);

  const clip: Clip = {
    id: newId('clip'),
    assetId: asset.id,
    start: input.start,
    duration: input.duration ?? DEFAULT_STILL_DURATION,
    sourceIn: 0,
    speed: rat(1),
    enabled: true,
    audio: defaultClipAudio(),
    transform: defaultTransform(),
    text: structuredClone(asset.text),
    keyframes: [],
  };
  if (clip.duration <= 0) fail('INVALID_ARGUMENT', 'duration must be positive.');
  placeClip(track, clip, 'reject');
  return { asset, clip };
}

export function updateClip(draft: ProjectFile, clipId: string, patch: UpdateClipPatch): Clip {
  const { track, clip } = findClip(draft, clipId);
  assertUnlocked(track);

  if (patch.enabled !== undefined) clip.enabled = !!patch.enabled;
  if (patch.audio) {
    const a = patch.audio;
    if (a.volume !== undefined) {
      if (!Number.isFinite(a.volume) || a.volume < 0) fail('INVALID_ARGUMENT', 'volume must be a number ≥ 0.');
      clip.audio.volume = a.volume;
    }
    if (a.fadeIn !== undefined) {
      assertNonNegative(a.fadeIn, 'fadeIn');
      clip.audio.fadeIn = a.fadeIn;
    }
    if (a.fadeOut !== undefined) {
      assertNonNegative(a.fadeOut, 'fadeOut');
      clip.audio.fadeOut = a.fadeOut;
    }
    if (a.muted !== undefined) clip.audio.muted = !!a.muted;
    if (a.pan !== undefined) {
      if (!Number.isFinite(a.pan) || a.pan < -1 || a.pan > 1) fail('INVALID_ARGUMENT', 'pan must be between -1 and 1.');
      clip.audio.pan = a.pan; // stored; not yet rendered (feature matrix)
    }
    if (clip.audio.fadeIn + clip.audio.fadeOut > clip.duration) {
      fail('INVALID_ARGUMENT', 'fadeIn + fadeOut cannot exceed the clip duration.');
    }
  }
  if (patch.transform) {
    const t = patch.transform;
    const base = clip.transform ?? defaultTransform();
    const next: Transform = { ...base };
    for (const k of ['x', 'y', 'scale', 'rotationDeg', 'opacity'] as const) {
      if (t[k] !== undefined) {
        if (!Number.isFinite(t[k] as number)) fail('INVALID_ARGUMENT', `transform.${k} must be a finite number.`);
        next[k] = t[k] as number;
      }
    }
    if (next.scale <= 0) fail('INVALID_ARGUMENT', 'transform.scale must be > 0.');
    if (next.opacity < 0 || next.opacity > 1) fail('INVALID_ARGUMENT', 'transform.opacity must be within 0..1.');
    clip.transform = next;
  }
  if (patch.text) {
    const asset = getAsset(draft, clip.assetId);
    if (asset.kind !== 'text') fail('INVALID_ARGUMENT', 'Only text clips carry text content.');
    const base = clip.text ?? asset.text ?? { text: '', style: defaultTextStyle() };
    clip.text = {
      text: patch.text.text ?? base.text,
      style: { ...base.style, ...(patch.text.style ?? {}) },
    };
    asset.name = clip.text.text.slice(0, 24);
    asset.text = structuredClone(clip.text);
  }
  return clip;
}

/** Fields that the v1 API refuses to mutate directly. */
export function assertClipPatchSupported(patch: Record<string, unknown>): void {
  if ('speed' in patch) {
    fail('UNSUPPORTED_FEATURE', 'Speed changes are not supported yet.',
      'The schema stores speed, but no operation can create non-1/1 speed in v1.');
  }
  if ('keyframes' in patch) {
    fail('UNSUPPORTED_FEATURE', 'Keyframes are not editable yet.',
      'Keyframes are stored in the schema but not evaluated in v1 (see feature matrix).');
  }
  for (const forbidden of ['start', 'duration', 'sourceIn', 'assetId', 'id']) {
    if (forbidden in patch) {
      fail('INVALID_ARGUMENT', `Cannot update "${forbidden}" via updateClip().`,
        'Use moveClip(), trimClip(), or splitClip() for timing changes.');
    }
  }
}

export function removeClip(draft: ProjectFile, clipId: string, opts?: { ripple?: boolean }): void {
  const { track, clip } = findClip(draft, clipId);
  assertUnlocked(track);
  const idx = track.clips.findIndex((c) => c.id === clipId);
  track.clips.splice(idx, 1);
  if (opts?.ripple) {
    for (const c of track.clips) {
      if (c.start >= clip.start + clip.duration) c.start -= clip.duration;
    }
    assertNoOverlaps(track);
  }
}

export function duplicateClip(draft: ProjectFile, clipId: string, at?: Ticks): Clip {
  const { track, clip } = findClip(draft, clipId);
  assertUnlocked(track);
  const copy: Clip = structuredClone(clip);
  copy.id = newId('clip');
  copy.start = at ?? clip.start + clip.duration;
  assertNonNegative(copy.start, 'start');
  assertMediaBounds(copy, getAsset(draft, copy.assetId));
  placeClip(track, copy, 'reject');
  return copy;
}

export function splitClip(draft: ProjectFile, clipId: string, at: Ticks): [Clip, Clip] {
  const { track, clip } = findClip(draft, clipId);
  assertUnlocked(track);
  if (!Number.isInteger(at)) fail('INVALID_ARGUMENT', `Split position must be an integer tick count, got ${at}.`);
  if (at <= clip.start || at >= clip.start + clip.duration) {
    fail('INVALID_ARGUMENT', 'Split position must be strictly inside the clip.');
  }
  const right: Clip = structuredClone(clip);
  right.id = newId('clip');
  right.start = at;
  right.duration = clip.start + clip.duration - at;
  right.sourceIn = clip.sourceIn + Math.round((at - clip.start) * ratValue(clip.speed));
  assertMediaBounds(right, getAsset(draft, clip.assetId));
  clip.duration = at - clip.start;
  const idx = track.clips.indexOf(clip);
  track.clips.splice(idx + 1, 0, right);
  sortClips(track);
  return [clip, right];
}

export function trimClip(draft: ProjectFile, clipId: string, change: TrimClipChange): Clip {
  const { track, clip } = findClip(draft, clipId);
  assertUnlocked(track);
  const asset = getAsset(draft, clip.assetId);
  const { edge, to } = change;
  if (!Number.isInteger(to)) fail('INVALID_ARGUMENT', `Trim position must be an integer tick count, got ${to}.`);
  if (edge !== 'in' && edge !== 'out') fail('INVALID_ARGUMENT', `Unknown trim edge "${edge}".`);

  if (edge === 'in') {
    if (to < 0) fail('INVALID_ARGUMENT', 'Cannot trim before the start of the timeline.');
    if (to >= clip.start + clip.duration) fail('INVALID_ARGUMENT', 'Trim would make the clip empty.');
    const newSourceIn = clip.sourceIn + Math.round((to - clip.start) * ratValue(clip.speed));
    if (newSourceIn < 0) {
      fail('INVALID_ARGUMENT', 'Cannot trim before the start of the source media.',
        `Earliest possible head: tick ${clip.start - clip.sourceIn}.`);
    }
    const oldEnd = clip.start + clip.duration;
    const delta = to - clip.start;
    if (change.ripple) {
      // Later clips follow the head move to stay adjacent.
      for (const c of track.clips) {
        if (c.id !== clip.id && c.start >= oldEnd) c.start += delta;
      }
    }
    clip.start = to;
    clip.sourceIn = newSourceIn;
    clip.duration = oldEnd - to;
    assertNoOverlaps(track); // head may slide into a previous clip in either mode
  } else {
    if (to <= clip.start) fail('INVALID_ARGUMENT', 'Trim would make the clip empty.');
    const newDuration = to - clip.start;
    const probe: Pick<Clip, 'sourceIn' | 'duration' | 'speed'> = {
      sourceIn: clip.sourceIn, duration: newDuration, speed: clip.speed,
    };
    assertMediaBounds(probe, asset);
    if (change.ripple) {
      const oldEnd = clip.start + clip.duration;
      const delta = to - oldEnd;
      clip.duration = newDuration;
      for (const c of track.clips) {
        if (c.id !== clip.id && c.start >= oldEnd) c.start += delta;
      }
      assertNoOverlaps(track);
    } else {
      clip.duration = newDuration;
    }
  }
  if (clip.audio.fadeIn + clip.audio.fadeOut > clip.duration) {
    fail('INVALID_ARGUMENT', 'Trim would make fadeIn + fadeOut exceed the clip duration.',
      'Shorten the fades first.');
  }
  return clip;
}

export function moveClip(draft: ProjectFile, clipId: string, target: MoveClipTarget): Clip {
  const { track: fromTrack, clip } = findClip(draft, clipId);
  assertUnlocked(fromTrack);
  const toTrack = target.trackId ? findTrack(draft, target.trackId) : fromTrack;
  const asset = getAsset(draft, clip.assetId);
  assertUnlocked(toTrack);
  assertTrackAcceptsAsset(toTrack, asset);
  if (!Number.isInteger(target.start)) {
    fail('INVALID_ARGUMENT', `Move target must be an integer tick count, got ${target.start}.`);
  }
  if (target.start < 0) fail('INVALID_ARGUMENT', 'Cannot move a clip before the start of the timeline.');

  const mode = target.mode ?? 'reject';
  const oldTrack = fromTrack;
  const idx = oldTrack.clips.indexOf(clip);
  oldTrack.clips.splice(idx, 1);
  clip.start = target.start;
  if (oldTrack === toTrack) {
    placeClip(oldTrack, clip, mode); // same track: overwrite applies within it
  } else {
    toTrack.clips.push(clip);
    assertNoOverlaps(toTrack);
    sortClips(oldTrack);
  }
  return clip;
}

/** Ensure a brand-new project has at least one track of each kind. */
export function seedDefaultTracks(draft: ProjectFile): void {
  if (!draft.tracks.some((t) => t.kind === 'video')) addTrack(draft, 'video', 'Video 1');
  if (!draft.tracks.some((t) => t.kind === 'audio')) addTrack(draft, 'audio', 'Audio 1');
}

export function makeEmptyProject(id: string, name: string, settings: ProjectFile['settings']): ProjectFile {
  const now = new Date().toISOString();
  return {
    schemaVersion: SCHEMA_VERSION,
    id,
    name,
    createdAt: now,
    modifiedAt: now,
    timebase: TICKS_PER_SECOND,
    settings,
    assets: [],
    tracks: [],
    markers: [],
  };
}

export type { AssetKind };
