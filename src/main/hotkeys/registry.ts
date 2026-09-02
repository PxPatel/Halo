/**
 * Global hotkeys (SPEC 10). Every binding is remappable from settings, and a
 * registration that loses to another app is surfaced rather than swallowed.
 */

import { globalShortcut } from 'electron';
import { DEFAULT_HOTKEYS } from '../../shared/constants';
import { log } from '../log';

export type HotkeyAction = keyof typeof DEFAULT_HOTKEYS;

export type HotkeyHandlers = Partial<Record<string, () => void>>;

export interface HotkeyFailure {
  action: string;
  accelerator: string;
  reason: string;
}

export class HotkeyRegistry {
  private failures: HotkeyFailure[] = [];

  /** Returns the bindings that could not be registered. */
  apply(bindings: Record<string, string>, handlers: HotkeyHandlers): HotkeyFailure[] {
    this.unregisterAll();
    const merged = { ...DEFAULT_HOTKEYS, ...bindings };
    for (const [action, accelerator] of Object.entries(merged)) {
      const handler = handlers[action];
      if (!handler || !accelerator) continue;
      try {
        const ok = globalShortcut.register(accelerator, handler);
        if (!ok) {
          this.failures.push({ action, accelerator, reason: 'already held by another app' });
        }
      } catch (error) {
        this.failures.push({ action, accelerator, reason: String(error) });
      }
    }
    for (const failure of this.failures) {
      log.warn('hotkeys', `${failure.action} (${failure.accelerator}): ${failure.reason}`);
    }
    return this.failures;
  }

  get conflicts(): HotkeyFailure[] {
    return this.failures;
  }

  unregisterAll(): void {
    globalShortcut.unregisterAll();
    this.failures = [];
  }
}
