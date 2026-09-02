/**
 * The capture seam (SPEC 2.3). V1 has one implementation, backed by Electron's
 * desktopCapturer; a native Windows Graphics Capture helper may replace it.
 */

import { AI } from '../../shared/constants';
import type { Frame, Rect, SettleEvent, Unsubscribe } from '../../shared/types';

export interface GrabOptions {
  /** Normalized 0..1 crop applied before scaling. */
  region?: Rect;
  maxEdge: number;
  quality: number;
}

export interface CaptureSource {
  start(displayId: string | null): Promise<void>;
  stop(): void;
  grab(opts: GrabOptions): Promise<Frame>;
  onSettled(cb: (e: SettleEvent) => void): Unsubscribe;
  /**
   * Not in SPEC 2.3's sketch: main needs the live hash to key the result cache
   * for manual triggers, and the debug overlay reports the last distance.
   */
  onHash(cb: (hash: string, distance: number) => void): Unsubscribe;
  readonly lastHash: string | null;
  readonly active: boolean;
}

/** Grow a normalized rect by `pct` on each edge, clamped to the frame. */
export function padRegion(region: Rect, pct: number = AI.regionPaddingPct): Rect {
  const padX = region.width * pct;
  const padY = region.height * pct;
  const x = Math.max(0, region.x - padX);
  const y = Math.max(0, region.y - padY);
  return {
    x,
    y,
    width: Math.min(1 - x, region.width + padX * 2),
    height: Math.min(1 - y, region.height + padY * 2),
  };
}

/** A region is only worth cropping to if it is a meaningful part of the frame. */
export function isUsableRegion(region: Rect | undefined): region is Rect {
  if (!region) return false;
  const finite = [region.x, region.y, region.width, region.height].every(Number.isFinite);
  if (!finite) return false;
  if (region.width <= 0.05 || region.height <= 0.05) return false;
  if (region.width >= 0.99 && region.height >= 0.99) return false;
  return region.x >= 0 && region.y >= 0 && region.x + region.width <= 1.001 &&
    region.y + region.height <= 1.001;
}
