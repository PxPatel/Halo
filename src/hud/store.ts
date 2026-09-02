/**
 * The HUD's store mirrors main and holds zero business logic (SPEC 5). It is
 * updated only by Events; nothing here optimistically mutates mode or pipeline
 * state, and every user action leaves as a Command.
 */

import { create } from 'zustand';
import type { Command, Event, HaloApi, HotkeyConflict } from '../shared/ipc';
import { parseSections, presentSections } from '../shared/sections';
import type {
  AssistanceResult,
  Category,
  Mode,
  PipelineStateName,
  SectionKey,
  Sections,
  Settings,
} from '../shared/types';

declare global {
  interface Window {
    halo: HaloApi;
  }
}

export const send = (command: Command): void => window.halo.send(command);

export interface ActiveStream {
  id: string;
  category: Category;
  text: string;
  hold: boolean;
  startedAt: number;
}

export interface Diagnostics {
  protectionVerified: boolean;
  captureActive: boolean;
  message?: string;
  lastHashDistance?: number;
  lastRequestMs?: number;
}

export interface HudState {
  mode: Mode;
  pipeline: PipelineStateName;
  shushUntil: number | null;
  lowConfidence: boolean;
  active: ActiveStream | null;
  result: AssistanceResult | null;
  elapsedMs: number | null;
  error: { id: string; message: string; retryable: boolean } | null;
  settings: Settings | null;
  hasApiKey: boolean;
  hotkeyConflicts: HotkeyConflict[];
  diagnostics: Diagnostics | null;
  promptBarOpen: boolean;
  settingsOpen: boolean;
  debugOpen: boolean;
  tab: SectionKey;
  apply: (event: Event) => void;
  setTab: (tab: SectionKey) => void;
}

export const useHud = create<HudState>()((set) => ({
  mode: 'off',
  pipeline: 'idle',
  shushUntil: null,
  lowConfidence: false,
  active: null,
  result: null,
  elapsedMs: null,
  error: null,
  settings: null,
  hasApiKey: false,
  hotkeyConflicts: [],
  diagnostics: null,
  promptBarOpen: false,
  settingsOpen: false,
  debugOpen: false,
  tab: 'notes',

  setTab: (tab) => set({ tab }),

  apply: (event) =>
    set((state) => {
      switch (event.type) {
        case 'state':
          return {
            mode: event.mode,
            pipeline: event.pipeline,
            shushUntil: event.shushUntil,
            lowConfidence: event.lowConfidence,
            ...(event.pipeline === 'idle' && !state.active
              ? { result: null, error: null }
              : {}),
          };
        case 'assistStart':
          return {
            active: {
              id: event.id,
              category: event.category,
              text: '',
              hold: event.hold,
              startedAt: Date.now(),
            },
            result: null,
            error: null,
            elapsedMs: null,
          };
        case 'assistChunk':
          if (!state.active || state.active.id !== event.id) return {};
          return { active: { ...state.active, text: state.active.text + event.text } };
        case 'assistDone':
          return {
            result: event.result,
            active: null,
            elapsedMs: state.active ? Date.now() - state.active.startedAt : null,
          };
        case 'assistError':
          return {
            error: { id: event.id, message: event.message, retryable: event.retryable },
            active: null,
          };
        case 'settings':
          // Whether the pane is *open* is main's call, not an inference from
          // the payload: main also has to toggle the window's click-through.
          return {
            settings: event.settings,
            hasApiKey: event.hasApiKey,
            hotkeyConflicts: event.hotkeyConflicts,
          };
        case 'diagnostics':
          return {
            diagnostics: {
              protectionVerified: event.protectionVerified,
              captureActive: event.captureActive,
              message: event.message,
              lastHashDistance: event.lastHashDistance,
              lastRequestMs: event.lastRequestMs,
            },
          };
        case 'ui':
          switch (event.ui.action) {
            case 'focusTab':
              return { tab: event.ui.tab };
            case 'promptBar':
              return { promptBarOpen: event.ui.open };
            case 'openSettings':
              return { settingsOpen: event.ui.open };
            case 'toggleDebug':
              return { debugOpen: !state.debugOpen };
            case 'copyActive':
              return {};
            default:
              return {};
          }
        default:
          return {};
      }
    }),
}));

/**
 * The one thing the HUD says out loud without being asked: capture exclusion
 * failed, or capture itself is down (SPEC 12 - silent failure is the worst
 * outcome, because the premise is that you trust this while looking elsewhere).
 */
export function selectBanner(state: HudState): string | null {
  const diagnostics = state.diagnostics;
  if (!diagnostics) return null;
  if (!diagnostics.protectionVerified) {
    return diagnostics.message ?? 'Halo is not hidden from screen capture.';
  }
  if (!diagnostics.captureActive && diagnostics.message) return diagnostics.message;
  return null;
}

/** Streaming text is parsed on every chunk; a finished result is authoritative. */
export function selectSections(state: HudState): Sections {
  if (state.active && !state.active.hold) return parseSections(state.active.text);
  return state.result?.sections ?? {};
}

export function selectTabs(state: HudState): SectionKey[] {
  return presentSections(selectSections(state));
}

/** The requested tab if it exists, otherwise the first one that does. */
export function selectTab(state: HudState): SectionKey {
  const tabs = selectTabs(state);
  return tabs.includes(state.tab) ? state.tab : (tabs[0] ?? 'notes');
}

export function selectCategory(state: HudState): Category {
  return state.active?.category ?? state.result?.category ?? 'none';
}

export type View = 'settings' | 'card' | 'pill';

export function selectView(state: HudState): View {
  if (state.settingsOpen) return 'settings';
  if (state.error) return 'card';
  if (state.pipeline === 'presented') return 'card';
  if (state.active && !state.active.hold) return 'card';
  return 'pill';
}

const STATUS: Record<PipelineStateName, string> = {
  idle: 'Ready',
  settling: 'Waiting',
  classifying: 'Looking',
  generating: 'Thinking',
  held: 'Reveal',
  presented: 'Answer',
  error: 'Error',
  shushed: 'Shush',
};

export function selectStatus(state: HudState): string {
  if (state.mode === 'off') return 'Off';
  return STATUS[state.pipeline];
}
