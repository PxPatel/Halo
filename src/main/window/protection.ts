/**
 * Every OS-level flag that makes Halo invisible to capture lives here, and
 * nothing else touches window styles (SPEC 6).
 *
 * Two mechanisms, both required:
 *   setContentProtection(true) -> WDA_EXCLUDEFROMCAPTURE, hides the pixels.
 *   type: 'toolbar'            -> WS_EX_TOOLWINDOW, hides the *entry* from
 *                                 Alt-Tab and from window-share pickers.
 * Missing the second is the most likely V1 failure.
 */

import type { BrowserWindow } from 'electron';
import { release } from 'node:os';
import { MIN_WINDOWS_BUILD } from '../../shared/constants';
import { log } from '../log';

export interface ProtectionReport {
  supported: boolean;
  protectionVerified: boolean;
  build: number | null;
  message?: string;
}

/** `10.0.19041` -> 19041. Null on anything that is not Windows-shaped. */
export function parseWindowsBuild(osRelease: string): number | null {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(osRelease.trim());
  if (!match) return null;
  return Number(match[3]);
}

export function platformSupport(
  platform: string = process.platform,
  osRelease: string = release(),
): { supported: boolean; build: number | null; message?: string } {
  if (platform !== 'win32') {
    return {
      supported: false,
      build: null,
      message: 'Halo V1 supports Windows 10 build 19041 or later only.',
    };
  }
  const build = parseWindowsBuild(osRelease);
  if (build === null || build < MIN_WINDOWS_BUILD) {
    return {
      supported: false,
      build,
      message:
        `Windows 10 build ${MIN_WINDOWS_BUILD} (version 2004) or later is required: ` +
        `capture exclusion does not exist on build ${build ?? 'unknown'}.`,
    };
  }
  return { supported: true, build };
}

/**
 * Assert capture exclusion on a window that is (or is about to be) visible.
 *
 * Chromium refuses to set display affinity on a hidden window and does not
 * restore it when the window is shown again (electron#45868), so a window
 * created with `show: false` - or hidden by the toggle hotkey - silently ends
 * up with no protection at all. It has to be re-asserted every time the window
 * becomes visible, and cheaply enough that doing so is never a problem.
 */
export function assertProtection(win: BrowserWindow): boolean {
  if (win.isDestroyed()) return false;
  try {
    win.setContentProtection(true);
    return true;
  } catch (error) {
    log.error('protection', `setContentProtection failed: ${String(error)}`);
    return false;
  }
}

/** Apply the flags and report honestly on whether they took. */
export function applyProtection(win: BrowserWindow): ProtectionReport {
  const support = platformSupport();
  if (!assertProtection(win)) {
    return {
      supported: support.supported,
      protectionVerified: false,
      build: support.build,
      message: 'Screen-capture exclusion could not be enabled. Halo is visible in shares.',
    };
  }

  // The window is still hidden here, so that call did nothing on Windows. It
  // is asserted again on every `show`; this one only proves the API exists.
  const protectionVerified = support.supported;

  win.setAlwaysOnTop(true, 'screen-saver');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.setSkipTaskbar(true);

  return {
    supported: support.supported,
    protectionVerified,
    build: support.build,
    message: support.message,
  };
}
