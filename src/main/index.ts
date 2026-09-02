/**
 * App lifecycle and wiring. Nothing else belongs in this file (SPEC 3).
 */

import { app, clipboard, dialog } from 'electron';
import { AnthropicProvider } from './ai/AnthropicProvider';
import { VisionExtractor } from './ai/extractors/VisionExtractor';
import type { ModelProvider } from './ai/ModelProvider';
import { readScriptFile } from './ai/prompts';
import { ElectronCaptureSource } from './capture/ElectronCaptureSource';
import { HotkeyRegistry } from './hotkeys/registry';
import { IpcBridge } from './ipc/bridge';
import { log } from './log';
import { ResultCache } from './pipeline/cache';
import { PipelineRunner } from './pipeline/runner';
import { KeyStore } from './secrets/keyStore';
import { SettingsStore } from './settings/store';
import { ManualTrigger } from './trigger/ManualTrigger';
import { ScreenTrigger } from './trigger/ScreenTrigger';
import { createCaptureWindow, createHudWindow } from './window/HaloWindow';
import { defaultPosition, moveBy, setInteractive, setOpacity } from './window/placement';
import { platformSupport } from './window/protection';
import type { Command } from '../shared/ipc';
import type { Mode } from '../shared/types';

const MODE_CYCLE: Mode[] = ['off', 'manual', 'auto'];

if (!app.requestSingleInstanceLock()) app.quit();

app.whenReady().then(start).catch((error: unknown) => {
  log.error('app', `startup failed: ${String(error)}`);
  app.quit();
});

app.on('window-all-closed', () => app.quit());

