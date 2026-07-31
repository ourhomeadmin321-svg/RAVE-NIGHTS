import { describe, expect, it } from 'vitest';
import { Arrangement, DEFAULT_CYCLE } from '../src/audio/arrangement';
import type { Section } from '../src/core/types';

/** Walk the arrangement bar by bar and record the section at each bar. */
function walk(a: Arrangement, bars: number): Section[] {
  const out: Section[] = [];
  for (let bar = 0; bar < bars; bar++) out.push(a.update(bar).section);
  return out;
}

describe('Arrangement', () => {
  it('holds each section for exactly its declared length', () => {
    const a = new Arrangement();
    const sections = walk(a, 120);

    let bar = 0;
    for (const step of DEFAULT_CYCLE) {
      for (let i = 0; i < step.bars && bar < sections.length; i++, bar++) {
        expect(sections[bar]).toBe(step.section);
      }
    }
  });

  it('loops back to the start of the cycle', () => {
    const a = new Arrangement();
    const total = DEFAULT_CYCLE.reduce((sum, s) => sum + s.bars, 0);
    const sections = walk(a, total + 4);
    expect(sections[total]).toBe(DEFAULT_CYCLE[0].section);
  });

  it('counts down bars to the next section', () => {
    const a = new Arrangement([{ section: 'build', bars: 4 }, { section: 'drop', bars: 4 }]);
    expect(a.update(0).barsToNext).toBe(4);
    expect(a.update(1).barsToNext).toBe(3);
    expect(a.update(3).barsToNext).toBe(1);
    // The bar after the countdown reaches 1 is the new section.
    expect(a.update(4).section).toBe('drop');
  });

  it('is idempotent when called repeatedly with the same bar', () => {
    const a = new Arrangement();
    a.update(5);
    const first = a.update(5);
    const second = a.update(5);
    expect(second).toEqual(first);
  });

  it('defers a forced jump to the next bar line', () => {
    const a = new Arrangement();
    a.update(3);
    a.force('drop');
    // Still in the old section until a bar boundary is crossed.
    expect(a.state().section).toBe('intro');
    expect(a.update(4).section).toBe('drop');
  });

  it('reports a forced jump as one bar away while it is pending', () => {
    const a = new Arrangement();
    a.update(2);
    a.force('breakdown');
    expect(a.state().barsToNext).toBe(1);
    expect(a.state().nextSection).toBe('breakdown');
  });

  it('restarts the jumped-to section rather than resuming it mid-way', () => {
    const a = new Arrangement();
    a.update(2);
    a.force('drop');
    const s = a.update(3);
    expect(s.section).toBe('drop');
    expect(s.barsIn).toBe(0);
  });

  it('emits one change event per transition', () => {
    const a = new Arrangement([{ section: 'intro', bars: 2 }, { section: 'drop', bars: 2 }]);
    const seen: Section[] = [];
    a.onSectionChange((s) => seen.push(s.section));
    for (let bar = 0; bar <= 8; bar++) a.update(bar);
    expect(seen).toEqual(['drop', 'intro', 'drop', 'intro']);
  });

  it('re-anchors instead of spinning when the transport rewinds', () => {
    const a = new Arrangement();
    a.update(40);
    const s = a.update(0);
    expect(s.section).toBe(DEFAULT_CYCLE[0].section);
    expect(s.barsIn).toBe(0);
  });

  it('lands a jump forced before the first bar on bar 1', () => {
    // How the app opens: the synth forces a drop at start-up so the first one
    // arrives seconds in rather than 83 seconds in. Bar 0 stays the intro and
    // the jump takes effect on the very next bar line.
    const a = new Arrangement();
    a.force('drop');
    expect(a.update(0).section).toBe('intro');
    const s = a.update(1);
    expect(s.section).toBe('drop');
    expect(s.barsIn).toBe(0);
  });

  it('runs the normal cycle after an opening jump', () => {
    const a = new Arrangement();
    a.force('drop');
    for (let bar = 0; bar <= 1; bar++) a.update(bar);
    // The drop is 16 bars in the default cycle, then a breakdown follows.
    expect(a.update(16).section).toBe('drop');
    expect(a.update(17).section).toBe('breakdown');
  });

  it('rejects an empty cycle', () => {
    expect(() => new Arrangement([])).toThrow();
  });
});
