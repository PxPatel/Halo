/** Fires when the user asks: a hotkey, or a prompt submitted from the HUD. */

import type { CaptureSource } from '../capture/CaptureSource';
import { BaseTrigger } from './Trigger';

export class ManualTrigger extends BaseTrigger {
  readonly id = 'manual';

  constructor(private readonly capture: CaptureSource) {
    super();
  }

  request(userPrompt?: string): void {
    if (!this.running) return;
    this.fire({
      triggerId: this.id,
      reason: userPrompt === undefined ? 'manual' : 'prompt',
      userPrompt,
      hash: this.capture.lastHash ?? undefined,
    });
  }
}
