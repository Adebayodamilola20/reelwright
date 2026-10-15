/**
 * Error type for @ve/audio.
 *
 * Codes mirror the contract's EngineErrorShape codes where they overlap so the
 * engine can re-throw or surface them across the IPC boundary without mapping
 * tables (docs/PROJECT_CONTRACT.md "Export contract" / "Engine ↔ UI boundary").
 */

export type AudioErrorCode =
  | 'INVALID_ARGUMENT'
  | 'UNSUPPORTED_FEATURE'
  | 'FFMPEG_NOT_FOUND'
  | 'FFMPEG_FAILED'
  | 'IO_ERROR'
  | 'NOT_CONFIGURED';

export interface AudioErrorShape {
  code: AudioErrorCode;
  message: string;
  hint?: string;
  details?: unknown;
}

export class AudioError extends Error {
  readonly code: AudioErrorCode;
  readonly hint?: string;
  readonly details?: unknown;

  constructor(
    code: AudioErrorCode,
    message: string,
    opts: { hint?: string; details?: unknown } | string = {},
  ) {
    super(message);
    this.name = 'AudioError';
    this.code = code;
    const normalized = typeof opts === 'string' ? { hint: opts } : opts;
    this.hint = normalized.hint;
    this.details = normalized.details;
  }

  toShape(): AudioErrorShape {
    const shape: AudioErrorShape = { code: this.code, message: this.message };
    if (this.hint !== undefined) shape.hint = this.hint;
    if (this.details !== undefined) shape.details = this.details;
    return shape;
  }
}

/** Shape an AudioError-like object without throwing (for result unions). */
export function audioErrorShape(
  code: AudioErrorCode,
  message: string,
  hint?: string,
  details?: unknown,
): AudioErrorShape {
  const shape: AudioErrorShape = { code, message };
  if (hint !== undefined) shape.hint = hint;
  if (details !== undefined) shape.details = details;
  return shape;
}
