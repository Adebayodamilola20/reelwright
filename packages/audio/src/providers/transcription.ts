/**
 * Speech transcription behind an explicit provider interface
 * (docs/PROJECT_CONTRACT.md "Provider interfaces").
 *
 * v1 ships NO working transcription: the default provider always reports
 * available:false with an accurate reason, and `transcribe` throws
 * NOT_CONFIGURED. No network calls, no downloads, no installs — a real
 * backend (local model, or any hosted service) requires explicit
 * project-owner approval per the charter.
 *
 * What we DO provide is honest detection: `detectLocalWhisper()` looks for a
 * whisper.cpp-style CLI and local model files on this machine so the status
 * reason can say exactly what is and isn't present (Observed at runtime),
 * which is the difference between "not installed" and "installed but
 * unconfigured".
 */

import { access, readdir, constants } from 'node:fs/promises';
import path from 'node:path';
import { homedir } from 'node:os';
import { AudioError } from '../errors.js';

export interface TranscriptCue {
  startMs: number;
  endMs: number;
  text: string;
  confidence?: number;
}

export interface TranscriptResult {
  providerId: string;
  language?: string;
  cues: TranscriptCue[];
}

export interface TranscriptionStatus {
  available: boolean;
  /** Always present when available === false (honest-gating rule). */
  reason?: string;
}

export interface TranscriptionProvider {
  readonly id: string;
  readonly displayName: string;
  status(): Promise<TranscriptionStatus>;
  /** Throws NOT_CONFIGURED when status().available is false. */
  transcribe(audioPath: string, opts?: { language?: string }): Promise<TranscriptResult>;
}

/** Default stub: always unavailable, reason configurable. */
export class UnavailableTranscriptionProvider implements TranscriptionProvider {
  constructor(
    readonly id: string,
    readonly displayName: string,
    private readonly reason: string,
  ) {}

  status(): Promise<TranscriptionStatus> {
    return Promise.resolve({ available: false, reason: this.reason });
  }

  transcribe(_audioPath: string, _opts?: { language?: string }): Promise<TranscriptResult> {
    return Promise.reject(
      new AudioError('NOT_CONFIGURED', `provider '${this.id}' is not configured`, {
        hint: this.reason,
      }),
    );
  }
}

export interface WhisperDetection {
  /** Absolute path of a detected whisper.cpp-style CLI, or null. */
  binaryPath: string | null;
  /** Local model files found in the scanned directories (e.g. ggml-*.bin). */
  modelPaths: string[];
  /** Human summary for status reasons / UI copy. */
  summary: string;
}

// whisper.cpp's binary is `whisper-cli` (newer) or `whisper-cpp` (older).
// The legacy name `main` is deliberately NOT probed: too generic for a PATH
// lookup (false positives on unrelated `main` executables).
const DEFAULT_BINARIES = ['whisper-cli', 'whisper-cpp'];

async function isExecutable(p: string): Promise<boolean> {
  try {
    await access(p, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Detect a local whisper.cpp-style binary and models. Purely local: PATH
 * lookup + shallow directory scans. Never downloads anything.
 * `pathDirs` defaults to `$PATH` (injectable for tests / app-configured dirs).
 */
export async function detectLocalWhisper(
  binaries: readonly string[] = DEFAULT_BINARIES,
  modelDirs: readonly string[] = [
    path.join(homedir(), '.cache', 'whisper'),
    path.join(homedir(), 'whisper.cpp', 'models'),
    '/usr/local/share/whisper',
  ],
  pathDirs: readonly string[] = (process.env['PATH'] ?? '').split(path.delimiter).filter(Boolean),
): Promise<WhisperDetection> {
  let binaryPath: string | null = null;
  for (const name of binaries) {
    for (const dir of pathDirs) {
      const candidate = path.join(dir, name);
      if (await isExecutable(candidate)) {
        binaryPath = candidate;
        break;
      }
    }
    if (binaryPath) break;
  }

  const modelPaths: string[] = [];
  for (const dir of modelDirs) {
    try {
      const entries = await readdir(dir);
      for (const entry of entries) {
        if (/^ggml.*\.bin$/i.test(entry)) modelPaths.push(path.join(dir, entry));
      }
    } catch {
      // dir absent — fine
    }
    if (modelPaths.length >= 20) break; // bounded scan; we only need existence
  }

  const summary = binaryPath
    ? `whisper.cpp-style CLI detected at ${binaryPath}; ${modelPaths.length} local model file(s) found`
    : 'no whisper.cpp-style CLI found on PATH';
  return { binaryPath, modelPaths, summary };
}

/**
 * Whisper.cpp-backed provider — detection-only in v1. `status()` reports the
 * runtime detection facts and stays `available: false` because the
 * transcription path (model loading, audio windowing, SRT cue assembly) is
 * **Planned, not implemented**; claiming availability without a working
 * end-to-end path would violate the honest-capability rule.
 */
export class WhisperCliProvider implements TranscriptionProvider {
  readonly id = 'local-whisper-cli';
  readonly displayName = 'Local whisper.cpp CLI';

  async status(): Promise<TranscriptionStatus> {
    const detection = await detectLocalWhisper();
    if (!detection.binaryPath) {
      return { available: false, reason: `${detection.summary}; install one (or approve a download) to enable transcription` };
    }
    if (detection.modelPaths.length === 0) {
      return {
        available: false,
        reason: `${detection.summary}; a model file is required and downloading one needs project-owner approval`,
      };
    }
    return {
      available: false,
      reason: `${detection.summary}; transcription pipeline is Planned — not implemented in this build`,
    };
  }

  transcribe(_audioPath: string, _opts?: { language?: string }): Promise<TranscriptResult> {
    return Promise.reject(
      new AudioError('NOT_CONFIGURED', 'local whisper transcription is not implemented yet', {
        hint: 'Planned: run the detected CLI with a local model and assemble SRT cues. Nothing runs without a model + owner approval.',
      }),
    );
  }
}
