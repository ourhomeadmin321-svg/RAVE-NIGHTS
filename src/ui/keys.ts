import { LASER_CUES } from '../lighting/cues';
import type { Panel, PanelApi } from './panel';

export interface KeyApi extends PanelApi {
  hazeBurst(): void;
  cameraCut(): void;
  nudgeEnergy(delta: number): void;
  nudgeTrip(delta: number): void;
}

const SCENE_KEYS: Record<string, number> = { KeyQ: 0, KeyW: 1, KeyE: 2 };

/**
 * Performance keyboard.
 *
 * SPACE and B are momentary — held, not toggled — because that is how a bash
 * button works on a real desk and because a strobe you have to remember to
 * switch off is a hazard. Every held key is also released on window blur, so
 * alt-tabbing mid-strobe cannot leave it stuck on.
 */
export function bindKeys(api: KeyApi, panel: Panel, sceneIds: string[]): () => void {
  const held = { strobe: false, blinder: false };

  const isTyping = (): boolean => {
    const a = document.activeElement;
    return !!a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || (a as HTMLElement).isContentEditable);
  };

  const syncBash = (): void => {
    api.manual().strobeBash = held.strobe;
    api.manual().blinderBash = held.blinder;
    panel.setBashVisual(held.strobe, held.blinder);
  };

  const down = (e: KeyboardEvent): void => {
    if (isTyping()) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;

    switch (e.code) {
      case 'Space':
        e.preventDefault();
        if (!e.repeat) {
          held.strobe = true;
          syncBash();
        }
        return;
      case 'KeyB':
        e.preventDefault();
        if (!e.repeat) {
          held.blinder = true;
          syncBash();
        }
        return;
    }

    if (e.repeat) return;

    // Laser cues on the number row.
    if (e.code.startsWith('Digit')) {
      const n = Number(e.code.slice(5));
      if (n >= 1 && n <= LASER_CUES.length) {
        e.preventDefault();
        const cue = LASER_CUES[n - 1];
        api.manual().laser = cue.name;
        api.toast(`laser: ${cue.name}`);
        return;
      }
    }

    if (e.code in SCENE_KEYS) {
      const idx = SCENE_KEYS[e.code];
      if (idx < sceneIds.length) {
        e.preventDefault();
        api.setScene(sceneIds[idx]);
        panel.refresh();
      }
      return;
    }

    switch (e.code) {
      case 'KeyD':
        api.forceSection('drop');
        api.toast('drop armed — lands on the next bar');
        break;
      case 'KeyX':
        api.forceSection('breakdown');
        api.toast('breakdown armed');
        break;
      case 'KeyC':
        api.cameraCut();
        break;
      case 'KeyH':
        api.hazeBurst();
        api.toast('haze burst');
        break;
      case 'KeyM':
        api.setManualEnabled(!api.manual().enabled);
        panel.refresh();
        break;
      case 'KeyP':
        api.togglePlay();
        panel.refresh();
        break;
      case 'ArrowUp':
        e.preventDefault();
        api.nudgeEnergy(0.08);
        panel.refresh();
        break;
      case 'ArrowDown':
        e.preventDefault();
        api.nudgeEnergy(-0.08);
        panel.refresh();
        break;
      case 'ArrowRight':
        e.preventDefault();
        api.nudgeTrip(0.12);
        panel.refresh();
        break;
      case 'ArrowLeft':
        e.preventDefault();
        api.nudgeTrip(-0.12);
        panel.refresh();
        break;
      case 'KeyF':
        if (document.fullscreenElement) void document.exitFullscreen();
        else void document.documentElement.requestFullscreen().catch(() => undefined);
        break;
      case 'Tab':
        e.preventDefault();
        panel.toggleVisibility();
        break;
    }
  };

  const up = (e: KeyboardEvent): void => {
    if (e.code === 'Space') {
      held.strobe = false;
      syncBash();
    } else if (e.code === 'KeyB') {
      held.blinder = false;
      syncBash();
    }
  };

  const blur = (): void => {
    held.strobe = false;
    held.blinder = false;
    syncBash();
    panel.releaseAllBashes();
  };

  window.addEventListener('keydown', down);
  window.addEventListener('keyup', up);
  window.addEventListener('blur', blur);

  return () => {
    window.removeEventListener('keydown', down);
    window.removeEventListener('keyup', up);
    window.removeEventListener('blur', blur);
  };
}
