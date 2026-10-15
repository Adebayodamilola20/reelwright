/**
 * Export render plan → ffmpeg argv.
 *
 * Pure (no filesystem writes): validates options against the project and the
 * probed ffmpeg capabilities, quantizes clip boundaries to the program frame
 * grid, and assembles a filtergraph that composites video tracks bottom-to-top
 * (transparent canvases + concat-of-gap-filled-segments per track) and mixes
 * audio with sample-aligned apad/atrim placement.
 *
 * v1 honesty rules: speed ≠ 1, keyframes, rotation, pan, and text burn-in
 * (when the local ffmpeg lacks drawtext) fail with UNSUPPORTED_FEATURE
 * instead of being silently dropped.
 */

import { randomUUID } from 'node:crypto';
import { basename, dirname, extname, join } from 'node:path';
import { EngineError, fail } from '../errors.js';
import {
  TICKS_PER_SECOND,
  fsec,
  frameCeil,
  frameFloor,
  ratToString,
  ratValue,
  type Ticks,
} from '../time.js';
import type {
  Clip,
  ExportCapabilities,
  ExportContainer,
  ExportOptions,
  ProjectFile,
} from '../types.js';

export interface FfmpegJob {
  args: string[];
  /** Program duration in seconds (progress denominator). */
  durationSec: number;
  /** Hidden temp output; renamed onto options.outputPath on success. */
  tempOutput: string;
}

const CONTAINER_DEFAULTS: Record<ExportContainer, { video: 'h264' | 'prores' | 'vp9' | null; audio: 'aac' | 'mp3' | 'opus' | 'pcm_s16le' | null }> = {
  mp4: { video: 'h264', audio: 'aac' },
  mov: { video: 'h264', audio: 'aac' },
  mkv: { video: 'h264', audio: 'aac' },
  webm: { video: 'vp9', audio: 'opus' },
  mp3: { video: null, audio: 'mp3' },
  wav: { video: null, audio: 'pcm_s16le' },
};

const ALLOWED_VIDEO: Record<ExportContainer, string[]> = {
  mp4: ['h264'], mov: ['h264', 'prores'], mkv: ['h264', 'prores'],
  webm: ['vp9'], mp3: [], wav: [],
};
const ALLOWED_AUDIO: Record<ExportContainer, string[]> = {
  mp4: ['aac'], mov: ['aac'], mkv: ['aac', 'pcm_s16le'], webm: ['opus'],
  mp3: ['mp3'], wav: ['pcm_s16le'],
};
const FFMPEG_FORMAT: Record<ExportContainer, string> = {
  mp4: 'mp4', mov: 'mov', mkv: 'matroska', webm: 'webm', mp3: 'mp3', wav: 'wav',
};
const H264_CRF: Record<string, number> = { draft: 28, standard: 23, high: 17 };
const VP9_CRF: Record<string, number> = { draft: 40, standard: 33, high: 28 };

/** A clip prepared for one render graph (video and audio share this geometry). */
interface RenderClip {
  clip: Clip;
  inputKey: string; // assetId
  srcIn: Ticks; // quantized source in-point
  relStart: Ticks; // start relative to range, frame-quantized
  relEnd: Ticks; // end relative to range, frame-quantized
}

function bgHex(color: string): string {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(color.trim());
  if (!m) fail('INVALID_ARGUMENT', `Invalid background color "${color}" (expected "#rrggbb").`);
  return `0x${m[1]}`;
}

