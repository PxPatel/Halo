/**
 * The pipeline is a pure reducer (SPEC 2.4).
 *
 * No I/O, no timers, no Electron, no imports outside shared/. Every mode
 * transition, cancellation path, rate-limit guard and confidence floor lives
 * here so it can be tested without mocking anything. `PipelineRunner` executes
 * the returned effects and feeds the results back in as new events.
 */

import { TUNING } from '../../shared/constants';
import type { Event as UiEvent } from '../../shared/ipc';
import type {
  AssistanceResult,
  Category,
  Classification,
  Mode,
  PipelineStateName,
  Rect,
  TriggerReason,
} from '../../shared/types';

export interface GenerateRequest {
  id: string;
  category: Category;
  region?: Rect;
  hash: string | null;
  mode: Mode;
  userPrompt?: string;
  /** Previous answer, so a follow-up does not need a fresh capture. */
  previousRaw?: string;
  /** Follow-ups reuse the last frame instead of grabbing a new one. */
  reuseLastFrame: boolean;
  /** `/again`: regenerate from the whole frame at full resolution. */
  fullFrame: boolean;
  cacheKey: string;
}

export interface InFlight {
  id: string;
  reason: TriggerReason;
  phase: 'classify' | 'generate';
  category: Category;
  hash: string | null;
  userPrompt?: string;
  startedAt: number;
  text: string;
  /** Auto-mode work is held rather than presented (SPEC 9, prefetch and hold). */
  hold: boolean;
}

export interface SettledEvent {
  type: 'SCREEN_SETTLED';
  id: string;
  hash: string;
  thumbnail: string;
  at: number;
}

export interface PipelineState {
  name: PipelineStateName;
  mode: Mode;
  shushUntil: number | null;
  /** When the last auto-mode pipeline run started; drives the rate limit. */
  lastAutoStartedAt: number | null;
  inFlight: InFlight | null;
  /** A settle deferred by the rate limit, replayed when the window opens. */
  pending: SettledEvent | null;
  held: AssistanceResult | null;
  presented: AssistanceResult | null;
  lowConfidence: boolean;
  error: { id: string; message: string; retryable: boolean } | null;
}

export type PipelineEvent =
  | { type: 'MODE_CHANGED'; mode: Mode; at: number }
  | SettledEvent
  | { type: 'MANUAL_TRIGGER'; id: string; hash: string | null; at: number }
  | { type: 'PROMPT_SUBMITTED'; id: string; text: string; hash: string | null; at: number }
  | { type: 'CLASSIFIED'; id: string; classification: Classification; at: number }
  | { type: 'CHUNK'; id: string; text: string; at: number }
  | { type: 'GENERATED'; id: string; result: AssistanceResult; at: number }
  | { type: 'REVEAL'; at: number }
  | { type: 'DISMISS'; at: number }
  | { type: 'SHUSH'; minutes: number; at: number }
  | { type: 'SHUSH_EXPIRED'; at: number }
  | { type: 'ABORT'; at: number }
  | { type: 'ERROR'; id: string; message: string; retryable: boolean; at: number };

export type Effect =
  | { kind: 'RunClassify'; id: string; thumbnail: string }
  | { kind: 'RunGenerate'; request: GenerateRequest }
  | { kind: 'AbortInFlight'; id: string }
  | { kind: 'EmitToRenderer'; event: UiEvent }
  /** The runner replaces a timer with the same id, and stamps `at` on fire. */
  | { kind: 'StartTimer'; timerId: string; delayMs: number; event: PipelineEvent }
  | { kind: 'CacheResult'; key: string; result: AssistanceResult };

export const PENDING_SETTLE_TIMER = 'pending-settle';
export const SHUSH_TIMER = 'shush';

export function initialPipelineState(mode: Mode): PipelineState {
  return {
    name: mode === 'off' ? 'idle' : 'idle',
    mode,
    shushUntil: null,
    lastAutoStartedAt: null,
    inFlight: null,
    pending: null,
    held: null,
    presented: null,
    lowConfidence: false,
    error: null,
  };
}

function isShushed(state: PipelineState, at: number): boolean {
  return state.shushUntil !== null && state.shushUntil > at;
}

/** The state name whenever nothing is in flight. */
function resting(state: PipelineState, at: number): PipelineStateName {
  if (state.presented) return 'presented';
  if (state.held) return 'held';
  if (state.error) return 'error';
  if (isShushed(state, at)) return 'shushed';
  if (state.pending) return 'settling';
  return 'idle';
}

function stateEvent(state: PipelineState): UiEvent {
  return {
    type: 'state',
    mode: state.mode,
    pipeline: state.name,
    shushUntil: state.shushUntil,
    lowConfidence: state.lowConfidence,
  };
}

function changed(a: PipelineState, b: PipelineState): boolean {
  return (
    a.name !== b.name ||
    a.mode !== b.mode ||
    a.shushUntil !== b.shushUntil ||
    a.lowConfidence !== b.lowConfidence
  );
}

