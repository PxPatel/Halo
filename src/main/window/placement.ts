/** Move, opacity, click-through and focus toggling. No view logic. */

import { screen, type BrowserWindow } from 'electron';
import { PILL_SIZE, TUNING } from '../../shared/constants';

const MOVE_STEP = 24;

export function clampToDisplay(win: BrowserWindow, x: number, y: number): { x: number; y: number } {
  const bounds = win.getBounds();
  const area = screen.getDisplayMatching(bounds).workArea;
  return {
    x: Math.round(Math.min(Math.max(x, area.x), area.x + area.width - bounds.width)),
    y: Math.round(Math.min(Math.max(y, area.y), area.y + area.height - bounds.height)),
  };
}

export function moveBy(win: BrowserWindow, dx: number, dy: number): { x: number; y: number } {
  const bounds = win.getBounds();
  const next = clampToDisplay(win, bounds.x + dx * MOVE_STEP, bounds.y + dy * MOVE_STEP);
  win.setPosition(next.x, next.y);
  return next;
}

export function setOpacity(win: BrowserWindow, value: number): number {
  const clamped = Math.min(1, Math.max(0.2, value));
  win.setOpacity(clamped);
  return clamped;
}

/**
 * The prompt bar is the only focusable surface (SPEC 5). Everywhere else the
 * HUD is click-through so it cannot intercept the user's real work.
 */
export function setInteractive(win: BrowserWindow, interactive: boolean): void {
  win.setIgnoreMouseEvents(!interactive, { forward: true });
  win.setFocusable(interactive);
  if (interactive) win.focus();
  else win.blur();
}

export function defaultPosition(): { x: number; y: number } {
  const area = screen.getPrimaryDisplay().workArea;
  return {
    x: area.x + area.width - TUNING.hud.cardWidth - 32,
    y: area.y + 48,
  };
}

export function pillBounds(): { width: number; height: number } {
  return { width: PILL_SIZE.width, height: PILL_SIZE.height };
}
