/**
 * The IPC contract (SPEC 5). Two discriminated unions plus the capture
 * renderer's private channel. Both sides import this file; there is no
 * untyped ipcRenderer.send anywhere in the codebase.
 */

import type {
  Category,
  Mode,
  PipelineStateName,
  Rect,
  SectionKey,
  Settings,
  AssistanceResult,
} from './types';

/** Renderer -> main. Renderers request; they never act. */
export type Command =
  | { type: 'setMode'; mode: Mode }
  | { type: 'trigger' }
  | { type: 'submitPrompt'; text: string }
  | { type: 'reveal' }
  | { type: 'dismiss' }
  | { type: 'shush'; minutes: number }
  | { type: 'setOpacity'; value: number }
  | { type: 'move'; dx: number; dy: number }
  | { type: 'setPromptBarOpen'; open: boolean }
  /**
   * Not in SPEC 5's list, and the pair to `setPromptBarOpen`: the settings
   * pane also needs keyboard focus, so main has to know when it is open in
   * order to turn click-through off and back on again.
   */
  | { type: 'setSettingsOpen'; open: boolean }
  | { type: 'updateSettings'; patch: Partial<Settings> }
  /**
   * Not in SPEC 5's list. Required by SPEC 11/12: the key never travels as
   * part of Settings, but the settings pane has to be able to store one.
   */
  | { type: 'setApiKey'; key: string }
  /**
   * Not in SPEC 5's list. Ctrl+Shift+C must copy while the HUD is unfocused,
   * where the renderer's clipboard API is unreliable; main owns the clipboard.
   */
  | { type: 'copyToClipboard'; text: string }
  /**
   * Not in SPEC 5's list. Main's authoritative state is pushed on
   * `did-finish-load`, which can fire before the renderer's event listener is
   * attached; the renderer asks for a fresh push once it is really listening.
   */
  | { type: 'ready' };

/**
 * UI-only instructions that originate from a global hotkey. The HUD is not
 * focusable (SPEC 6), so keystrokes never reach it directly; main forwards
 * them. See CLAUDE.md, "Deviations".
 */
export type UiAction =
  | { action: 'focusTab'; tab: SectionKey }
  | { action: 'copyActive' }
  | { action: 'promptBar'; open: boolean }
  | { action: 'toggleDebug' }
  | { action: 'openSettings'; open: boolean };

/** Main -> renderer. Main is authoritative for all state. */
export type Event =
  | {
      type: 'state';
      mode: Mode;
      pipeline: PipelineStateName;
      shushUntil: number | null;
      /** Sub-confidence-floor classification: a badge on the pill, not a card. */
      lowConfidence: boolean;
    }
  | {
      type: 'assistStart';
      id: string;
      category: Category;
      /** Auto-mode work is held: generate now, show on reveal (SPEC 9). */
      hold: boolean;
    }
  | { type: 'assistChunk'; id: string; text: string }
  | { type: 'assistDone'; result: AssistanceResult }
  | { type: 'assistError'; id: string; message: string; retryable: boolean }
  | {
      type: 'settings';
      settings: Settings;
      /** The renderer learns only whether a key exists, never the key. */
      hasApiKey: boolean;
      /** Bindings another app already holds, so settings can mark them. */
      hotkeyConflicts: HotkeyConflict[];
    }
  | {
      type: 'diagnostics';
      protectionVerified: boolean;
      captureActive: boolean;
      message?: string;
      lastHashDistance?: number;
      lastRequestMs?: number;
    }
  | { type: 'ui'; ui: UiAction };

export interface HotkeyConflict {
  action: string;
  accelerator: string;
  reason: string;
}

/** Main -> capture renderer. */
export type CaptureCommand =
  | { type: 'start'; requestId: string; sourceId: string }
  | { type: 'stop'; requestId: string }
  | {
      type: 'grab';
      requestId: string;
      region?: Rect;
      maxEdge: number;
      quality: number;
    };

/** Capture renderer -> main. */
export type CaptureMessage =
  /** Sent once the command listener exists. Anything sent before this is lost. */
  | { type: 'ready' }
  | { type: 'hash'; hash: string; distance: number; at: number }
  | { type: 'settled'; hash: string; thumbnail: string; settledAt: number }
  | { type: 'streamEnded'; reason: string }
  | { type: 'ok'; requestId: string }
  | {
      type: 'frame';
      requestId: string;
      jpegBase64: string;
      width: number;
      height: number;
      capturedAt: number;
    }
  | { type: 'failed'; requestId: string; message: string };

/** What the preload exposes to the HUD renderer. */
export interface HaloApi {
  send(command: Command): void;
  onEvent(cb: (event: Event) => void): () => void;
}

/** What the preload exposes to the hidden capture renderer. */
export interface HaloCaptureApi {
  send(message: CaptureMessage): void;
  onCommand(cb: (command: CaptureCommand) => void): () => void;
}

/**
 * Marks the capture renderer so the single preload knows which surface to
 * expose. Passed through BrowserWindow `additionalArguments`.
 */
export const CAPTURE_FLAG = '--halo-capture';

export const CHANNELS = {
  command: 'halo:command',
  event: 'halo:event',
  captureCommand: 'halo:capture:command',
  captureMessage: 'halo:capture:message',
} as const;
