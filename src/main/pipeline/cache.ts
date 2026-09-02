/**
 * In-memory LRU of generated answers (SPEC 7, "Result cache").
 * Nothing here touches disk: screenshots and answers are never persisted.
 */

import { RESULT_CACHE_SIZE } from '../../shared/constants';
import type { AssistanceResult } from '../../shared/types';

export class ResultCache {
  private readonly entries = new Map<string, AssistanceResult>();

  constructor(private readonly capacity: number = RESULT_CACHE_SIZE) {}

  get(key: string): AssistanceResult | undefined {
    const hit = this.entries.get(key);
    if (!hit) return undefined;
    // Refresh recency.
    this.entries.delete(key);
    this.entries.set(key, hit);
    return hit;
  }

  set(key: string, result: AssistanceResult): void {
    if (this.entries.has(key)) this.entries.delete(key);
    this.entries.set(key, result);
    while (this.entries.size > this.capacity) {
      const oldest = this.entries.keys().next();
      if (oldest.done) break;
      this.entries.delete(oldest.value);
    }
  }

  clear(): void {
    this.entries.clear();
  }

  get size(): number {
    return this.entries.size;
  }
}