/** Finalize a transition: append a `state` event whenever the HUD would care. */
function commit(
  prev: PipelineState,
  next: PipelineState,
  effects: Effect[] = [],
): [PipelineState, Effect[]] {
  if (!changed(prev, next)) return [next, effects];
  return [next, [...effects, { kind: 'EmitToRenderer', event: stateEvent(next) }]];
}

function abortEffects(state: PipelineState): Effect[] {
  return state.inFlight ? [{ kind: 'AbortInFlight', id: state.inFlight.id }] : [];
}

function cacheKey(hash: string | null, mode: Mode, prompt: string | undefined): string {
  return `${hash ?? 'live'}:${mode}:${prompt ?? ''}`;
}

/** A direct request from the user: skip tier 1, generate immediately. */
function startDirect(
  state: PipelineState,
  args: { id: string; reason: TriggerReason; hash: string | null; at: number; prompt?: string },
): [PipelineState, Effect[]] {
  const previous = state.presented ?? state.held;
  const isFollowUp = args.reason === 'prompt' && previous !== null;
  const request: GenerateRequest = {
    id: args.id,
    category: isFollowUp ? previous.category : 'none',
    hash: args.hash,
    mode: state.mode,
    userPrompt: args.prompt,
    previousRaw: isFollowUp ? previous.raw : undefined,
    reuseLastFrame: isFollowUp && !args.prompt?.startsWith('/again'),
    fullFrame: args.prompt?.startsWith('/again') ?? false,
    cacheKey: cacheKey(args.hash, state.mode, args.prompt),
  };
  const next: PipelineState = {
    ...state,
    name: 'generating',
    error: null,
    lowConfidence: false,
    pending: null,
    inFlight: {
      id: args.id,
      reason: args.reason,
      phase: 'generate',
      category: request.category,
      hash: args.hash,
      userPrompt: args.prompt,
      startedAt: args.at,
      text: '',
      hold: false,
    },
  };
  return commit(state, next, [
    ...abortEffects(state),
    {
      kind: 'EmitToRenderer',
      event: { type: 'assistStart', id: args.id, category: request.category, hold: false },
    },
    { kind: 'RunGenerate', request },
  ]);
}

function onScreenSettled(state: PipelineState, event: SettledEvent): [PipelineState, Effect[]] {
  const at = event.at;
  // If this is the deferred replay of a pending settle, consume it first so no
  // guard below can strand the pipeline in `settling`.
  const base: PipelineState =
    state.pending?.id === event.id ? { ...state, pending: null } : state;

  const ignore = (): [PipelineState, Effect[]] =>
    commit(state, { ...base, name: resting(base, at) });

  if (base.mode !== 'auto') return ignore();
  if (isShushed(base, at)) return ignore();
  // Never replace an undismissed card (SPEC 9).
  if (base.presented) return ignore();

  const since = base.lastAutoStartedAt;
  if (since !== null && at - since < TUNING.pipeline.autoMinIntervalMs) {
    const deferred: SettledEvent = { ...event, at };
    const next: PipelineState = { ...base, pending: deferred, name: 'settling' };
    return commit(state, next, [
      {
        kind: 'StartTimer',
        timerId: PENDING_SETTLE_TIMER,
        delayMs: since + TUNING.pipeline.autoMinIntervalMs - at,
        event: deferred,
      },
    ]);
  }

  const next: PipelineState = {
    ...base,
    name: 'classifying',
    lastAutoStartedAt: at,
    error: null,
    inFlight: {
      id: event.id,
      reason: 'screen_settled',
      phase: 'classify',
      category: 'none',
      hash: event.hash,
      startedAt: at,
      text: '',
      hold: true,
    },
  };
  return commit(state, next, [
    ...abortEffects(base),
    { kind: 'RunClassify', id: event.id, thumbnail: event.thumbnail },
  ]);
}

function onClassified(
  state: PipelineState,
  event: Extract<PipelineEvent, { type: 'CLASSIFIED' }>,
): [PipelineState, Effect[]] {
  const flight = state.inFlight;
  if (!flight || flight.id !== event.id || flight.phase !== 'classify') return [state, []];

  const { actionable, category, confidence, region } = event.classification;

  if (!actionable || category === 'none') {
    const next: PipelineState = { ...state, inFlight: null, lowConfidence: false };
    return commit(state, { ...next, name: resting(next, event.at) });
  }

  if (confidence < TUNING.pipeline.confidenceFloor) {
    const next: PipelineState = { ...state, inFlight: null, lowConfidence: true };
    return commit(state, { ...next, name: resting(next, event.at) });
  }

  const request: GenerateRequest = {
    id: flight.id,
    category,
    region,
    hash: flight.hash,
    mode: state.mode,
    reuseLastFrame: false,
    fullFrame: false,
    cacheKey: cacheKey(flight.hash, state.mode, undefined),
  };
  const next: PipelineState = {
    ...state,
    name: 'generating',
    lowConfidence: false,
    inFlight: { ...flight, phase: 'generate', category },
  };
  return commit(state, next, [
    {
      kind: 'EmitToRenderer',
      event: { type: 'assistStart', id: flight.id, category, hold: flight.hold },
    },
    { kind: 'RunGenerate', request },
  ]);
}

