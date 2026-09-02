/**
 * Executes the effects the reducer returns and feeds results back in as new
 * events (SPEC 2.4). Everything time-, network- or Electron-shaped lives here;
 * nothing here decides policy.
 */

import { randomUUID } from 'node:crypto';
import { TUNING } from '../../shared/constants';
import type { Event as UiEvent } from '../../shared/ipc';
import { parseSections } from '../../shared/sections';
import type { AssistanceResult, Frame, Mode, SettleEvent } from '../../shared/types';
import type { ContextExtractor } from '../ai/extractors/VisionExtractor';
import { ProviderError, type ModelProvider } from '../ai/ModelProvider';
import { isUsableRegion, padRegion, type CaptureSource } from '../capture/CaptureSource';
import { log } from '../log';
import type { ResultCache } from './cache';
import {
  initialPipelineState,
  pipelineReducer,
  type Effect,
  type GenerateRequest,
  type PipelineEvent,
  type PipelineState,
} from './reducer';

export interface RunnerDeps {
  /** Null until an API key is configured (SPEC 12). */
  provider: () => ModelProvider | null;
  capture: CaptureSource;
  extractor: ContextExtractor;
  cache: ResultCache;
  emit: (event: UiEvent) => void;
  now?: () => number;
}

const NO_KEY = 'No API key configured';

export class PipelineRunner {
  private current: PipelineState;
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly controllers = new Map<string, AbortController>();
  private lastFrame: Frame | null = null;
  private lastMs: number | null = null;
  private readonly now: () => number;

  constructor(
    private readonly deps: RunnerDeps,
    mode: Mode,
  ) {
    this.now = deps.now ?? Date.now;
    this.current = initialPipelineState(mode);
  }

  get state(): PipelineState {
    return this.current;
  }

  get lastRequestMs(): number | null {
    return this.lastMs;
  }

  /** Re-emit authoritative state, e.g. when the HUD reloads. */
  publishState(): void {
    this.deps.emit({
      type: 'state',
      mode: this.current.mode,
      pipeline: this.current.name,
      shushUntil: this.current.shushUntil,
      lowConfidence: this.current.lowConfidence,
    });
  }

  dispatch(event: PipelineEvent): void {
    const [next, effects] = pipelineReducer(this.current, event);
    this.current = next;
    for (const effect of effects) this.run(effect);
  }

  setMode(mode: Mode): void {
    this.dispatch({ type: 'MODE_CHANGED', mode, at: this.now() });
  }

  trigger(): void {
    this.dispatch({
      type: 'MANUAL_TRIGGER',
      id: randomUUID(),
      hash: this.deps.capture.lastHash,
      at: this.now(),
    });
  }

  submitPrompt(text: string): void {
    this.dispatch({
      type: 'PROMPT_SUBMITTED',
      id: randomUUID(),
      text,
      hash: this.deps.capture.lastHash,
      at: this.now(),
    });
  }

  settled(event: SettleEvent): void {
    this.dispatch({
      type: 'SCREEN_SETTLED',
      id: randomUUID(),
      hash: event.hash,
      thumbnail: event.thumbnail,
      at: this.now(),
    });
  }

  reveal(): void {
    this.dispatch({ type: 'REVEAL', at: this.now() });
  }

  dismiss(): void {
    this.dispatch({ type: 'DISMISS', at: this.now() });
  }

  shush(minutes: number): void {
    this.dispatch({ type: 'SHUSH', minutes, at: this.now() });
  }

  abort(): void {
    this.dispatch({ type: 'ABORT', at: this.now() });
  }

  dispose(): void {
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
    for (const controller of this.controllers.values()) controller.abort();
    this.controllers.clear();
  }

  private run(effect: Effect): void {
    switch (effect.kind) {
      case 'EmitToRenderer':
        this.deps.emit(effect.event);
        return;
      case 'CacheResult':
        this.deps.cache.set(effect.key, effect.result);
        return;
      case 'AbortInFlight':
        this.controllers.get(effect.id)?.abort();
        this.controllers.delete(effect.id);
        return;
      case 'StartTimer': {
        const existing = this.timers.get(effect.timerId);
        if (existing) clearTimeout(existing);
        const timer = setTimeout(() => {
          this.timers.delete(effect.timerId);
          // Timers replay their event stamped with the fire time, never the
          // time it was scheduled - otherwise a deferred settle can never
          // clear the rate-limit guard that deferred it.
          this.dispatch({ ...effect.event, at: this.now() });
        }, Math.max(0, effect.delayMs));
        if (typeof timer.unref === 'function') timer.unref();
        this.timers.set(effect.timerId, timer);
        return;
      }
      case 'RunClassify':
        void this.runClassify(effect.id, effect.thumbnail);
        return;
      case 'RunGenerate':
        void this.runGenerate(effect.request);
        return;
      default: {
        const exhaustive: never = effect;
        void exhaustive;
      }
    }
  }

