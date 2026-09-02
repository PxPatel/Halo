/** Fires when the screen has settled on something new (SPEC 2.2). */

import type { SettleEvent, Unsubscribe } from '../../shared/types';
import type { CaptureSource } from '../capture/CaptureSource';
import { BaseTrigger } from './Trigger';

export class ScreenTrigger extends BaseTrigger {
  readonly id = 'screen';
  private unsubscribe: Unsubscribe | null = null;
  private readonly settleCbs = new Set<(e: SettleEvent) => void>();

  constructor(private readonly capture: CaptureSource) {
    super();
  }

  /** Settle payloads (hash + thumbnail) reach the runner through here. */
  onSettle(cb: (e: SettleEvent) => void): Unsubscribe {
    this.settleCbs.add(cb);
    return () => this.settleCbs.delete(cb);
  }

  override start(): void {
    if (this.running) return;
    super.start();
    this.unsubscribe = this.capture.onSettled((event) => {
      if (!this.running) return;
      this.fire({ triggerId: this.id, reason: 'screen_settled', hash: event.hash });
      for (const cb of this.settleCbs) cb(event);
    });
  }

  override stop(): void {
    super.stop();
    this.unsubscribe?.();
    this.unsubscribe = null;
  }
}
