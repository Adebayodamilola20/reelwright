/** Runtime capability probing for the local ffmpeg (honest feature gating). */

import { execFile } from 'node:child_process';
import { EngineError, tail } from '../errors.js';
import type { ExportCapabilities } from '../types.js';

function runFfmpeg(ffmpegPath: string, args: string[]): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    execFile(ffmpegPath, args, { maxBuffer: 8 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err && !stdout) {
        reject(new EngineError('FFMPEG_NOT_FOUND', `Could not run ffmpeg at "${ffmpegPath}": ${err.message}`,
          'Install ffmpeg or set VE_FFMPEG_PATH.'));
        return;
      }
      resolvePromise(`${stdout}\n${stderr}`);
    });
  });
}

const cache = new Map<string, ExportCapabilities>();

export async function probeCapabilities(ffmpegPath: string): Promise<ExportCapabilities> {
  const cached = cache.get(ffmpegPath);
  if (cached) return cached;

  const [versionOut, filtersOut, encodersOut] = await Promise.all([
    runFfmpeg(ffmpegPath, ['-hide_banner', '-version']),
    runFfmpeg(ffmpegPath, ['-hide_banner', '-filters']),
    runFfmpeg(ffmpegPath, ['-hide_banner', '-encoders']),
  ]);

  const versionLine = versionOut.split('\n').find((l) => l.startsWith('ffmpeg version')) ?? 'ffmpeg (unknown version)';
  const textBurnIn = /drawtext/.test(filtersOut);

  const videoCodecs: string[] = [];
  if (/\blibx264\b/.test(encodersOut)) videoCodecs.push('h264');
  if (/\bprores_ks\b|\bprores\b/.test(encodersOut)) videoCodecs.push('prores');
  if (/\blibvpx-vp9\b/.test(encodersOut)) videoCodecs.push('vp9');

  const audioCodecs: string[] = [];
  if (/\baac\b/.test(encodersOut)) audioCodecs.push('aac');
  if (/\blibmp3lame\b/.test(encodersOut)) audioCodecs.push('mp3');
  if (/\blibopus\b/.test(encodersOut)) audioCodecs.push('opus');
  audioCodecs.push('pcm_s16le'); // built into every ffmpeg

  const capabilities: ExportCapabilities = {
    ffmpegPath,
    ffmpegVersion: versionLine.trim(),
    textBurnIn,
    containers: ['mp4', 'mov', 'mkv', 'webm', 'mp3', 'wav'],
    videoCodecs,
    audioCodecs,
  };
  cache.set(ffmpegPath, capabilities);
  return capabilities;
}

export { tail as ffmpegOutputTail };