function onGenerated(
  state: PipelineState,
  event: Extract<PipelineEvent, { type: 'GENERATED' }>,
): [PipelineState, Effect[]] {
  const flight = state.inFlight;
  if (!flight || flight.id !== event.id) return [state, []];

  const effects: Effect[] = [
    { kind: 'EmitToRenderer', event: { type: 'assistDone', result: event.result } },
  ];
  if (!event.result.fromCache) {
    effects.push({
      kind: 'CacheResult',
      key: cacheKey(flight.hash, state.mode, flight.userPrompt),
      result: event.result,
    });
  }

  const next: PipelineState = flight.hold
    ? { ...state, inFlight: null, held: event.result, name: 'held' }
    : { ...state, inFlight: null, held: null, presented: event.result, name: 'presented' };
  return commit(state, next, effects);
}

export function pipelineReducer(
  state: PipelineState,
  event: PipelineEvent,
): [PipelineState, Effect[]] {
  switch (event.type) {
    case 'MODE_CHANGED': {
      if (event.mode === state.mode) return [state, []];
      const cleared: PipelineState = {
        ...state,
        mode: event.mode,
        inFlight: null,
        pending: null,
        held: null,
        lowConfidence: false,
        lastAutoStartedAt: event.mode === 'auto' ? null : state.lastAutoStartedAt,
      };
      return commit(state, { ...cleared, name: resting(cleared, event.at) }, abortEffects(state));
    }

    case 'SCREEN_SETTLED':
      return onScreenSettled(state, event);

    case 'MANUAL_TRIGGER':
      if (state.mode === 'off') return [state, []];
      return startDirect(state, {
        id: event.id,
        reason: 'manual',
        hash: event.hash,
        at: event.at,
      });

    case 'PROMPT_SUBMITTED':
      if (state.mode === 'off') return [state, []];
      return startDirect(state, {
        id: event.id,
        reason: 'prompt',
        hash: event.hash,
        at: event.at,
        prompt: event.text,
      });

    case 'CLASSIFIED':
      return onClassified(state, event);

    case 'CHUNK': {
      const flight = state.inFlight;
      if (!flight || flight.id !== event.id || flight.phase !== 'generate') return [state, []];
      return [
        { ...state, inFlight: { ...flight, text: flight.text + event.text } },
        [
          {
            kind: 'EmitToRenderer',
            event: { type: 'assistChunk', id: event.id, text: event.text },
          },
        ],
      ];
    }

    case 'GENERATED':
      return onGenerated(state, event);

    case 'REVEAL': {
      if (!state.held) return [state, []];
      const next: PipelineState = {
        ...state,
        presented: state.held,
        held: null,
        name: 'presented',
      };
      return commit(state, next);
    }

    case 'DISMISS': {
      const next: PipelineState = {
        ...state,
        inFlight: null,
        held: null,
        presented: null,
        error: null,
        lowConfidence: false,
      };
      return commit(state, { ...next, name: resting(next, event.at) }, abortEffects(state));
    }

    case 'SHUSH': {
      const ms = event.minutes > 0 ? event.minutes * 60_000 : TUNING.pipeline.shushDefaultMs;
      const until = event.at + ms;
      // Only auto work is suppressed; a direct request survives.
      const dropAuto = state.inFlight?.reason === 'screen_settled';
      const next: PipelineState = {
        ...state,
        shushUntil: until,
        pending: null,
        inFlight: dropAuto ? null : state.inFlight,
      };
      const effects: Effect[] = dropAuto ? abortEffects(state) : [];
      effects.push({
        kind: 'StartTimer',
        timerId: SHUSH_TIMER,
        delayMs: ms,
        event: { type: 'SHUSH_EXPIRED', at: until },
      });
      const name = next.inFlight ? state.name : resting(next, event.at);
      return commit(state, { ...next, name }, effects);
    }

    case 'SHUSH_EXPIRED': {
      if (state.shushUntil === null || event.at < state.shushUntil) return [state, []];
      const next: PipelineState = { ...state, shushUntil: null };
      const name = next.inFlight ? state.name : resting(next, event.at);
      return commit(state, { ...next, name });
    }

    case 'ABORT': {
      if (!state.inFlight) return [state, []];
      const next: PipelineState = { ...state, inFlight: null };
      return commit(state, { ...next, name: resting(next, event.at) }, abortEffects(state));
    }

    case 'ERROR': {
      const flight = state.inFlight;
      if (!flight || flight.id !== event.id) return [state, []];
      const next: PipelineState = {
        ...state,
        inFlight: null,
        error: { id: event.id, message: event.message, retryable: event.retryable },
        name: 'error',
      };
      return commit(state, next, [
        {
          kind: 'EmitToRenderer',
          event: {
            type: 'assistError',
            id: event.id,
            message: event.message,
            retryable: event.retryable,
          },
        },
      ]);
    }

    default: {
      const exhaustive: never = event;
      void exhaustive;
      return [state, []];
    }
  }
}
