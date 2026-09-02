import { describe, expect, it } from 'vitest';
import { TUNING } from '../src/shared/constants';
import type { AssistanceResult, Classification, Mode } from '../src/shared/types';
import {
  initialPipelineState,
  pipelineReducer,
  PENDING_SETTLE_TIMER,
  SHUSH_TIMER,
  type Effect,
  type PipelineEvent,
  type PipelineState,
  type SettledEvent,
} from '../src/main/pipeline/reducer';

const HASH_A = '0f0f0f0f0f0f0f0f';
const HASH_B = 'f0f0f0f0f0f0f0f0';

function start(mode: Mode): PipelineState {
  return initialPipelineState(mode);
}

function settled(at: number, id = 'settle-1', hash = HASH_A): SettledEvent {
  return { type: 'SCREEN_SETTLED', id, hash, thumbnail: 'thumb', at };
}

function classified(id: string, at: number, overrides: Partial<Classification> = {}): PipelineEvent {
  return {
    type: 'CLASSIFIED',
    id,
    at,
    classification: {
      actionable: true,
      category: 'coding_problem',
      confidence: 0.9,
      ...overrides,
    },
  };
}

function answer(id: string, fromCache = false): AssistanceResult {
  return {
    id,
    category: 'coding_problem',
    sections: { notes: 'two pointers' },
    raw: '## Notes\ntwo pointers',
    createdAt: 1,
    fromCache,
  };
}

function drive(
  state: PipelineState,
  events: PipelineEvent[],
): { state: PipelineState; effects: Effect[] } {
  let current = state;
  const effects: Effect[] = [];
  for (const event of events) {
    const [next, produced] = pipelineReducer(current, event);
    current = next;
    effects.push(...produced);
  }
  return { state: current, effects };
}

const kinds = (effects: Effect[]): string[] => effects.map((effect) => effect.kind);

describe('auto pipeline', () => {
  it('classifies a settled screen', () => {
    const { state, effects } = drive(start('auto'), [settled(1_000)]);
    expect(state.name).toBe('classifying');
    expect(effects).toContainEqual({ kind: 'RunClassify', id: 'settle-1', thumbnail: 'thumb' });
  });

  it('generates when the classification clears the confidence floor', () => {
    const { state, effects } = drive(start('auto'), [
      settled(1_000),
      classified('settle-1', 1_100),
    ]);
    expect(state.name).toBe('generating');
    const generate = effects.find((effect) => effect.kind === 'RunGenerate');
    expect(generate).toBeDefined();
    expect(effects).toContainEqual({
      kind: 'EmitToRenderer',
      event: { type: 'assistStart', id: 'settle-1', category: 'coding_problem', hold: true },
    });
  });

  it('holds the result rather than presenting it, and reveals on demand', () => {
    const first = drive(start('auto'), [
      settled(1_000),
      classified('settle-1', 1_100),
      { type: 'GENERATED', id: 'settle-1', result: answer('settle-1'), at: 1_500 },
    ]);
    expect(first.state.name).toBe('held');
    expect(first.state.held?.id).toBe('settle-1');
    expect(kinds(first.effects)).toContain('CacheResult');

    const revealed = drive(first.state, [{ type: 'REVEAL', at: 1_600 }]);
    expect(revealed.state.name).toBe('presented');
    expect(revealed.state.held).toBeNull();
  });

  it('does not cache a result that came from the cache', () => {
    const { effects } = drive(start('auto'), [
      settled(1_000),
      classified('settle-1', 1_100),
      { type: 'GENERATED', id: 'settle-1', result: answer('settle-1', true), at: 1_500 },
    ]);
    expect(kinds(effects)).not.toContain('CacheResult');
  });

  it('stops at the confidence floor and badges the pill instead', () => {
    const { state, effects } = drive(start('auto'), [
      settled(1_000),
      classified('settle-1', 1_100, { confidence: TUNING.pipeline.confidenceFloor - 0.01 }),
    ]);
    expect(state.name).toBe('idle');
    expect(state.lowConfidence).toBe(true);
    expect(kinds(effects)).not.toContain('RunGenerate');
  });

  it('drops a screen that is not actionable', () => {
    const { state, effects } = drive(start('auto'), [
      settled(1_000),
      classified('settle-1', 1_100, { actionable: false, category: 'none', confidence: 0.99 }),
    ]);
    expect(state.name).toBe('idle');
    expect(state.lowConfidence).toBe(false);
    expect(kinds(effects)).not.toContain('RunGenerate');
  });

  it('accumulates chunks and ignores stale ones', () => {
    const streaming = drive(start('auto'), [settled(1_000), classified('settle-1', 1_100)]);
    const { state, effects } = drive(streaming.state, [
      { type: 'CHUNK', id: 'settle-1', text: '## No', at: 1_200 },
      { type: 'CHUNK', id: 'settle-1', text: 'tes', at: 1_210 },
      { type: 'CHUNK', id: 'other', text: 'ignored', at: 1_220 },
    ]);
    expect(state.inFlight?.text).toBe('## Notes');
    expect(effects.filter((effect) => effect.kind === 'EmitToRenderer')).toHaveLength(2);
  });
});

