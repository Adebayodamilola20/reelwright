/**
 * Immutable-snapshot store with undo/redo (see contract "Undo/redo model").
 * The ProjectFile held here must be treated as read-only by callers;
 * all mutations go through transact() with a draft.
 */

import { fail } from '../errors.js';
import type { ProjectFile } from '../types.js';
import type { ChangeReason } from '../api.js';

export interface StoreChange {
  revision: number;
  reason: ChangeReason;
}

export class ProjectStore {
  private project: ProjectFile | null = null;
  private past: ProjectFile[] = [];
  private future: ProjectFile[] = [];
  private batchDepth = 0;
  private batchBase: ProjectFile | null = null;
  private savedSnapshot: ProjectFile | null = null;
  private revisionCounter = 0;

  onChange: ((change: StoreChange) => void) | null = null;

  constructor(private readonly historyLimit = 100) {}

  get revision(): number {
    return this.revisionCounter;
  }

  get dirty(): boolean {
    return this.project !== null && this.project !== this.savedSnapshot;
  }

  get inBatch(): boolean {
    return this.batchDepth > 0;
  }

  isOpen(): boolean {
    return this.project !== null;
  }

  tryGet(): ProjectFile | null {
    return this.project;
  }

  get(): ProjectFile {
    if (!this.project) fail('NOT_FOUND', 'No project is open.');
    return this.project;
  }

  load(project: ProjectFile): void {
    this.project = project;
    this.past = [];
    this.future = [];
    this.batchDepth = 0;
    this.batchBase = null;
    this.savedSnapshot = project;
    this.revisionCounter = 0;
    this.emit('load');
  }

  clear(): void {
    this.project = null;
    this.past = [];
    this.future = [];
    this.batchDepth = 0;
    this.batchBase = null;
    this.savedSnapshot = null;
    this.revisionCounter = 0;
  }

  /** Call after persisting the current state to disk. */
  markSaved(): void {
    this.savedSnapshot = this.project;
  }

  /**
   * Apply a mutation to a draft of the project. On throw, nothing changes
   * and history is untouched. Creates one undo entry unless inside a batch.
   */
  transact<T>(mutator: (draft: ProjectFile) => T): T {
    const base = this.get();
    const draft = structuredClone(base);
    const result = mutator(draft);
    if (this.batchDepth === 0) {
      this.past.push(base);
      if (this.past.length > this.historyLimit) this.past.shift();
      this.future = [];
    }
    this.project = draft;
    this.revisionCounter += 1;
    this.emit('op');
    return result;
  }

  /**
   * Bookkeeping mutation that must NOT create an undo entry, bump revision,
   * or affect dirty state (e.g. syncing source.relPath at save time).
   */
  update(mutator: (draft: ProjectFile) => void): void {
    if (!this.project) return;
    const draft = structuredClone(this.project);
    mutator(draft);
    if (this.savedSnapshot === this.project) this.savedSnapshot = draft;
    this.project = draft;
  }

  undo(): boolean {
    if (this.batchDepth > 0) fail('BUSY', 'Cannot undo while a batch (gesture) is open.');
    if (this.past.length === 0) return false;
    this.future.push(this.get());
    this.project = this.past.pop() ?? null;
    this.revisionCounter += 1;
    this.emit('undo');
    return true;
  }

  redo(): boolean {
    if (this.batchDepth > 0) fail('BUSY', 'Cannot redo while a batch (gesture) is open.');
    if (this.future.length === 0) return false;
    this.past.push(this.get());
    this.project = this.future.pop() ?? null;
    this.revisionCounter += 1;
    this.emit('redo');
    return true;
  }

  canUndo(): boolean {
    return this.batchDepth === 0 && this.past.length > 0;
  }

  canRedo(): boolean {
    return this.batchDepth === 0 && this.future.length > 0;
  }

  beginBatch(): void {
    if (this.batchDepth++ === 0) this.batchBase = this.project;
  }

  endBatch(): void {
    if (this.batchDepth === 0) fail('INTERNAL', 'endBatch() without beginBatch().');
    if (--this.batchDepth === 0) {
      const base = this.batchBase;
      this.batchBase = null;
      if (base && this.project && base !== this.project) {
        this.past.push(base);
        if (this.past.length > this.historyLimit) this.past.shift();
        this.future = [];
      }
    }
  }

  private emit(reason: ChangeReason): void {
    this.onChange?.({ revision: this.revisionCounter, reason });
  }
}
