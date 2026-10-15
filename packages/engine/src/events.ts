/** Minimal typed event emitter (no dependencies). */

export type Listener<T> = (payload: T) => void;

export class Emitter<E extends object> {
  private listeners = new Map<keyof E, Set<Listener<never>>>();

  on<K extends keyof E>(event: K, cb: Listener<E[K]>): () => void {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(cb as Listener<never>);
    return () => {
      set!.delete(cb as Listener<never>);
    };
  }

  emit<K extends keyof E>(event: K, payload: E[K]): void {
    const set = this.listeners.get(event);
    if (!set) return;
    for (const cb of [...set]) {
      try {
        (cb as Listener<E[K]>)(payload);
      } catch {
        // Listener errors must never break the engine.
      }
    }
  }

  removeAll(): void {
    this.listeners.clear();
  }
}