describe('auto-mode restraint', () => {
  it('defers a settle inside the rate-limit window and replays it after', () => {
    const first = drive(start('auto'), [settled(1_000)]);
    const second = drive(first.state, [settled(5_000, 'settle-2', HASH_B)]);

    expect(second.state.name).toBe('settling');
    expect(second.state.pending?.id).toBe('settle-2');
    const timer = second.effects.find((effect) => effect.kind === 'StartTimer');
    expect(timer).toMatchObject({
      timerId: PENDING_SETTLE_TIMER,
      delayMs: 1_000 + TUNING.pipeline.autoMinIntervalMs - 5_000,
    });
    expect(kinds(second.effects)).not.toContain('RunClassify');

    const replayAt = 1_000 + TUNING.pipeline.autoMinIntervalMs;
    const replayed = drive(second.state, [settled(replayAt, 'settle-2', HASH_B)]);
    expect(replayed.state.name).toBe('classifying');
    expect(replayed.state.pending).toBeNull();
    expect(kinds(replayed.effects)).toContain('RunClassify');
  });

  it('never replaces an undismissed card', () => {
    const presented = drive(start('auto'), [
      { type: 'MANUAL_TRIGGER', id: 'm1', hash: HASH_A, at: 1_000 },
      { type: 'GENERATED', id: 'm1', result: answer('m1'), at: 1_500 },
    ]);
    expect(presented.state.name).toBe('presented');

    const later = drive(presented.state, [settled(90_000, 'settle-9', HASH_B)]);
    expect(later.state.name).toBe('presented');
    expect(kinds(later.effects)).not.toContain('RunClassify');
  });

  it('ignores screen settles outside auto mode', () => {
    const { state, effects } = drive(start('manual'), [settled(1_000)]);
    expect(state.name).toBe('idle');
    expect(effects).toHaveLength(0);
  });
});

