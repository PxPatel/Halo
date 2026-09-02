/**
 * Settings are zod-validated on read and on write, and fall back to defaults
 * on corruption (SPEC 11). The API key is deliberately absent: it lives in
 * secrets/keyStore.ts and never travels with Settings.
 */

import Store from 'electron-store';
import { z } from 'zod';
import { DEFAULT_HOTKEYS, MODELS, TUNING } from '../../shared/constants';
import type { Settings } from '../../shared/types';
import { log } from '../log';

const SettingsSchema = z.object({
  mode: z.enum(['off', 'manual', 'auto']),
  displayId: z.string().nullable(),
  scriptPath: z.string().nullable(),
  hotkeys: z.record(z.string(), z.string()),
  hud: z.object({
    opacity: z.number().min(0.2).max(1),
    fontSize: z.number().min(11).max(28),
    position: z.object({ x: z.number(), y: z.number() }),
  }),
  models: z.object({ classify: z.string().min(1), generate: z.string().min(1) }),
});

export const DEFAULT_SETTINGS: Settings = {
  mode: 'manual',
  displayId: null,
  scriptPath: null,
  hotkeys: { ...DEFAULT_HOTKEYS },
  hud: {
    opacity: TUNING.hud.idleOpacity,
    fontSize: 14,
    position: { x: 64, y: 64 },
  },
  models: { classify: MODELS.classify, generate: MODELS.generate },
};

type Listener = (settings: Settings) => void;

export class SettingsStore {
  private readonly store = new Store<{ settings: unknown }>({ name: 'halo-settings' });
  private readonly listeners = new Set<Listener>();
  private cached: Settings | null = null;

  /** False until the user's first write; used to seed a sensible HUD position. */
  hasStored(): boolean {
    return this.store.get('settings') !== undefined;
  }

  get(): Settings {
    if (this.cached) return this.cached;
    const parsed = SettingsSchema.safeParse(this.store.get('settings'));
    if (!parsed.success) {
      if (this.store.get('settings') !== undefined) {
        log.warn('settings', 'stored settings invalid, falling back to defaults');
      }
      this.cached = { ...DEFAULT_SETTINGS };
      return this.cached;
    }
    this.cached = parsed.data as Settings;
    return this.cached;
  }

  update(patch: Partial<Settings>): Settings {
    const merged: Settings = {
      ...this.get(),
      ...patch,
      hud: { ...this.get().hud, ...(patch.hud ?? {}) },
      hotkeys: { ...this.get().hotkeys, ...(patch.hotkeys ?? {}) },
      models: { ...this.get().models, ...(patch.models ?? {}) },
    };
    const parsed = SettingsSchema.safeParse(merged);
    if (!parsed.success) {
      log.warn('settings', `rejected invalid update: ${parsed.error.issues[0]?.message ?? ''}`);
      return this.get();
    }
    this.cached = parsed.data as Settings;
    this.store.set('settings', this.cached);
    for (const listener of this.listeners) listener(this.cached);
    return this.cached;
  }

  onChange(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}
