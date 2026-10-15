/**
 * Voiceover recording: data path, storage format, timeline data shape, and
 * the IPC contract the Electron shell must implement.
 *
 * Ownership split (Designed; announced in TEAM_STATUS):
 *  - Agent 2 (`@ve/app`, Electron renderer): getUserMedia capture → PCM s16le
 *    (via WebAudio AudioWorklet or ScriptProcessor) → send chunks over IPC.
 *  - Agent 2 (Electron main): instantiate VoiceoverSession here, persist on
 *    finalize; expose the resulting asset to `assets.import` / timeline.
 *  - This package: WAV encode/decode, exact tick math, clip-shape creation,
 *    optional mp3 encode via local ffmpeg (capability-probed).
 *
 * Storage format decision: **WAV (pcm_s16le) is the primary recording format**
 * — lossless, instant to write (pure-Node header, no encoder wait), and
 * sample-exact for tick math. MP3 export is offered post-record via ffmpeg
 * (Observed: libmp3lame present locally) but never as the recording format
 * (encoder latency + lossy feedback loops).
 */

import { mkdir, rename, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { AudioError } from './errors.js';
import { DEFAULT_FFMPEG, probeEncoders, runFfmpegOrThrow } from './ffmpeg.js';
import { TICKS_PER_SECOND, ticksFromSamples, type Ticks } from './time.js';

/** Contract-exact tick rates: every sample maps to an integer tick count. */
export const SUPPORTED_RECORD_RATES = [44100, 48000, 96000] as const;

export interface RecordingFormat {
  sampleRate: number;
  channels: number; // 1 (mono) or 2 (stereo)
}

export function validateRecordingFormat(fmt: RecordingFormat): void {
  if (!(SUPPORTED_RECORD_RATES as readonly number[]).includes(fmt.sampleRate)) {
    throw new AudioError(
      'INVALID_ARGUMENT',
      `sampleRate must be one of ${SUPPORTED_RECORD_RATES.join(', ')} for exact tick math, got ${fmt.sampleRate}`,
    );
  }
  if (fmt.channels !== 1 && fmt.channels !== 2) {
    throw new AudioError('INVALID_ARGUMENT', `channels must be 1 or 2, got ${fmt.channels}`);
  }
}

/** ---------- WAV encode/decode (pure Node, no ffmpeg) ---------- */

/** Wrap interleaved little-endian s16 PCM samples in a canonical 44-byte RIFF/WAVE header. */
export function encodeWavPcm16(pcm: Buffer, sampleRate: number, channels: number): Buffer {
  if (pcm.length % 2 !== 0) {
    throw new AudioError('INVALID_ARGUMENT', `s16le PCM byte length must be even, got ${pcm.length}`);
  }
  if (pcm.length / 2 % channels !== 0) {
    throw new AudioError(
      'INVALID_ARGUMENT',
      `PCM sample count ${pcm.length / 2} is not a whole number of ${channels}-channel frames`,
    );
  }
  const byteRate = sampleRate * channels * 2;
  const header = Buffer.alloc(44);
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVE', 8, 'ascii');
  header.write('fmt ', 12, 'ascii');
  header.writeUInt32LE(16, 16); // PCM fmt chunk size
  header.writeUInt16LE(1, 20); // format = PCM
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(channels * 2, 32); // block align
  header.writeUInt16LE(16, 34); // bits per sample
  header.write('data', 36, 'ascii');
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

export interface WavInfo {
  sampleRate: number;
  channels: number;
  bitsPerSample: number;
  dataBytes: number;
  sampleCount: number; // per channel (frames)
}

/** Parse a canonical WAV produced by encodeWavPcm16 (or a standard PCM WAV). */
export function parseWav(buf: Buffer): WavInfo {
  function fail(why: string): never {
    throw new AudioError('INVALID_ARGUMENT', `not a parseable PCM WAV: ${why}`);
  }
  if (buf.length < 44) fail('file shorter than a WAV header');
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') fail('missing RIFF/WAVE magic');
  let offset = 12;
  let fmt: { channels: number; sampleRate: number; bitsPerSample: number } | null = null;
  let dataBytes = 0;
  while (offset + 8 <= buf.length) {
    const id = buf.toString('ascii', offset, offset + 4);
    const size = buf.readUInt32LE(offset + 4);
    if (id === 'fmt ') {
      const format = buf.readUInt16LE(offset + 8);
      if (format !== 1) fail(`non-PCM format tag ${format}`);
      fmt = {
        channels: buf.readUInt16LE(offset + 10),
        sampleRate: buf.readUInt32LE(offset + 12),
        bitsPerSample: buf.readUInt16LE(offset + 22),
      };
    } else if (id === 'data') {
      dataBytes = size;
    }
    offset += 8 + size + (size % 2);
  }
  if (!fmt) fail('no fmt chunk');
  if (fmt.bitsPerSample !== 16) fail(`unsupported bit depth ${fmt.bitsPerSample}`);
  if (dataBytes === 0) fail('no data chunk');
  return {
    sampleRate: fmt.sampleRate,
    channels: fmt.channels,
    bitsPerSample: fmt.bitsPerSample,
    dataBytes,
    sampleCount: dataBytes / 2 / fmt.channels,
  };
}

/** Exact timeline duration of a recording (integer ticks; contract rates exact). */
export function durationTicksFromSamples(sampleCount: number, sampleRate: number): Ticks {
  return ticksFromSamples(sampleCount, sampleRate);
}

/** ---------- Timeline data shape ---------- */

export interface VoiceoverClipInit {
  clipId: string;
  assetId: string;
  /** Timeline position where the voiceover starts (ticks). */
  startTicks: Ticks;
  /** Recorded frames (per-channel samples). */
  sampleCount: number;
  sampleRate: number;
  /** Optional pre-roll fade to avoid pops; default 0. */
  fadeInTicks?: Ticks;
  fadeOutTicks?: Ticks;
}

/**
 * Clip-shaped object for a finished recording, structurally matching the
 * contract's `Clip` (packages/engine/src/types.ts) so the engine can place it
 * on an audio track without conversion. Defaults: sourceIn 0, speed 1/1,
 * enabled, volume unity, unmuted, pan 0.
 */
export function voiceoverClipFromRecording(init: VoiceoverClipInit): {
  id: string;
  assetId: string;
  start: Ticks;
  duration: Ticks;
  sourceIn: Ticks;
  speed: { n: 1; d: 1 };
  enabled: true;
  audio: { volume: 1; fadeIn: Ticks; fadeOut: Ticks; muted: false; pan: 0 };
  keyframes: [];
} {
  validateRecordingFormat({ sampleRate: init.sampleRate, channels: 1 });
  const duration = durationTicksFromSamples(init.sampleCount, init.sampleRate);
  if (duration <= 0) {
    throw new AudioError('INVALID_ARGUMENT', 'voiceover recording has zero duration');
  }
  const fadeIn = init.fadeInTicks ?? 0;
  const fadeOut = init.fadeOutTicks ?? 0;
  if (fadeIn + fadeOut > duration) {
    throw new AudioError('INVALID_ARGUMENT', 'voiceover fade-in + fade-out exceeds recording duration');
  }
  return {
    id: init.clipId,
    assetId: init.assetId,
    start: init.startTicks,
    duration,
    sourceIn: 0,
    speed: { n: 1, d: 1 },
    enabled: true,
    audio: { volume: 1, fadeIn, fadeOut, muted: false, pan: 0 },
    keyframes: [],
  };
}

/** ---------- Session (Electron main-process side) ---------- */

export interface VoiceoverFinalizeResult {
  path: string;
  format: 'wav' | 'mp3';
  sampleRate: number;
  channels: number;
  sampleCount: number;
  durationTicks: Ticks;
  bytes: number;
}

export interface VoiceoverSessionOptions {
  sessionId?: string;
  maxBytes?: number; // default 512 MB of raw PCM — safety cap
}

/**
 * Accumulates PCM s16le chunks streamed from the renderer and finalizes to a
 * WAV (or, on request, MP3 via local ffmpeg). One session = one recording.
 */
export class VoiceoverSession {
  readonly sessionId: string;
  readonly sampleRate: number;
  readonly channels: number;
  private chunks: Buffer[] = [];
  private bytes = 0;
  private done = false;
  private readonly maxBytes: number;

  constructor(fmt: RecordingFormat, opts: VoiceoverSessionOptions = {}) {
    validateRecordingFormat(fmt);
    this.sessionId = opts.sessionId ?? randomUUID();
    this.sampleRate = fmt.sampleRate;
    this.channels = fmt.channels;
    this.maxBytes = opts.maxBytes ?? 512 * 1024 * 1024;
  }

  get receivedBytes(): number {
    return this.bytes;
  }

  /** Append an interleaved s16le PCM chunk. Chunks are concatenated verbatim. */
  append(chunk: Buffer): { receivedBytes: number } {
    if (this.done) {
      throw new AudioError('INVALID_ARGUMENT', `voiceover session ${this.sessionId} is already finalized`);
    }
    if (chunk.length % 2 !== 0) {
      throw new AudioError('INVALID_ARGUMENT', `PCM chunk byte length must be even, got ${chunk.length}`);
    }
    this.bytes += chunk.length;
    if (this.bytes > this.maxBytes) {
      throw new AudioError('IO_ERROR', `voiceover session exceeded the ${this.maxBytes} byte safety cap`, {
        hint: 'Stop the recording or raise maxBytes deliberately.',
      });
    }
    this.chunks.push(Buffer.from(chunk)); // copy: caller may reuse its buffer
    return { receivedBytes: this.bytes };
  }

  /** Discard the session; no file is written. */
  abort(): void {
    this.done = true;
    this.chunks = [];
  }

  /**
   * Write the recording. `wav` is pure Node; `mp3` transcodes via local
   * ffmpeg and throws UNSUPPORTED_FEATURE when libmp3lame is absent.
   */
  async finalize(
    format: 'wav' | 'mp3',
    opts: { outputPath: string; ffmpegPath?: string; bitrateKbps?: number } = { outputPath: '' },
  ): Promise<VoiceoverFinalizeResult> {
    if (!opts.outputPath) {
      throw new AudioError('INVALID_ARGUMENT', 'finalize requires an outputPath');
    }
    if (this.done) {
      throw new AudioError('INVALID_ARGUMENT', `voiceover session ${this.sessionId} is already finalized`);
    }
    this.done = true;
    const pcm = Buffer.concat(this.chunks);
    this.chunks = [];
    const sampleCount = pcm.length / 2 / this.channels;
    if (sampleCount <= 0) {
      throw new AudioError('INVALID_ARGUMENT', 'voiceover session received no audio data');
    }
    await mkdir(path.dirname(opts.outputPath), { recursive: true });

    let bytes: number;
    if (format === 'wav') {
      const wav = encodeWavPcm16(pcm, this.sampleRate, this.channels);
      const tmp = `${opts.outputPath}.tmp-${process.pid}`;
      await writeFile(tmp, wav);
      await rename(tmp, opts.outputPath);
      bytes = wav.length;
    } else {
      const ffmpeg = opts.ffmpegPath ?? DEFAULT_FFMPEG;
      const encoders = await probeEncoders(ffmpeg);
      if (!encoders.has('libmp3lame')) {
        throw new AudioError('UNSUPPORTED_FEATURE', 'this ffmpeg build has no libmp3lame encoder', {
          hint: 'Finalize as WAV instead, or install an ffmpeg build with libmp3lame.',
        });
      }
      const tmpWav = `${opts.outputPath}.recording-${process.pid}.wav`;
      await writeFile(tmpWav, encodeWavPcm16(pcm, this.sampleRate, this.channels));
      try {
        await runFfmpegOrThrow(
          [
            '-i', tmpWav,
            '-c:a', 'libmp3lame',
            '-b:a', `${opts.bitrateKbps ?? 192}k`,
            '-y', opts.outputPath,
          ],
          { bin: ffmpeg, what: 'voiceover mp3 encode' },
        );
      } finally {
        await unlink(tmpWav).catch(() => {});
      }
      bytes = (await stat(opts.outputPath)).size;
    }

    return {
      path: opts.outputPath,
      format,
      sampleRate: this.sampleRate,
      channels: this.channels,
      sampleCount,
      durationTicks: durationTicksFromSamples(sampleCount, this.sampleRate),
      bytes,
    };
  }
}

/** Canonical storage location inside a project folder. */
export function voiceoverOutputPath(projectDir: string, sessionId: string, format: 'wav' | 'mp3'): string {
  return path.join(projectDir, 'audio', 'voiceovers', `vo_${sessionId}.${format}`);
}

/** ---------- IPC contract the Electron shell implements (Designed proposal) ---------- */

/**
 * Renderer-facing surface Agent 2 wires through `window.ve` (or a dedicated
 * channel). Mapping to the contract's generic bridge is Agent 2's call; the
 * shapes below are stable regardless of transport.
 *
 *   renderer (getUserMedia → PCM s16le chunks)
 *     → voiceover.startSession({ sampleRate: 48000, channels: 1 })
 *     → voiceover.appendChunk(sessionId, base64Pcm)  ×N while recording
 *     → voiceover.finalize(sessionId, { format: 'wav', projectDir })
 *        ↳ { asset: Asset-like metadata, clip: VoiceoverClip, result }
 *   or → voiceover.abort(sessionId) on cancel.
 */
export interface VoiceoverBridge {
  startSession(req: RecordingFormat): Promise<{ sessionId: string }>;
  appendChunk(sessionId: string, pcmBase64: string): Promise<{ receivedBytes: number }>;
  finalize(
    sessionId: string,
    req: { format: 'wav' | 'mp3'; projectDir: string },
  ): Promise<{ result: VoiceoverFinalizeResult; clip: ReturnType<typeof voiceoverClipFromRecording> }>;
  abort(sessionId: string): Promise<void>;
}
