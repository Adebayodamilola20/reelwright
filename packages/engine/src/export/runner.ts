/** ffmpeg process runner: progress parsing, cancellation, temp-file promotion. */

import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, renameSync, rmSync } from 'node:fs';
import { EngineError, tail } from '../errors.js';
import { newId } from '../ids.js';
import { TICKS_PER_SECOND } from '../time.js';
import type { EngineEvents } from '../api.js';
import type { FfmpegJob } from './plan.js';

type Emit = <K extends keyof EngineEvents>(event: K, payload: EngineEvents[K]) => void;

interface RunningJob {
  child: ChildProcess;
  tempOutput: string;
  finalOutput: string;
  cancelling: boolean;
  durationSec: number;
  lastPercent: number;
  lastEmitMs: number;
}

export class ExportManager {
  private jobs = new Map<string, RunningJob>();

  constructor(private readonly emit: Emit, private readonly ffmpegPath: string) {}

  get runningCount(): number {
    return this.size();
  }

  private size(): number {
    return this.jobs.size;
  }

  /** Start an export job; progress/done/error/cancelled arrive via events. */
  start(job: FfmpegJob, finalOutput: string): { exportId: string } {
    if (this.jobs.size > 0) {
      fail2('BUSY', 'An export is already running.', 'Cancel it or wait for it to finish.');
    }
    const exportId = newId('exp');
    const child = spawn(this.ffmpegPath, job.args, { stdio: ['ignore', 'pipe', 'pipe'] });
    const state: RunningJob = {
      child,
      tempOutput: job.tempOutput,
      finalOutput,
      cancelling: false,
      durationSec: job.durationSec,
      lastPercent: -1,
      lastEmitMs: 0,
    };
    this.jobs.set(exportId, state);

    let stderr = '';
    let stdoutBuf = '';
    let lastFps: number | undefined;
    child.stderr.on('data', (d) => {
      stderr += String(d);
      if (stderr.length > 20000) stderr = stderr.slice(-20000);
    });
    child.stdout.on('data', (d) => {
      stdoutBuf += String(d);
      const lines = stdoutBuf.split('\n');
      stdoutBuf = lines.pop() ?? '';
      for (const line of lines) {
        const eq = line.indexOf('=');
        if (eq === -1) continue;
        const key = line.slice(0, eq).trim();
        const value = line.slice(eq + 1).trim();
        if (key === 'out_time_us' || key === 'out_time_ms') {
          const us = Number(value);
          if (!Number.isFinite(us) || us < 0) continue;
          const percent = Math.min(100, (us / 1e6 / state.durationSec) * 100);
          const now = Date.now();
          if (percent >= state.lastPercent + 0.5 || (now - state.lastEmitMs > 250 && percent > state.lastPercent)) {
            state.lastPercent = Math.round(percent * 10) / 10;
            state.lastEmitMs = now;
            this.emit('export:progress', {
              exportId,
              percent: state.lastPercent,
              outTimeTicks: Math.round((us / 1e6) * TICKS_PER_SECOND),
              ...(lastFps !== undefined && Number.isFinite(lastFps) ? { fps: lastFps } : {}),
            });
          }
        } else if (key === 'fps') {
          lastFps = Number(value); // folded into the next progress event
        }
      }
    });
    child.on('error', (e) => {
      this.jobs.delete(exportId);
      this.cleanupTemp(state);
      this.emit('export:error', {
        exportId,
        error: {
          code: 'FFMPEG_NOT_FOUND',
          message: `Could not run ffmpeg at "${this.ffmpegPath}": ${e.message}`,
          hint: 'Install ffmpeg or set VE_FFMPEG_PATH.',
        },
      });
    });
    child.on('close', (code, signal) => {
      this.jobs.delete(exportId);
      if (state.cancelling) {
        this.cleanupTemp(state);
        this.emit('export:cancelled', { exportId });
        return;
      }
      if (code === 0 && existsSync(state.tempOutput)) {
        try {
          renameSync(state.tempOutput, state.finalOutput);
          this.emit('export:progress', { exportId, percent: 100 });
          this.emit('export:done', { exportId, outputPath: state.finalOutput });
        } catch (e) {
          this.cleanupTemp(state);
          this.emit('export:error', {
            exportId,
            error: { code: 'IO_ERROR', message: `Could not finalize output "${state.finalOutput}": ${String(e)}` },
          });
        }
        return;
      }
      this.cleanupTemp(state);
      this.emit('export:error', {
        exportId,
        error: mapFfmpegFailure(code, signal, stderr),
      });
    });
    return { exportId };
  }

  /** Request cancellation; true if the job existed. */
  cancel(exportId: string): boolean {
    const state = this.jobs.get(exportId);
    if (!state) return false;
    state.cancelling = true;
    state.child.kill('SIGTERM');
    setTimeout(() => {
      if (this.jobs.get(exportId) === state) {
        try {
          state.child.kill('SIGKILL');
        } catch {
          // already gone
        }
      }
    }, 1500).unref();
    return true;
  }

  killAll(): void {
    for (const [id, state] of this.jobs) {
      state.cancelling = true;
      try {
        state.child.kill('SIGKILL');
      } catch {
        // already gone
      }
      this.jobs.delete(id);
      this.cleanupTemp(state);
    }
  }

  private cleanupTemp(state: RunningJob): void {
    try {
      if (existsSync(state.tempOutput)) rmSync(state.tempOutput, { force: true });
    } catch {
      // best effort
    }
  }
}

function fail2(code: EngineError['code'], message: string, hint?: string): never {
  throw new EngineError(code, message, hint);
}

function mapFfmpegFailure(code: number | null, signal: string | null, stderr: string): EngineEvents['export:error']['error'] {
  const detail = tail(stderr);
  if (/No such file|does not exist/i.test(detail)) {
    return { code: 'ASSET_MISSING', message: 'A media file disappeared during export.', hint: detail };
  }
  if (/Unknown encoder|Unknown demuxer|Encoder .* not found/i.test(detail)) {
    return { code: 'FFMPEG_NOT_FOUND', message: 'The local ffmpeg lacks a required codec.', hint: detail };
  }
  if (/Invalid argument|Error|Failed/i.test(detail) && /filter/i.test(detail)) {
    return { code: 'FFMPEG_FAILED', message: 'ffmpeg rejected the render graph.', hint: detail };
  }
  return {
    code: 'FFMPEG_FAILED',
    message: `ffmpeg exited with ${signal ? `signal ${signal}` : `code ${code}`} before finishing.`,
    hint: detail || 'No error output was captured.',
    details: { exitCode: code, signal },
  };
}
