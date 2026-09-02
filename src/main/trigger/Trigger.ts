/**
 * The trigger seam (SPEC 2.3): something that decides assistance is wanted
 * right now. V1 ships ScreenTrigger and ManualTrigger. An audio trigger would
 * be additive here rather than a rewrite.
 */

import type { TriggerRequest, Unsubscribe } from '../../shared/types';

export interface Trigger {
  readonly id: string;
  start(): void;
  stop(): void;
  onFire(cb: (req: TriggerRequest) => void): Unsubscribe;
}

export abstract class BaseTrigger implements Trigger {
  abstract readonly id: string;
  protected running = false;
  private readonly callbacks = new Set<(req: TriggerRequest) => void>();

  start(): void {
    this.running = true;
  }

  stop(): void {
    this.running = false;
  }

  onFire(cb: (req: TriggerRequest) => void): Unsubscribe {
    this.callbacks.add(cb);
    return () => this.callbacks.delete(cb);
  }

  protected fire(req: TriggerRequest): void {
    for (const cb of this.callbacks) cb(req);
  }
}
