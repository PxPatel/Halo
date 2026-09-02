/**
 * The only door between renderers and main: a typed command/event API and
 * nothing else. No Node, no key material (SPEC 2.1).
 *
 * One file serves both renderers, and each gets exactly one surface: the HUD
 * can never reach capture, and capture can never issue HUD commands. Which
 * surface to expose arrives as an `additionalArguments` flag, because a
 * sandboxed preload cannot load a second file of its own.
 */

import { contextBridge, ipcRenderer } from 'electron';
import {
  CAPTURE_FLAG,
  CHANNELS,
  type CaptureCommand,
  type CaptureMessage,
  type Command,
  type Event,
  type HaloApi,
  type HaloCaptureApi,
} from '../shared/ipc';

const hud: HaloApi = {
  send(command: Command): void {
    ipcRenderer.send(CHANNELS.command, command);
  },
  onEvent(cb: (event: Event) => void): () => void {
    const listener = (_e: unknown, event: Event): void => cb(event);
    ipcRenderer.on(CHANNELS.event, listener);
    return () => ipcRenderer.removeListener(CHANNELS.event, listener);
  },
};

const capture: HaloCaptureApi = {
  send(message: CaptureMessage): void {
    ipcRenderer.send(CHANNELS.captureMessage, message);
  },
  onCommand(cb: (command: CaptureCommand) => void): () => void {
    const listener = (_e: unknown, command: CaptureCommand): void => cb(command);
    ipcRenderer.on(CHANNELS.captureCommand, listener);
    return () => ipcRenderer.removeListener(CHANNELS.captureCommand, listener);
  },
};

if (process.argv.includes(CAPTURE_FLAG)) contextBridge.exposeInMainWorld('haloCapture', capture);
else contextBridge.exposeInMainWorld('halo', hud);