function validateNoUnsupportedFeatures(project: ProjectFile, caps: ExportCapabilities): void {
  for (const track of project.tracks) {
    for (const clip of track.clips) {
      if (!clip.enabled) continue;
      if (ratValue(clip.speed) !== 1) {
        fail('UNSUPPORTED_FEATURE', 'Export does not support speed changes yet.',
          'Reset clip speed to 1× or wait for a future release.');
      }
      if (clip.keyframes.length > 0) {
        fail('UNSUPPORTED_FEATURE', 'Export does not support keyframed properties yet.',
          'Remove keyframes from the clip(s) first.');
      }
      if (clip.transform && clip.transform.rotationDeg % 360 !== 0) {
        fail('UNSUPPORTED_FEATURE', 'Export does not support clip rotation yet.',
          'Reset rotation to 0° first.');
      }
      const asset = project.assets.find((a) => a.id === clip.assetId);
      if (asset?.kind === 'text') {
        if (!caps.textBurnIn) {
          fail('UNSUPPORTED_FEATURE',
            'This ffmpeg build cannot render text into video (no drawtext filter).',
            'Install ffmpeg with libfreetype, or remove text clips before export. Text clips remain fully editable in the timeline.');
        }
        fail('UNSUPPORTED_FEATURE', 'Text burn-in export is not implemented yet.');
      }
      if (clip.audio.pan !== 0 && asset?.meta.audio && !clip.audio.muted) {
        fail('UNSUPPORTED_FEATURE', 'Export does not support audio pan yet.', 'Set pan to center (0) first.');
      }
    }
  }
}

export function programEndTicks(project: ProjectFile): Ticks {
  let end = 0;
  for (const track of project.tracks) {
    for (const clip of track.clips) {
      if (clip.enabled) end = Math.max(end, clip.start + clip.duration);
    }
  }
  return end;
}

/**
 * Build the complete ffmpeg job for exporting the (range of the) timeline.
 * `resolvedPaths` maps assetId → absolute path that currently exists.
 */