  private signalFor(id: string): { signal: AbortSignal; timeout: AbortSignal; done: () => void } {
    const controller = new AbortController();
    this.controllers.set(id, controller);
    const timeout = AbortSignal.timeout(TUNING.pipeline.requestTimeoutMs);
    return {
      signal: AbortSignal.any([controller.signal, timeout]),
      timeout,
      done: () => this.controllers.delete(id),
    };
  }

  private fail(id: string, error: unknown, timedOut: boolean): void {
    const provider = error instanceof ProviderError ? error : null;
    const message = timedOut
      ? 'Request timed out'
      : (provider?.message ?? (error instanceof Error ? error.message : 'Unknown error'));
    const retryable = timedOut ? true : (provider?.retryable ?? false);
    log.warn('pipeline', `request ${id} failed: ${message}`);
    this.dispatch({ type: 'ERROR', id, message, retryable, at: this.now() });
  }

  private async runClassify(id: string, thumbnail: string): Promise<void> {
    const provider = this.deps.provider();
    if (!provider) {
      this.dispatch({ type: 'ERROR', id, message: NO_KEY, retryable: false, at: this.now() });
      return;
    }
    const { signal, timeout, done } = this.signalFor(id);
    const started = this.now();
    try {
      const classification = await provider.classify(
        { image: { base64: thumbnail, mediaType: 'image/jpeg' } },
        signal,
      );
      this.lastMs = this.now() - started;
      this.dispatch({ type: 'CLASSIFIED', id, classification, at: this.now() });
    } catch (error) {
      if (signal.aborted && !timeout.aborted) return; // superseded on purpose
      this.fail(id, error, timeout.aborted);
    } finally {
      done();
    }
  }

  private async runGenerate(request: GenerateRequest): Promise<void> {
    const hit = this.deps.cache.get(request.cacheKey);
    if (hit) {
      this.dispatch({
        type: 'GENERATED',
        id: request.id,
        result: { ...hit, id: request.id, fromCache: true },
        at: this.now(),
      });
      return;
    }

    const provider = this.deps.provider();
    if (!provider) {
      this.dispatch({
        type: 'ERROR',
        id: request.id,
        message: NO_KEY,
        retryable: false,
        at: this.now(),
      });
      return;
    }

    const { signal, timeout, done } = this.signalFor(request.id);
    const started = this.now();
    let raw = '';
    try {
      const frame = await this.frameFor(request);
      const context = await this.deps.extractor.extract(frame);
      const chunks = provider.generate(
        {
          image: context.image,
          category: request.category === 'none' ? undefined : request.category,
          userPrompt: request.userPrompt,
          previousRaw: request.previousRaw,
        },
        signal,
      );
      for await (const chunk of chunks) {
        if (chunk.type === 'text') {
          this.dispatch({ type: 'CHUNK', id: request.id, text: chunk.text, at: this.now() });
        } else {
          raw = chunk.raw;
        }
      }
      this.lastMs = this.now() - started;
      const result: AssistanceResult = {
        id: request.id,
        category: request.category,
        sections: parseSections(raw),
        raw,
        createdAt: this.now(),
        fromCache: false,
      };
      this.dispatch({ type: 'GENERATED', id: request.id, result, at: this.now() });
    } catch (error) {
      if (signal.aborted && !timeout.aborted) return; // superseded on purpose
      this.fail(request.id, error, timeout.aborted);
    } finally {
      done();
    }
  }

  private async frameFor(request: GenerateRequest): Promise<Frame> {
    if (request.reuseLastFrame && this.lastFrame) return this.lastFrame;
    const region =
      !request.fullFrame && isUsableRegion(request.region) ? padRegion(request.region) : undefined;
    const frame = await this.deps.capture.grab({
      region,
      maxEdge: TUNING.capture.generateMaxEdge,
      quality: TUNING.capture.generateQuality,
    });
    this.lastFrame = frame;
    return frame;
  }
}
