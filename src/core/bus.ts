import type { GenreId, Section } from './types';

/** Events that cross module boundaries. Keep this list small and deliberate. */
export interface AppEvents {
  'transport:bar': { bar: number };
  'transport:beat': { bar: number; beat: number };
  'arrangement:section': { section: Section; bar: number };
  'arrangement:armed': { section: Section; barsAway: number };
  'genre:change': { genre: GenreId };
  'scene:change': { scene: string };
  'director:cue': { name: string };
  'audio:started': Record<string, never>;
  'error': { message: string };
}

type Handler<K extends keyof AppEvents> = (payload: AppEvents[K]) => void;

export class EventBus {
  private handlers = new Map<keyof AppEvents, Set<(p: never) => void>>();

  on<K extends keyof AppEvents>(event: K, fn: Handler<K>): () => void {
    let set = this.handlers.get(event);
    if (!set) {
      set = new Set();
      this.handlers.set(event, set);
    }
    set.add(fn as (p: never) => void);
    return () => set!.delete(fn as (p: never) => void);
  }

  emit<K extends keyof AppEvents>(event: K, payload: AppEvents[K]): void {
    const set = this.handlers.get(event);
    if (!set) return;
    for (const fn of set) {
      try {
        (fn as Handler<K>)(payload);
      } catch (err) {
        // A listener throwing must never take down the audio or render loop.
        console.error(`[bus] handler for "${String(event)}" threw`, err);
      }
    }
  }
}

export const bus = new EventBus();