describe('direct requests', () => {
  it('skips classification entirely', () => {
    const { state, effects } = drive(start('manual'), [
      { type: 'MANUAL_TRIGGER', id: 'm1', hash: HASH_A, at: 1_000 },
    ]);
    expect(state.name).toBe('generating');
    expect(kinds(effects)).not.toContain('RunClassify');
    expect(kinds(effects)).toContain('RunGenerate');
  });

  it('presents rather than holds', () => {
    const { state } = drive(start('manual'), [
      { type: 'MANUAL_TRIGGER', id: 'm1', hash: HASH_A, at: 1_000 },
      { type: 'GENERATED', id: 'm1', result: answer('m1'), at: 1_400 },
    ]);
    expect(state.name).toBe('presented');
    expect(state.held).toBeNull();
  });

  it('aborts the in-flight request', () => {
    const first = drive(start('manual'), [
      { type: 'MANUAL_TRIGGER', id: 'm1', hash: HASH_A, at: 1_000 },
    ]);
    const { effects } = drive(first.state, [
      { type: 'MANUAL_TRIGGER', id: 'm2', hash: HASH_A, at: 1_100 },
    ]);
    expect(effects).toContainEqual({ kind: 'AbortInFlight', id: 'm1' });
  });

  it('is ignored when the mode is off', () => {
    const { state, effects } = drive(start('off'), [
      { type: 'MANUAL_TRIGGER', id: 'm1', hash: HASH_A, at: 1_000 },
    ]);
    expect(state.name).toBe('idle');
    expect(effects).toHaveLength(0);
  });

  it('carries the previous answer into a follow-up without re-capturing', () => {
    const presented = drive(start('manual'), [
      { type: 'MANUAL_TRIGGER', id: 'm1', hash: HASH_A, at: 1_000 },
      { type: 'GENERATED', id: 'm1', result: answer('m1'), at: 1_400 },
    ]);
    const { effects } = drive(presented.state, [
      { type: 'PROMPT_SUBMITTED', id: 'p1', text: '/shorter', hash: HASH_A, at: 1_500 },
    ]);
    const generate = effects.find((effect) => effect.kind === 'RunGenerate');
    expect(generate?.request).toMatchObject({
      previousRaw: '## Notes\ntwo pointers',
      reuseLastFrame: true,
      fullFrame: false,
      userPrompt: '/shorter',
      cacheKey: `${HASH_A}:manual:/shorter`,
    });
  });

  it('regenerates at full resolution for /again', () => {
    const presented = drive(start('manual'), [
      { type: 'MANUAL_TRIGGER', id: 'm1', hash: HASH_A, at: 1_000 },
      { type: 'GENERATED', id: 'm1', result: answer('m1'), at: 1_400 },
    ]);
    const { effects } = drive(presented.state, [
      { type: 'PROMPT_SUBMITTED', id: 'p1', text: '/again', hash: HASH_A, at: 1_500 },
    ]);
    const generate = effects.find((effect) => effect.kind === 'RunGenerate');
    expect(generate?.request).toMatchObject({ fullFrame: true, reuseLastFrame: false });
  });
});

describe('shush', () => {
  it('suppresses auto triggers, keeps direct ones, and expires', () => {
    const shushed = drive(start('auto'), [{ type: 'SHUSH', minutes: 5, at: 1_000 }]);
    expect(shushed.state.name).toBe('shushed');
    expect(shushed.state.shushUntil).toBe(1_000 + TUNING.pipeline.shushDefaultMs);
    expect(shushed.effects).toContainEqual({
      kind: 'StartTimer',
      timerId: SHUSH_TIMER,
      delayMs: TUNING.pipeline.shushDefaultMs,
      event: { type: 'SHUSH_EXPIRED', at: 1_000 + TUNING.pipeline.shushDefaultMs },
    });

    const ignored = drive(shushed.state, [settled(2_000)]);
    expect(kinds(ignored.effects)).not.toContain('RunClassify');

    const manual = drive(shushed.state, [
      { type: 'MANUAL_TRIGGER', id: 'm1', hash: HASH_A, at: 2_000 },
    ]);
    expect(manual.state.name).toBe('generating');

    const early = drive(shushed.state, [{ type: 'SHUSH_EXPIRED', at: 2_000 }]);
    expect(early.state.name).toBe('shushed');

    const expired = drive(shushed.state, [
      { type: 'SHUSH_EXPIRED', at: 1_000 + TUNING.pipeline.shushDefaultMs },
    ]);
    expect(expired.state.name).toBe('idle');
    expect(expired.state.shushUntil).toBeNull();
  });

  it('drops auto work already in flight but not a direct request', () => {
    const auto = drive(start('auto'), [settled(1_000)]);
    const shushedAuto = drive(auto.state, [{ type: 'SHUSH', minutes: 5, at: 1_100 }]);
    expect(shushedAuto.effects).toContainEqual({ kind: 'AbortInFlight', id: 'settle-1' });
    expect(shushedAuto.state.inFlight).toBeNull();

    const manual = drive(start('auto'), [
      { type: 'MANUAL_TRIGGER', id: 'm1', hash: HASH_A, at: 1_000 },
    ]);
    const shushedManual = drive(manual.state, [{ type: 'SHUSH', minutes: 5, at: 1_100 }]);
    expect(shushedManual.state.inFlight?.id).toBe('m1');
    expect(kinds(shushedManual.effects)).not.toContain('AbortInFlight');
  });
});

