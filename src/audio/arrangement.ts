import type { Section } from '../core/types';

export interface ArrangementStep {
  section: Section;
  bars: number;
}

/**
 * The default set shape. Everything is phrase-aligned (8/16/32 bars), which is
 * how dance music is actually written and what lets a lighting operator know
 * where the drop is before it lands.
 *
 * The second drop is deliberately twice the length of the first — the standard
 * way a track develops extra energy on the return rather than just repeating.
 */
export const DEFAULT_CYCLE: readonly ArrangementStep[] = [
  { section: 'intro', bars: 16 },
  { section: 'build', bars: 16 },
  { section: 'drop', bars: 16 },
  { section: 'breakdown', bars: 16 },
  { section: 'build', bars: 8 },
  { section: 'drop', bars: 32 },
  { section: 'outro', bars: 8 },
];

export interface ArrangementState {
  section: Section;
  /** Bar the current section started on. */
  startBar: number;
  /** Bars elapsed within the current section. */
  barsIn: number;
  /** Bars until the next section begins. */
  barsToNext: number;
  /** Progress through the current section, 0..1. */
  progress: number;
  /** The section that comes next. */
  nextSection: Section;
}

/**
 * Section state machine driven by bar boundaries.
 *
 * Sections only ever change on a bar line, and a user-forced jump is queued
 * until the next one, so hitting DROP mid-bar lands musically instead of
 * tearing the groove. `barsToNext` is the field the lighting director cares
 * about most: it is what lets it arm a cue and fire it exactly on the drop.
 */
export class Arrangement {
  private cycle: readonly ArrangementStep[];
  private index = 0;
  private startBar = 0;
  private currentBar = 0;
  private pending: Section | null = null;
  private listeners: Array<(s: ArrangementState) => void> = [];

  constructor(cycle: readonly ArrangementStep[] = DEFAULT_CYCLE) {
    if (cycle.length === 0) throw new Error('Arrangement cycle must not be empty');
    this.cycle = cycle;
  }

  onSectionChange(fn: (s: ArrangementState) => void): () => void {
    this.listeners.push(fn);
    return () => {
      this.listeners = this.listeners.filter((f) => f !== fn);
    };
  }

  /** Swap the arrangement shape (e.g. on genre change) without losing position. */
  setCycle(cycle: readonly ArrangementStep[]): void {
    if (cycle.length === 0) return;
    this.cycle = cycle;
    this.index = Math.min(this.index, cycle.length - 1);
  }

  reset(atBar = 0): void {
    this.index = 0;
    this.startBar = atBar;
    this.currentBar = atBar;
    this.pending = null;
  }

  /**
   * Request a jump to a section. It takes effect at the next bar boundary, so
   * a mid-bar button press still lands on the beat.
   */
  force(section: Section): void {
    this.pending = section;
  }

  get hasPendingJump(): boolean {
    return this.pending !== null;
  }

  /**
   * Advance to `bar`. Safe to call every frame with the same value — section
   * changes fire once per transition.
   */
  update(bar: number): ArrangementState {
    if (bar < this.currentBar) {
      // Transport rewound (reset/seek); re-anchor rather than spinning.
      this.reset(bar);
      return this.state();
    }

    while (this.currentBar < bar) {
      this.currentBar++;
      if (this.pending !== null) {
        this.jumpTo(this.pending, this.currentBar);
        this.pending = null;
        this.notify();
      } else if (this.currentBar - this.startBar >= this.currentStep.bars) {
        this.index = (this.index + 1) % this.cycle.length;
        this.startBar = this.currentBar;
        this.notify();
      }
    }
    return this.state();
  }

  state(): ArrangementState {
    const step = this.currentStep;
    const barsIn = this.currentBar - this.startBar;
    const barsToNext = Math.max(0, step.bars - barsIn);
    return {
      section: step.section,
      startBar: this.startBar,
      barsIn,
      barsToNext: this.pending !== null ? 1 : barsToNext,
      progress: step.bars > 0 ? Math.min(1, barsIn / step.bars) : 1,
      nextSection: this.pending ?? this.cycle[(this.index + 1) % this.cycle.length].section,
    };
  }

  private get currentStep(): ArrangementStep {
    return this.cycle[this.index];
  }

  private jumpTo(section: Section, atBar: number): void {
    const found = this.cycle.findIndex((s) => s.section === section);
    this.index = found >= 0 ? found : 0;
    this.startBar = atBar;
  }

  private notify(): void {
    const s = this.state();
    for (const fn of this.listeners) fn(s);
  }
}