export function buildFfmpegJob(
  project: ProjectFile,
  resolvedPaths: Map<string, string>,
  options: ExportOptions,
  caps: ExportCapabilities,
): FfmpegJob {
  // ----- option resolution & validation -----
  if (!options.outputPath || !options.outputPath.startsWith('/')) {
    fail('INVALID_ARGUMENT', 'outputPath must be an absolute path.');
  }
  const container = options.container;
  const defaults = CONTAINER_DEFAULTS[container];
  if (!defaults) fail('INVALID_ARGUMENT', `Unknown container "${container}".`);

  const videoOpt = options.video ?? (defaults.video ? { codec: defaults.video, quality: 'standard' as const } : null);
  const audioOpt = options.audio ?? (defaults.audio ? { codec: defaults.audio } : null);
  const videoCodec = videoOpt && videoOpt.codec !== 'none' ? videoOpt.codec : null;
  const audioCodec = audioOpt && audioOpt.codec !== 'none' ? audioOpt.codec : null;

  if (videoCodec) {
    if (!ALLOWED_VIDEO[container].includes(videoCodec)) {
      fail('INVALID_ARGUMENT', `Codec "${videoCodec}" is not valid in a ${container} file.`,
        `Allowed video codecs for ${container}: ${ALLOWED_VIDEO[container].join(', ') || 'none'}.`);
    }
    if (!caps.videoCodecs.includes(videoCodec)) {
      fail('FFMPEG_NOT_FOUND', `The local ffmpeg has no "${videoCodec}" encoder.`, caps.ffmpegVersion);
    }
  }
  if (audioCodec) {
    if (!ALLOWED_AUDIO[container].includes(audioCodec)) {
      fail('INVALID_ARGUMENT', `Codec "${audioCodec}" is not valid in a ${container} file.`,
        `Allowed audio codecs for ${container}: ${ALLOWED_AUDIO[container].join(', ') || 'none'}.`);
    }
    if (!caps.audioCodecs.includes(audioCodec)) {
      fail('FFMPEG_NOT_FOUND', `The local ffmpeg has no "${audioCodec}" encoder.`, caps.ffmpegVersion);
    }
  }

  const progEnd = programEndTicks(project);
  if (progEnd <= 0) fail('INVALID_ARGUMENT', 'The timeline is empty — nothing to export.');
  const rangeStart = options.range?.start ?? 0;
  const rangeEnd = options.range?.end ?? progEnd;
  if (rangeStart < 0 || rangeEnd <= rangeStart || rangeEnd > progEnd) {
    fail('INVALID_ARGUMENT', `Invalid export range [${rangeStart}, ${rangeEnd}] (program ends at ${progEnd}).`);
  }
  const progDur: Ticks = rangeEnd - rangeStart;
  const durationSec = progDur / TICKS_PER_SECOND;

  const fps = videoCodec
    ? (options.video?.frameRate ?? project.settings.frameRate)
    : project.settings.frameRate;
  const width = videoCodec ? (options.video?.width ?? project.settings.width) : project.settings.width;
  const height = videoCodec ? (options.video?.height ?? project.settings.height) : project.settings.height;
  const quality = videoOpt && 'quality' in videoOpt ? videoOpt.quality : 'standard';
  const sampleRate = project.settings.sampleRate;
  const channelLayout = project.settings.channels === 1 ? 'mono' : 'stereo';
  const fpsStr = ratToString(fps);

  validateNoUnsupportedFeatures(project, caps);

  // ----- clip preparation (frame-grid quantization, range clamping) -----
  const assetById = new Map(project.assets.map((a) => [a.id, a]));
  const renderClips: RenderClip[] = [];
  for (const track of project.tracks) {
    if (track.kind !== 'video' && track.kind !== 'audio') continue;
    for (const clip of track.clips) {
      if (!clip.enabled) continue;
      const asset = assetById.get(clip.assetId);
      if (!asset || asset.kind === 'text') continue;
      if (track.kind === 'audio' && asset.kind !== 'audio') continue;
      const rel = clip.start - rangeStart;
      if (rel + clip.duration <= 0 || rel >= progDur) continue; // outside range
      let q0 = frameFloor(rel, fps);
      let q1 = frameCeil(rel + clip.duration, fps);
      if (q0 < 0) q0 = 0;
      if (q1 > progDur) q1 = progDur;
      if (q1 - q0 <= 0) continue;
      const leftTrim = q0 - rel; // ≥ 0
      renderClips.push({
        clip,
        inputKey: asset.id,
        srcIn: clip.sourceIn + leftTrim, // speed is guaranteed 1 here
        relStart: q0,
        relEnd: q1,
      });
    }
  }
  if (renderClips.length === 0 && !videoCodec && !audioCodec) {
    fail('INVALID_ARGUMENT', 'Nothing to export: no enabled clips in range and no streams selected.');
  }

  // ----- inputs -----
  const inputArgs: string[] = [];
  const inputIndexByAsset = new Map<string, number>();
  function inputFor(assetId: string): number {
    const existing = inputIndexByAsset.get(assetId);
    if (existing !== undefined) return existing;
    const asset = assetById.get(assetId);
    if (!asset) fail('NOT_FOUND', `Asset ${assetId} missing from project.`);
    const path = resolvedPaths.get(assetId);
    if (!path) {
      fail('ASSET_MISSING', `Media file for asset "${asset.name}" is missing.`,
        'Use relink (project.relinkAsset) to locate the file, then export again.');
    }
    const idx = inputArgs.filter((a) => a === '-i').length;
    if (asset.kind === 'image') {
      inputArgs.push('-loop', '1', '-framerate', String(ratValue(fps)), '-t', durationSec.toFixed(9), '-i', path);
    } else {
      inputArgs.push('-i', path);
    }
    inputIndexByAsset.set(assetId, idx);
    return idx;
  }

  // ----- video graph -----
  const filters: string[] = [];
  let videoOutLabel: string | null = null;
  if (videoCodec) {
    filters.push(`color=c=${bgHex(project.settings.background)}:s=${width}x${height}:r=${fpsStr}:d=${durationSec.toFixed(9)},format=rgba[vbase]`);
    let canvasLabel = 'vbase';
    const videoTracks = project.tracks.filter((t) => t.kind === 'video' && !t.hidden && !t.muted);
    let overlayCount = 0;
    for (const [ti, track] of videoTracks.entries()) {
      const clips = renderClips
        .filter((rc) => track.clips.some((c) => c.id === rc.clip.id))
        .sort((a, b) => a.relStart - b.relStart);
      if (clips.length === 0) continue;
      const segLabels: string[] = [];
      let cursor: Ticks = 0;
      let segIdx = 0;
      const pushSeg = (label: string) => segLabels.push(label);
      for (const rc of clips) {
        if (rc.relStart > cursor) {
          const gap = rc.relStart - cursor;
          const gl = `v${ti}g${segIdx++}`;
          filters.push(`color=c=black@0.0:s=${width}x${height}:r=${fpsStr}:d=${(gap / TICKS_PER_SECOND).toFixed(9)},format=rgba[${gl}]`);
          pushSeg(gl);
        }
        const idx = inputFor(rc.inputKey);
        const dur = rc.relEnd - rc.relStart;
        const label = `v${ti}s${segIdx++}`;
        const chain: string[] = [
          `trim=start=${fsec(rc.srcIn)}:duration=${fsec(dur)}`,
          'setpts=PTS-STARTPTS',
          `fps=${fpsStr}`,
          `scale=${width}:${height}:force_original_aspect_ratio=decrease`,
        ];
        const t = rc.clip.transform;
        if (t && t.scale !== 1) chain.push(`scale=iw*${t.scale}:ih*${t.scale}`);
        const xOff = t ? Math.round(t.x) : 0;
        const yOff = t ? Math.round(t.y) : 0;
        chain.push(`pad=${width}:${height}:(ow-iw)/2+${xOff}:(oh-ih)/2+${yOff}:color=black@0`);
        chain.push('setsar=1');
        if (t && t.opacity !== 1) chain.push(`colorchannelmixer=aa=${t.opacity}`);
        chain.push('format=rgba');
        filters.push(`[${idx}:v]${chain.join(',')}[${label}]`);
        pushSeg(label);
        cursor = rc.relEnd;
      }
      if (cursor < progDur) {
        const gl = `v${ti}g${segIdx++}`;
        filters.push(`color=c=black@0.0:s=${width}x${height}:r=${fpsStr}:d=${((progDur - cursor) / TICKS_PER_SECOND).toFixed(9)},format=rgba[${gl}]`);
        pushSeg(gl);
      }
      const trackLabel = `v${ti}out`;
      filters.push(`${segLabels.map((l) => `[${l}]`).join('')}concat=n=${segLabels.length}:v=1:a=0[${trackLabel}]`);
      const co = `vco${overlayCount++}`;
      filters.push(`[${canvasLabel}][${trackLabel}]overlay=0:0:format=auto[${co}]`);
      canvasLabel = co;
    }
    const fin = 'vout';
    filters.push(`[${canvasLabel}]format=yuv420p[${fin}]`);
    videoOutLabel = fin;
  }

  // ----- audio graph -----
  let audioOutLabel: string | null = null;
  if (audioCodec) {
    const segLabels: string[] = [];
    for (const rc of renderClips) {
      const asset = assetById.get(rc.inputKey)!;
      if (!asset.meta.audio) continue; // image or silent video
      if (rc.clip.audio.muted) continue;
      const track = project.tracks.find((t) => t.clips.some((c) => c.id === rc.clip.id));
      if (!track || track.muted || (track.kind === 'video' && track.hidden)) continue;
      const idx = inputFor(rc.inputKey);
      const dur = rc.relEnd - rc.relStart;
      const a = rc.clip.audio;
      const chain: string[] = [
        `atrim=start=${fsec(rc.srcIn)}:duration=${fsec(dur)}`,
        'asetpts=PTS-STARTPTS',
      ];
      if (a.volume !== 1) chain.push(`volume=${a.volume}`);
      if (a.fadeIn > 0) {
        const d = Math.min(a.fadeIn, dur);
        chain.push(`afade=t=in:st=0:d=${fsec(d)}`);
      }
      if (a.fadeOut > 0) {
        const d = Math.min(a.fadeOut, dur);
        chain.push(`afade=t=out:st=${fsec(dur - d)}:d=${fsec(d)}`);
      }
      chain.push(`aformat=sample_fmts=fltp:sample_rates=${sampleRate}:channel_layouts=${channelLayout}`);
      chain.push(`apad=pad_dur=${fsec(rc.relStart)}`);
      chain.push(`atrim=duration=${durationSec.toFixed(9)}`);
      const label = `a${segLabels.length}`;
      filters.push(`[${idx}:a]${chain.join(',')}[${label}]`);
      segLabels.push(label);
    }
    if (segLabels.length === 0) {
      const idx = inputArgs.filter((a) => a === '-i').length;
      inputArgs.push('-f', 'lavfi', '-i', `anullsrc=r=${sampleRate}:cl=${channelLayout}`);
      filters.push(`[${idx}:a]atrim=duration=${durationSec.toFixed(9)}[aout]`);
    } else {
      const mixed = 'amixin';
      filters.push(`${segLabels.map((l) => `[${l}]`).join('')}amix=inputs=${segLabels.length}:normalize=0:duration=longest[${mixed}]`);
      filters.push(`[${mixed}]atrim=duration=${durationSec.toFixed(9)},aformat=sample_fmts=fltp:sample_rates=${sampleRate}:channel_layouts=${channelLayout}[aout]`);
    }
    audioOutLabel = 'aout';
  }

  // ----- output args -----
  const outArgs: string[] = [];
  if (videoOutLabel) {
    outArgs.push('-map', `[${videoOutLabel}]`);
    if (videoCodec === 'h264') {
      outArgs.push('-c:v', 'libx264', '-preset', 'medium', '-crf', String(H264_CRF[quality] ?? 23), '-pix_fmt', 'yuv420p');
    } else if (videoCodec === 'prores') {
      outArgs.push('-c:v', 'prores_ks', '-profile:v', '3', '-pix_fmt', 'yuv422p10le');
    } else if (videoCodec === 'vp9') {
      outArgs.push('-c:v', 'libvpx-vp9', '-b:v', '0', '-crf', String(VP9_CRF[quality] ?? 33), '-pix_fmt', 'yuv420p');
    }
    outArgs.push('-r', fpsStr);
  } else {
    outArgs.push('-vn');
  }
  if (audioOutLabel) {
    outArgs.push('-map', `[${audioOutLabel}]`);
    const bitrate = audioOpt?.bitrateKbps;
    if (audioCodec === 'aac') outArgs.push('-c:a', 'aac', '-b:a', `${bitrate ?? 192}k`);
    else if (audioCodec === 'mp3') outArgs.push('-c:a', 'libmp3lame', '-q:a', '2');
    else if (audioCodec === 'opus') outArgs.push('-c:a', 'libopus', '-b:a', `${bitrate ?? 128}k`);
    else if (audioCodec === 'pcm_s16le') outArgs.push('-c:a', 'pcm_s16le');
  } else {
    outArgs.push('-an');
  }
  if (container === 'mp4') outArgs.push('-movflags', '+faststart');

  const ext = extname(options.outputPath).slice(1).toLowerCase() || container;
  const tempOutput = join(dirname(options.outputPath), `.${basename(options.outputPath)}.part-${randomUUID().slice(0, 8)}.${ext}`);

  const args = [
    '-hide_banner', '-nostdin', '-y',
    '-loglevel', 'error',
    '-progress', 'pipe:1', '-nostats',
    ...inputArgs,
    '-filter_complex', filters.join(';'),
    ...outArgs,
    '-f', FFMPEG_FORMAT[container],
    '-t', durationSec.toFixed(9),
    tempOutput,
  ];

  return { args, durationSec, tempOutput };
}