describe('mode, dismiss, abort and errors', () => {
  it('aborts in-flight work when the mode changes', () => {
    const generating = drive(start('auto'), [settled(1_000), classified('settle-1', 1_100)]);
    const { state, effects } = drive(generating.state, [
      { type: 'MODE_CHANGED', mode: 'off', at: 1_200 },
    ]);
    expect(state.mode).toBe('off');
    expect(state.name).toBe('idle');
    expect(effects).toContainEqual({ kind: 'AbortInFlight', id: 'settle-1' });
  });

  it('clears a held result when the mode changes', () => {
    const held = drive(start('auto'), [
      settled(1_000),
      classified('settle-1', 1_100),
      { type: 'GENERATED', id: 'settle-1', result: answer('settle-1'), at: 1_500 },
    ]);
    const { state } = drive(held.state, [{ type: 'MODE_CHANGED', mode: 'manual', at: 1_600 }]);
    expect(state.held).toBeNull();
    expect(state.name).toBe('idle');
  });

  it('dismisses the card and aborts anything running', () => {
    const generating = drive(start('manual'), [
      { type: 'MANUAL_TRIGGER', id: 'm1', hash: HASH_A, at: 1_000 },
    ]);
    const { state, effects } = drive(generating.state, [{ type: 'DISMISS', at: 1_100 }]);
    expect(state.name).toBe('idle');
    expect(state.presented).toBeNull();
    expect(effects).toContainEqual({ kind: 'AbortInFlight', id: 'm1' });
  });

  it('reports errors and clears them on the next request', () => {
    const generating = drive(start('manual'), [
      { type: 'MANUAL_TRIGGER', id: 'm1', hash: HASH_A, at: 1_000 },
    ]);
    const failed = drive(generating.state, [
      { type: 'ERROR', id: 'm1', message: 'Rate limited', retryable: true, at: 1_100 },
    ]);
    expect(failed.state.name).toBe('error');
    expect(failed.effects).toContainEqual({
      kind: 'EmitToRenderer',
      event: { type: 'assistError', id: 'm1', message: 'Rate limited', retryable: true },
    });

    const stale = drive(failed.state, [
      { type: 'ERROR', id: 'm1', message: 'again', retryable: true, at: 1_200 },
    ]);
    expect(stale.effects).toHaveLength(0);

    const retried = drive(failed.state, [
      { type: 'MANUAL_TRIGGER', id: 'm2', hash: HASH_A, at: 1_300 },
    ]);
    expect(retried.state.error).toBeNull();
    expect(retried.state.name).toBe('generating');
  });

  it('publishes state whenever the HUD would care', () => {
    const { effects } = drive(start('auto'), [settled(1_000)]);
    expect(effects).toContainEqual({
      kind: 'EmitToRenderer',
      event: {
        type: 'state',
        mode: 'auto',
        pipeline: 'classifying',
        shushUntil: null,
        lowConfidence: false,
      },
    });
  });

  it('ignores an abort with nothing in flight', () => {
    const { effects } = drive(start('auto'), [{ type: 'ABORT', at: 1_000 }]);
    expect(effects).toHaveLength(0);
  });
});
