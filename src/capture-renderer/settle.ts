/**
 * Settle detection. Pure: it is driven by hashes and timestamps rather than by
 * timers, so the "timer resets on continued change, fires once on stability"
 * behaviour is testable without a clock.
 */

import { TUNING } from '../shared/constants';
import { hammingDistance } from './dhash';

export interface SettleOptions {
  settleMs: number;
  distanceThreshold: number;
}

export interface SettleDecision {
  settled: boolean;
  /** Distance from the previous frame; useful for the debug overlay. */
  distance: number;
}

export class SettleDetector {
  private lastHash: string | null = null;
  private stableSince: number | null = null;
  private settledHash: string | null = null;

  constructor(
    private readonly options: SettleOptions = {
      settleMs: TUNING.perception.settleMs,
      distanceThreshold: TUNING.perception.hashDistanceThreshold,
    },
  ) {}

  reset(): void {
    this.lastHash = null;
    this.stableSince = null;
    this.settledHash = null;
  }

  push(hash: string, now: number): SettleDecision {
    const distance = this.lastHash === null ? 0 : hammingDistance(hash, this.lastHash);

    if (this.lastHash === null || distance > this.options.distanceThreshold) {
      this.lastHash = hash;
      this.stableSince = now;
      return { settled: false, distance };
    }

    // Stable, but keep the newest hash so slow drift does not accumulate.
    this.lastHash = hash;
    if (this.stableSince === null) return { settled: false, distance };
    if (now - this.stableSince < this.options.settleMs) return { settled: false, distance };

    const isNewContent =
      this.settledHash === null ||
      hammingDistance(hash, this.settledHash) > this.options.distanceThreshold;

    this.stableSince = null; // fire once per period of stability
    if (!isNewContent) return { settled: false, distance };

    this.settledHash = hash;
    return { settled: true, distance };
  }
}
