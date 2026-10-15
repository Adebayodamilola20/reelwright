/** Media ingest via ffprobe — metadata extraction for imported assets. */

import { spawn } from 'node:child_process';
import { basename, extname } from 'node:path';
import { EngineError, tail } from '../errors.js';
import { rat, ratFromFrameRateFloat, ticksFromSec, type Ticks } from '../time.js';
import type { Asset, AssetKind, AssetMeta } from '../types.js';
import { newId } from '../ids.js';

const IMAGE_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.bmp', '.tif', '.tiff', '.webp', '.heic', '.avif', '.gif',
]);
const AUDIO_ONLY_EXTENSIONS = new Set(['.mp3', '.wav', '.aac', '.m4a', '.flac', '.ogg', '.opus', '.aiff', '.wma']);
const VIDEO_EXTENSIONS = new Set([
  '.mp4', '.mov', '.mkv', '.webm', '.avi', '.m4v', '.mpg', '.mpeg', '.ts', '.mts', '.wmv',
]);

export interface ProbeResult {
  kind: AssetKind;
  meta: AssetMeta;
}

interface FfprobeStream {
  codec_type?: string;
  codec_name?: string;
  width?: number;
  height?: number;
  r_frame_rate?: string;
  avg_frame_rate?: string;
  pix_fmt?: string;
  channels?: number;
  sample_rate?: string;
  duration?: string;
  disposition?: Record<string, number>;
  side_data_list?: Array<{ side_data_type?: string; rotation?: number }>;
}

interface FfprobeOutput {
  streams?: FfprobeStream[];
  format?: {
    format_name?: string;
    duration?: string;
    bit_rate?: string;
    size?: string;
  };
}

function parseRationalString(s: string | undefined): ReturnType<typeof rat> | undefined {
  if (!s) return undefined;
  const [n, d] = s.split('/').map(Number);
  if (!Number.isFinite(n) || !Number.isFinite(d) || d === 0 || n === 0) return undefined;
  return rat(n, d);
}

/** Run ffprobe and return parsed JSON. */
export async function ffprobeJson(filePath: string, ffprobePath: string): Promise<FfprobeOutput> {
  return new Promise((resolve, reject) => {
    const args = ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', filePath];
    const child = spawn(ffprobePath, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => (out += String(d)));
    child.stderr.on('data', (d) => (err += String(d)));
    child.on('error', (e) => {
      reject(new EngineError('FFMPEG_NOT_FOUND', `Could not run ffprobe at "${ffprobePath}": ${e.message}`,
        'Install ffmpeg or set VE_FFPROBE_PATH.'));
    });
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new EngineError('FFMPEG_FAILED', `ffprobe failed for "${filePath}" (exit ${code}).`, tail(err)));
        return;
      }
      try {
        resolve(JSON.parse(out) as FfprobeOutput);
      } catch (e) {
        reject(new EngineError('FFMPEG_FAILED', `ffprobe returned unparseable JSON for "${filePath}": ${String(e)}`));
      }
    });
  });
}

/** Classify a probed file into an asset kind (heuristics documented in contract). */
export function classifyKind(filePath: string, probe: FfprobeOutput): AssetKind {
  const streams = probe.streams ?? [];
  const videoStreams = streams.filter((s) => s.codec_type === 'video' && !s.disposition?.attached_pic);
  const hasAudio = streams.some((s) => s.codec_type === 'audio');
  const durationSec = Number(probe.format?.duration ?? 0);
  const ext = extname(filePath).toLowerCase();

  if (videoStreams.length > 0 && durationSec > 0 && !AUDIO_ONLY_EXTENSIONS.has(ext)) {
    // Animated GIFs / videos with a video stream and nonzero duration.
    return 'video';
  }
  if (hasAudio && !IMAGE_EXTENSIONS.has(ext)) return 'audio';
  if (videoStreams.length > 0) return 'image';
  if (hasAudio) return 'audio';
  throw new EngineError('UNSUPPORTED_FEATURE', `No usable audio or video stream found in "${basename(filePath)}".`,
    'Supported: common video, audio, and image files.');
}

export async function probeMedia(filePath: string, ffprobePath: string): Promise<ProbeResult> {
  const probe = await ffprobeJson(filePath, ffprobePath);
  const kind = classifyKind(filePath, probe);
  const streams = probe.streams ?? [];
  const meta: AssetMeta = { probedAt: new Date().toISOString() };

  const durationSec = Number(probe.format?.duration ?? 0);
  if (durationSec > 0 && kind !== 'image') {
    meta.durationTicks = ticksFromSec(durationSec);
  }

  const v = streams.find((s) => s.codec_type === 'video' && !s.disposition?.attached_pic);
  if (v && kind !== 'audio') {
    let rotationDeg = 0;
    for (const sd of v.side_data_list ?? []) {
      if (typeof sd.rotation === 'number') rotationDeg += sd.rotation;
    }
    // ffprobe reports rotation as a multiple of 90 (often negative for CW).
    const normalized = ((-rotationDeg % 360) + 360) % 360;
    meta.video = {
      codec: v.codec_name ?? 'unknown',
      width: v.width ?? 0,
      height: v.height ?? 0,
      ...(normalized !== 0 ? { rotationDeg: normalized } : {}),
    };
    const fpsFloat = v.avg_frame_rate ? Number(v.avg_frame_rate.split('/').slice(0, 2).join('/')) : NaN;
    const exact = parseRationalString(v.avg_frame_rate) ?? parseRationalString(v.r_frame_rate);
    meta.video.frameRate = exact ?? (Number.isFinite(fpsFloat) && fpsFloat > 0 ? ratFromFrameRateFloat(fpsFloat) : undefined);
  }

  const a = streams.find((s) => s.codec_type === 'audio');
  if (a && (kind === 'audio' || kind === 'video')) {
    meta.audio = {
      codec: a.codec_name ?? 'unknown',
      channels: a.channels ?? 0,
      sampleRate: Number(a.sample_rate ?? 0),
    };
  }

  if (probe.format) {
    meta.format = {
      formatName: probe.format.format_name ?? 'unknown',
      ...(probe.format.bit_rate ? { bitRate: Number(probe.format.bit_rate) } : {}),
      ...(probe.format.size ? { sizeBytes: Number(probe.format.size) } : {}),
    };
  }

  return { kind, meta };
}

/** Build a full Asset from a probe result. */
export function assetFromProbe(
  filePath: string,
  kind: AssetKind,
  meta: AssetMeta,
  relPath: string | undefined,
  file: { sizeBytes: number; modifiedMs: number },
): Asset {
  return {
    id: newId('ast'),
    kind,
    name: basename(filePath),
    source: { path: filePath, ...(relPath ? { relPath } : {}) },
    file,
    meta,
  };
}

export { IMAGE_EXTENSIONS, AUDIO_ONLY_EXTENSIONS, VIDEO_EXTENSIONS };
export type { Ticks };