function start(): void {
  const support = platformSupport();
  if (!support.supported) {
    dialog.showErrorBox('Halo cannot run here', support.message ?? 'Unsupported platform.');
    app.quit();
    return;
  }

  const settings = new SettingsStore();
  const keys = new KeyStore();
  if (!settings.hasStored()) {
    settings.update({ hud: { ...settings.get().hud, position: defaultPosition() } });
  }
  const { win: hud, protection } = createHudWindow(settings.get());
  const captureWindow = createCaptureWindow();
  const bridge = new IpcBridge(hud, captureWindow);
  const capture = new ElectronCaptureSource(bridge.captureTransport);
  const hotkeys = new HotkeyRegistry();

  let provider: ModelProvider | null = null;
  const rebuildProvider = (): void => {
    const key = keys.read();
    const current = settings.get();
    provider = key
      ? new AnthropicProvider({
          apiKey: key,
          models: current.models,
          script: readScriptFile(current.scriptPath),
        })
      : null;
    void provider?.warmup();
  };
  rebuildProvider();

  const runner = new PipelineRunner(
    {
      provider: () => provider,
      capture,
      extractor: new VisionExtractor(),
      cache: new ResultCache(),
      emit: (event) => bridge.emit(event),
    },
    settings.get().mode,
  );

  const screenTrigger = new ScreenTrigger(capture);
  const manualTrigger = new ManualTrigger(capture);
  screenTrigger.onSettle((event) => runner.settled(event));
  manualTrigger.onFire((request) =>
    request.userPrompt === undefined ? runner.trigger() : runner.submitPrompt(request.userPrompt),
  );

  const diagnostics = (message?: string): void =>
    bridge.emit({
      type: 'diagnostics',
      protectionVerified: protection.protectionVerified,
      captureActive: capture.active,
      message: message ?? protection.message,
      lastRequestMs: runner.lastRequestMs ?? undefined,
    });

  const pushSettings = (): void =>
    bridge.emit({
      type: 'settings',
      settings: settings.get(),
      hasApiKey: keys.has(),
      hotkeyConflicts: hotkeys.conflicts,
    });

  const ensureCapture = (): void => {
    if (capture.active) return;
    capture
      .start(settings.get().displayId)
      .then(() => diagnostics())
      .catch((error: unknown) => {
        log.error('capture', `could not start: ${String(error)}`);
        diagnostics('Screen capture is unavailable.');
      });
  };

  const applyMode = (mode: Mode): void => {
    runner.setMode(mode);
    settings.update({ mode });
    if (mode === 'off') {
      screenTrigger.stop();
      manualTrigger.stop();
      capture.stop();
    } else {
      manualTrigger.start();
      ensureCapture();
      if (mode === 'auto') screenTrigger.start();
      else screenTrigger.stop();
    }
    pushSettings();
    diagnostics();
  };

  capture.onStreamEnded((reason) => {
    log.warn('capture', `stream ended: ${reason}`);
    diagnostics('Reconnecting to the display...');
    setTimeout(ensureCapture, 1_000);
  });
  capture.onHash((_hash, distance) =>
    bridge.emit({
      type: 'diagnostics',
      protectionVerified: protection.protectionVerified,
      captureActive: capture.active,
      lastHashDistance: distance,
      lastRequestMs: runner.lastRequestMs ?? undefined,
    }),
  );

  const promptBar = (open: boolean): void => {
    setInteractive(hud, open);
    bridge.emit({ type: 'ui', ui: { action: 'promptBar', open } });
  };

  const nudgeOpacity = (delta: number): void => {
    const value = setOpacity(hud, settings.get().hud.opacity + delta);
    settings.update({ hud: { ...settings.get().hud, opacity: value } });
    pushSettings();
  };

  const move = (dx: number, dy: number): void => {
    const position = moveBy(hud, dx, dy);
    settings.update({ hud: { ...settings.get().hud, position } });
  };

  const handlers = {
    toggleHud: () => (hud.isVisible() ? hud.hide() : hud.showInactive()),
    captureNow: () => manualTrigger.request(),
    openPrompt: () => promptBar(true),
    cycleMode: () =>
      applyMode(MODE_CYCLE[(MODE_CYCLE.indexOf(settings.get().mode) + 1) % MODE_CYCLE.length]!),
    reveal: () => runner.reveal(),
    dismiss: () => runner.dismiss(),
    shush: () => runner.shush(5),
    moveUp: () => move(0, -1),
    moveDown: () => move(0, 1),
    moveLeft: () => move(-1, 0),
    moveRight: () => move(1, 0),
    opacityDown: () => nudgeOpacity(-0.1),
    opacityUp: () => nudgeOpacity(0.1),
    copyCode: () => bridge.emit({ type: 'ui', ui: { action: 'copyActive' } }),
    tabCode: () => bridge.emit({ type: 'ui', ui: { action: 'focusTab', tab: 'code' } }),
    tabNotes: () => bridge.emit({ type: 'ui', ui: { action: 'focusTab', tab: 'notes' } }),
    tabSay: () => bridge.emit({ type: 'ui', ui: { action: 'focusTab', tab: 'say' } }),
    debug: () => bridge.emit({ type: 'ui', ui: { action: 'toggleDebug' } }),
  };
  const conflicts = hotkeys.apply(settings.get().hotkeys, handlers);
  if (conflicts.length > 0) log.warn('hotkeys', `${conflicts.length} binding(s) unavailable`);

  bridge.onCommand((command: Command) => {
    switch (command.type) {
      case 'setMode': return applyMode(command.mode);
      case 'trigger': return manualTrigger.request();
      case 'submitPrompt': return manualTrigger.request(command.text);
      case 'reveal': return runner.reveal();
      case 'dismiss': return runner.dismiss();
      case 'shush': return runner.shush(command.minutes);
      case 'setOpacity': {
        const value = setOpacity(hud, command.value);
        settings.update({ hud: { ...settings.get().hud, opacity: value } });
        return pushSettings();
      }
      case 'move': return move(command.dx, command.dy);
      case 'setPromptBarOpen': return promptBar(command.open);
      case 'updateSettings': {
        const updated = settings.update(command.patch);
        if (command.patch.hotkeys) hotkeys.apply(updated.hotkeys, handlers);
        rebuildProvider();
        return pushSettings();
      }
      case 'copyToClipboard': return clipboard.writeText(command.text);
      case 'setApiKey': {
        keys.write(command.key);
        rebuildProvider();
        return pushSettings();
      }
      default: {
        const exhaustive: never = command;
        void exhaustive;
      }
    }
  });

  hud.webContents.on('did-finish-load', () => {
    pushSettings();
    runner.publishState();
    diagnostics();
    if (!keys.has()) bridge.emit({ type: 'ui', ui: { action: 'openSettings', open: true } });
  });

  applyMode(settings.get().mode);
  app.on('before-quit', () => {
    runner.dispose();
    bridge.dispose();
    hotkeys.unregisterAll();
  });
}
