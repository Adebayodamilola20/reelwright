import { randomUUID } from 'node:crypto';

/** Opaque id generation. Prefixes aid debugging only; never parse ids. */
export function newId(prefix: string): string {
  return `${prefix}_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
}
