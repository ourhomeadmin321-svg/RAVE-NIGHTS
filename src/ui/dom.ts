/** Tiny DOM builders. Enough structure to keep panel.ts readable, no more. */

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const n = document.createElement(tag);
  if (className) n.className = className;
  if (text !== undefined) n.textContent = text;
  return n;
}

export function row(labelText?: string): { root: HTMLDivElement; value: HTMLSpanElement } {
  const root = el('div', 'row');
  const value = el('span', 'value');
  if (labelText !== undefined) {
    const label = el('div', 'label', labelText);
    label.appendChild(value);
    root.appendChild(label);
  }
  return { root, value };
}

export interface ChipGroup<T extends string> {
  root: HTMLDivElement;
  set(value: T): void;
}

/** Radio-style chips. `format` renders the visible label. */
export function chips<T extends string>(
  options: readonly T[],
  initial: T,
  onChange: (v: T) => void,
  format: (v: T) => string = (v) => v.toUpperCase(),
): ChipGroup<T> {
  const root = el('div', 'group');
  const buttons = new Map<T, HTMLButtonElement>();
  let current = initial;

  const set = (value: T): void => {
    current = value;
    for (const [key, btn] of buttons) btn.setAttribute('aria-pressed', String(key === value));
  };

  for (const opt of options) {
    const b = el('button', 'chip', format(opt));
    b.type = 'button';
    b.addEventListener('click', () => {
      if (current !== opt) {
        set(opt);
        onChange(opt);
      }
    });
    buttons.set(opt, b);
    root.appendChild(b);
  }
  set(initial);
  return { root, set };
}

export interface SliderControl {
  root: HTMLDivElement;
  input: HTMLInputElement;
  set(value: number): void;
}

export function slider(
  label: string,
  min: number,
  max: number,
  step: number,
  initial: number,
  onInput: (v: number) => void,
  format: (v: number) => string = (v) => v.toFixed(2),
  onGrabChange?: (held: boolean) => void,
): SliderControl {
  const { root, value } = row(label);
  const input = el('input');
  input.type = 'range';
  input.min = String(min);
  input.max = String(max);
  input.step = String(step);
  input.value = String(initial);
  value.textContent = format(initial);

  input.addEventListener('input', () => {
    const v = Number(input.value);
    value.textContent = format(v);
    onInput(v);
  });
  if (onGrabChange) {
    input.addEventListener('pointerdown', () => onGrabChange(true));
    const release = (): void => onGrabChange(false);
    input.addEventListener('pointerup', release);
    input.addEventListener('pointercancel', release);
    input.addEventListener('blur', release);
  }

  root.appendChild(input);
  return {
    root,
    input,
    set(v: number) {
      input.value = String(v);
      value.textContent = format(v);
    },
  };
}

export function toggleChip(
  label: string,
  initial: boolean,
  onChange: (v: boolean) => void,
  danger = false,
): { root: HTMLButtonElement; set(v: boolean): void } {
  const b = el('button', `chip wide${danger ? ' danger' : ''}`, label);
  b.type = 'button';
  let state = initial;
  const set = (v: boolean): void => {
    state = v;
    b.setAttribute('aria-pressed', String(v));
  };
  set(initial);
  b.addEventListener('click', () => {
    set(!state);
    onChange(state);
  });
  return { root: b, set };
}

/**
 * Momentary button: active only while held. Pointer capture plus a global
 * pointerup means dragging off the button still releases it — otherwise a
 * strobe can get stuck on, which is exactly the failure you do not want in an
 * app full of flashing lights.
 */
export function bashButton(
  label: string,
  onChange: (held: boolean) => void,
): { root: HTMLButtonElement; release(): void } {
  const b = el('button', 'chip bash', label);
  b.type = 'button';
  let held = false;

  const press = (e: PointerEvent): void => {
    e.preventDefault();
    if (held) return;
    held = true;
    b.classList.add('active');
    onChange(true);
  };
  const release = (): void => {
    if (!held) return;
    held = false;
    b.classList.remove('active');
    onChange(false);
  };

  b.addEventListener('pointerdown', press);
  b.addEventListener('pointerup', release);
  b.addEventListener('pointercancel', release);
  b.addEventListener('pointerleave', release);
  window.addEventListener('pointerup', release);
  window.addEventListener('blur', release);

  return { root: b, release };
}
