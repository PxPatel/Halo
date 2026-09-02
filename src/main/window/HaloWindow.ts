/**
 * BrowserWindow construction and OS flags (SPEC 6). The HUD is frameless,
 * transparent, click-through, unfocusable and excluded from capture; the
 * capture renderer is a hidden window that owns the MediaStream so the frame
 * pipeline survives the HUD being hidden.
 */

import { BrowserWindow, screen } from 'electron';
import { join } from 'node:path';
import { TUNING } from '../../shared/constants';
import type { Settings } from '../../shared/types';
import { CAPTURE_FLAG } from '../../shared/ipc';
import { applyProtection, type ProtectionReport } from './protection';

const isDev = !!process.env['ELECTRON_RENDERER_URL'];

function rendererEntry(name: 'hud' | 'capture-renderer'): { url?: string; file?: string } {
  const devUrl = process.env['ELECTRON_RENDERER_URL'];
  if (devUrl) return { url: `${devUrl}/${name}/index.html` };
  return { file: join(__dirname, `../renderer/${name}/index.html`) };
}

function load(win: BrowserWindow, name: 'hud' | 'capture-renderer'): void {
  const entry = rendererEntry(name);
  if (entry.url) void win.loadURL(entry.url);
  else void win.loadFile(entry.file!);
}

export interface HudWindow {
  win: BrowserWindow;
  protection: ProtectionReport;
}

export function createHudWindow(settings: Settings): HudWindow {
  const work = screen.getPrimaryDisplay().workArea;
  const height = Math.round(work.height * TUNING.hud.maxCardHeightPct) + 140;
  const position = settings.hud.position;

  const win = new BrowserWindow({
    width: TUNING.hud.cardWidth,
    height,
    x: position.x,
    y: position.y,
    frame: false,
    transparent: true,
    resizable: false,
    skipTaskbar: true,
    focusable: false,
    alwaysOnTop: true,
    hasShadow: false,
    show: false,
    type: 'toolbar',
    backgroundColor: '#00000000',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      devTools: isDev,
    },
  });

  const protection = applyProtection(win);
  win.setIgnoreMouseEvents(true, { forward: true });
  win.setOpacity(settings.hud.opacity);
  win.once('ready-to-show', () => win.showInactive());
  load(win, 'hud');

  return { win, protection };
}

/** Hidden, never shown, never protected: it renders nothing. */
export function createCaptureWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 320,
    height: 240,
    show: false,
    skipTaskbar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      additionalArguments: [CAPTURE_FLAG],
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
      devTools: isDev,
    },
  });
  load(win, 'capture-renderer');
  return win;
}
