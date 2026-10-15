/** Error model — errors always cross the engine↔UI boundary as EngineErrorShape. */

export type EngineErrorCode =
  | 'FFMPEG_NOT_FOUND'
  | 'FFMPEG_FAILED'
  | 'ASSET_MISSING'
  | 'UNSUPPORTED_FEATURE'
  | 'INVALID_ARGUMENT'
  | 'OVERLAP'
  | 'IO_ERROR'
  | 'NOT_FOUND'
  | 'BUSY'
  | 'NOT_CONFIGURED'
  | 'INTERNAL';

export interface EngineErrorShape {
  code: EngineErrorCode;
  message: string;
  hint?: string;
  details?: unknown;
}

export class EngineError extends Error {
  readonly code: EngineErrorCode;
  readonly hint?: string;
  readonly details?: unknown;

  constructor(code: EngineErrorCode, message: string, hint?: string, details?: unknown) {
    super(message);
    this.name = 'EngineError';
    this.code = code;
    this.hint = hint;
    this.details = details;
  }

  toShape(): EngineErrorShape {
    const shape: EngineErrorShape = { code: this.code, message: this.message };
    if (this.hint !== undefined) shape.hint = this.hint;
    if (this.details !== undefined) shape.details = this.details;
    return shape;
  }
}

/** Normalize any thrown value into the wire-safe error shape. */
export function toErrorShape(err: unknown): EngineErrorShape {
  if (err instanceof EngineError) return err.toShape();
  if (err instanceof Error) return { code: 'INTERNAL', message: err.message };
  return { code: 'INTERNAL', message: String(err) };
}

/** Helper for throwing engine errors. */
export function fail(code: EngineErrorCode, message: string, hint?: string, details?: unknown): never {
  throw new EngineError(code, message, hint, details);
}

/** Last portion of process output, for actionable ffmpeg error messages. */
export function tail(text: string, maxChars = 2000): string {
  const t = text.trim();
  return t.length <= maxChars ? t : t.slice(-maxChars);
}
