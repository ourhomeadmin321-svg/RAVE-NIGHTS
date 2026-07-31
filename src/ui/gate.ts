import { el } from './dom';

/**
 * Entry gate.
 *
 * It serves two purposes at once. Browsers will not start an AudioContext
 * without a user gesture, so something like this is required anyway — and this
 * app flashes hard enough that a photosensitivity warning is not optional. The
 * reduce-flashing switch is pre-ticked when the system asks for reduced motion,
 * so a user who has already stated that preference never sees a full-rate
 * strobe without opting in.
 */
export function showGate(onEnter: (reduceFlashing: boolean) => void): void {
  const prefersReduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

  const gate = el('div', 'gate');
  const inner = el('div', 'gate-inner');

  inner.appendChild(el('h1', undefined, 'RAVE NIGHTS'));
  inner.appendChild(el('div', 'tag', 'INTERACTIVE CLUB SIMULATOR'));

  const warn = el('div', 'warning');
  warn.appendChild(el('strong', undefined, '⚠ PHOTOSENSITIVITY WARNING'));
  warn.appendChild(
    el(
      'div',
      undefined,
      'This experience contains sustained strobe lighting, rapid flashing and high-contrast ' +
        'flicker, which may trigger seizures in people with photosensitive epilepsy. If you are ' +
        'affected by flashing light, enable reduced flashing below — it caps the strobe rate and ' +
        'flattens the contrast. You can change it at any time from the console.',
    ),
  );
  inner.appendChild(warn);

  const reduceRow = el('label', 'warning');
  reduceRow.style.display = 'flex';
  reduceRow.style.gap = '10px';
  reduceRow.style.alignItems = 'center';
  reduceRow.style.cursor = 'pointer';
  const check = el('input');
  check.type = 'checkbox';
  check.checked = prefersReduced;
  check.style.width = '18px';
  check.style.height = '18px';
  check.style.accentColor = '#ffcc33';
  reduceRow.append(check, el('span', undefined, 'Reduce flashing'));
  inner.appendChild(reduceRow);

  const enter = el('button', 'enter', 'ENTER THE ROOM');
  enter.type = 'button';
  inner.appendChild(enter);

  inner.appendChild(
    el(
      'div',
      'hint',
      'Headphones or a decent speaker recommended — most of the low end is below 60Hz. ' +
        'Drag to look around, scroll to zoom, TAB hides the interface.',
    ),
  );

  const fail = el('div', 'fail');
  inner.appendChild(fail);

  const start = (): void => {
    try {
      onEnter(check.checked);
      gate.remove();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      fail.textContent = `Could not start: ${message}`;
      console.error(err);
    }
  };

  enter.addEventListener('click', start);
  gate.appendChild(inner);
  document.body.appendChild(gate);
  enter.focus();
}
