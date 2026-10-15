/**
 * Error model — wire-compatible with the engine's EngineErrorShape
 * (docs/PROJECT_CONTRACT.md). This package throws `EffectsError`; callers can
 * cross it over any boundary via `toShape()` without losing the honest reason.
 */

export type EffectsErrorCode =
  | 'FFMPEG_NOT_FOUND'
  | 'UNSUPPORTED_FEATURE'
  | 'INVALID_ARGUMENT'
  | 'NOT_FOUND'
  | 'INTERNAL';

export interface EffectsErrorShape {
  code: EffectsErrorCode;
  message: string;
  hint?: string;
  details?: unknown;
}

export class EffectsError extends Error {
  readonly code: EffectsErrorCode;
  readonly hint?: string;
  readonly details?: unknown;

  constructor(code: EffectsErrorCode, message: string, hint?: string, details?: unknown) {
    super(message);
    this.name = 'EffectsError';
    this.code = code;
    this.hint = hint;
    this.details = details;
  }

  toShape(): EffectsErrorShape {
    const shape: EffectsErrorShape = { code: this.code, message: this.message };
    if (this.hint !== undefined) shape.hint = this.hint;
    if (this.details !== undefined) shape.details = this.details;
    return shape;
  }
}

export function toEffectsErrorShape(err: unknown): EffectsErrorShape {
  if (err instanceof EffectsError) return err.toShape();
  if (err instanceof Error) return { code: 'INTERNAL', message: err.message };
  return { code: 'INTERNAL', message: String(err) };
}

/** Honest-failure helper: throw with a code + actionable hint. */
export function fail(
  code: EffectsErrorCode,
  message: string,
  hint?: string,
  details?: unknown,
): never {
  throw new EffectsError(code, message, hint, details);
}
