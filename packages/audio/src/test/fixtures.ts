/**
 * Test fixtures: tiny media generated locally with ffmpeg (sine waves,
 * silence, noise, a minimal video+audio mp4). No binary fixtures are
 * committed; everything is synthesized on the fly and cleaned up after.
 */

import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileP = promisify(execFile);

export const FFMPEG = process.env['FFMPEG'] ?? 'ffmpeg';
export const FFPROBE = process.env['FFPROBE'] ?? 'ffprobe';

export async function makeTempDir(prefix = 've-audio-'): Promise<string> {
  return mkdtemp(path.join(tmpdir(), prefix));
}

export async function cleanupTempDir(dir: string): Promise<void> {
  await rm(dir, { recursive: true, force: true });
}

export async function ffmpegOk(args: string[]): Promise<void> {
  try {
    await execFileP(FFMPEG, ['-hide_banner', '-v', 'error', '-y', ...args], { maxBuffer: 8 << 20 });
  } catch (err) {
    throw new Error(`ffmpeg failed (${args.join(' ')}): ${(err as Error).message}`);
  }
}

export interface ToneOpts {
  freq?: number;
  durationSec?: number;
  sampleRate?: number;
  channels?: number;
}

/** Mono/stereo PCM sine tone WAV. */
export async function genToneWav(out: string, opts: ToneOpts = {}): Promise<string> {
  const { freq = 440, durationSec = 1, sampleRate = 48000, channels = 1 } = opts;
  await ffmpegOk([
    '-f', 'lavfi', '-i', `sine=frequency=${freq}:sample_rate=${sampleRate}:duration=${durationSec}`,
    '-ac', String(channels), '-c:a', 'pcm_s16le', out,
  ]);
  return out;
}

/** Digital silence WAV. */
export async function genSilenceWav(out: string, opts: Omit<ToneOpts, 'freq'> = {}): Promise<string> {
  const { durationSec = 1, sampleRate = 48000, channels = 1 } = opts;
  await ffmpegOk([
    '-f', 'lavfi', '-i', `anullsrc=r=${sampleRate}:cl=mono:duration=${durationSec}`,
    '-ac', String(channels), '-c:a', 'pcm_s16le', out,
  ]);
  return out;
}

/** Sine tone mixed with pink noise (amplitude 0.2) — noise-cleanup input. */
export async function genNoisyToneWav(out: string, opts: Omit<ToneOpts, 'freq'> = {}): Promise<string> {
  const { durationSec = 1, sampleRate = 48000 } = opts;
  await ffmpegOk([
    '-f', 'lavfi', '-i', `sine=frequency=440:sample_rate=${sampleRate}:duration=${durationSec}`,
    '-f', 'lavfi', '-i', `anoisesrc=colour=pink:amplitude=0.2:sample_rate=${sampleRate}:duration=${durationSec}`,
    '-filter_complex', '[0:a][1:a]amix=inputs=2:duration=shortest[a]',
    '-map', '[a]', '-ac', '1', '-c:a', 'pcm_s16le', out,
  ]);
  return out;
}

/** Minimal mp4: color bars video + sine audio (waveform-on-video test). */
export async function genBarsToneMp4(out: string, opts: { durationSec?: number } = {}): Promise<string> {
  const { durationSec = 1 } = opts;
  await ffmpegOk([
    '-f', 'lavfi', '-i', `color=c=0x2060C0:size=160x120:rate=10:duration=${durationSec}`,
    '-f', 'lavfi', '-i', `sine=frequency=440:sample_rate=48000:duration=${durationSec}`,
    '-map', '0:v', '-map', '1:a',
    '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '30', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '64k', '-shortest', out,
  ]);
  return out;
}

/** Video-only mp4 (no audio stream) — waveform must fail honestly. */
export async function genVideoOnlyMp4(out: string, opts: { durationSec?: number } = {}): Promise<string> {
  const { durationSec = 1 } = opts;
  await ffmpegOk([
    '-f', 'lavfi', '-i', `color=c=0x602080:size=160x120:rate=10:duration=${durationSec}`,
    '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '30', '-pix_fmt', 'yuv420p', out,
  ]);
  return out;
}

/** Generate interleaved s16le sine PCM in Node (no ffmpeg) — for voiceover tests. */
export function sinePcmS16(frames: number, sampleRate: number, freq = 440, channels = 1, amplitude = 0.5): Buffer {
  const buf = Buffer.alloc(frames * channels * 2);
  for (let i = 0; i < frames; i++) {
    const v = Math.round(amplitude * 32767 * Math.sin((2 * Math.PI * freq * i) / sampleRate));
    for (let c = 0; c < channels; c++) {
      buf.writeInt16LE(v, (i * channels + c) * 2);
    }
  }
  return buf;
}
