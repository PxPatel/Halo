/**
 * The single place main talks to renderers (SPEC 2.1). Commands arrive typed,
 * events leave typed, and the capture window has its own channel so the HUD
 * never sees capture traffic.
 */

import { ipcMain, type BrowserWindow } from 'electron';
import { CHANNELS, type CaptureCommand, type CaptureMessage, type Command, type Event } from '../../shared/ipc';
import type { Unsubscribe } from '../../shared/types';
import { log } from '../log';
import type { CaptureTransport } from '../capture/ElectronCaptureSource';

const COMMAND_TYPES = new Set<Command['type']>([
  'setMode',
  'trigger',
  'submitPrompt',
  'reveal',
  'dismiss',
  'shush',
  'setOpacity',
  'move',
  'setPromptBarOpen',
  'updateSettings',
  'setApiKey',
  'copyToClipboard',
]);

function isCommand(value: unknown): value is Command {
  if (typeof value !== 'object' || value === null) return false;
  const type = (value as { type?: unknown }).type;
  return typeof type === 'string' && COMMAND_TYPES.has(type as Command['type']);
}

export class IpcBridge {
  private readonly commandCbs = new Set<(command: Command) => void>();
  private readonly captureCbs = new Set<(message: CaptureMessage) => void>();

  constructor(
    private readonly hud: BrowserWindow,
    private readonly capture: BrowserWindow,
  ) {
    ipcMain.on(CHANNELS.command, (_event, payload: unknown) => {
      if (!isCommand(payload)) {
        log.warn('ipc', 'dropped malformed command');
        return;
      }
      for (const cb of this.commandCbs) cb(payload);
    });

    ipcMain.on(CHANNELS.captureMessage, (_event, payload: CaptureMessage) => {
      for (const cb of this.captureCbs) cb(payload);
    });
  }

  onCommand(cb: (command: Command) => void): Unsubscribe {
    this.commandCbs.add(cb);
    return () => this.commandCbs.delete(cb);
  }

  emit(event: Event): void {
    if (this.hud.isDestroyed()) return;
    this.hud.webContents.send(CHANNELS.event, event);
  }

  /** The transport ElectronCaptureSource drives. */
  get captureTransport(): CaptureTransport {
    return {
      send: (command: CaptureCommand) => {
        if (this.capture.isDestroyed()) return;
        this.capture.webContents.send(CHANNELS.captureCommand, command);
      },
      onMessage: (cb) => {
        this.captureCbs.add(cb);
        return () => this.captureCbs.delete(cb);
      },
    };
  }

  dispose(): void {
    ipcMain.removeAllListeners(CHANNELS.command);
    ipcMain.removeAllListeners(CHANNELS.captureMessage);
    this.commandCbs.clear();
    this.captureCbs.clear();
  }
}
