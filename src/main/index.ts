/**
 * App lifecycle and wiring. Nothing else belongs in this file (SPEC 3).
 */

import { app, clipboard, dialog, screen } from 'electron';
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
import { defaultPosition, moveBy, setInteractive, setOpacity, setWidth } from './window/placement';
import { assertProtection, platformSupport } from './window/protection';
import { CAPTURE, HUD_LIMITS } from '../shared/constants';
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

  let captureRetry: ReturnType<typeof setTimeout> | null = null;
  let captureAttempts = 0;

  const cancelCaptureRetry = (): void => {
    if (captureRetry === null) return;
    clearTimeout(captureRetry);
    captureRetry = null;
  };

  const retryCapture = (delayMs: number): void => {
    cancelCaptureRetry();
    captureRetry = setTimeout(ensureCapture, delayMs);
  };

  function ensureCapture(): void {
    cancelCaptureRetry();
    if (capture.active || settings.get().mode === 'off') return;
    capture
      .start(settings.get().displayId)
      .then(() => {
        captureAttempts = 0;
        diagnostics();
      })
      .catch((error: unknown) => {
        log.error('capture', `could not start: ${String(error)}`);
        const delay = Math.min(
          CAPTURE.retryMaxMs,
          CAPTURE.retryBaseMs * 2 ** Math.min(captureAttempts, 8),
        );
        captureAttempts += 1;
        diagnostics(`Screen capture unavailable — retrying in ${Math.round(delay / 1000)}s.`);
        retryCapture(delay);
      });
  }

  const applyMode = (mode: Mode): void => {
    runner.setMode(mode);
    settings.update({ mode });
    if (mode === 'off') {
      screenTrigger.stop();
      manualTrigger.stop();
      cancelCaptureRetry();
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
    diagnostics('Reconnecting to the display…');
    captureAttempts = 0;
    retryCapture(CAPTURE.retryBaseMs);
  });

  // A display change can rebuild the surfaces the exclusion flag lives on.
  screen.on('display-metrics-changed', () => assertProtection(hud));
  screen.on('display-added', () => assertProtection(hud));
  screen.on('display-removed', () => assertProtection(hud));

  captureWindow.webContents.on('render-process-gone', (_event, details) => {
    log.error('capture', `capture renderer gone: ${details.reason}`);
    if (!captureWindow.isDestroyed()) captureWindow.reload();
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

  /**
   * The HUD is click-through and unfocusable except while a surface that needs
   * the keyboard is open (SPEC 5). Two of them qualify - the prompt bar and the
   * settings pane - so main tracks both and derives one interactive state.
   */
  const surfaces = { promptBar: false, settings: false };

  const syncInteractive = (): void => {
    setInteractive(hud, surfaces.promptBar || surfaces.settings);
  };

  const promptBar = (open: boolean): void => {
    surfaces.promptBar = open;
    syncInteractive();
    bridge.emit({ type: 'ui', ui: { action: 'promptBar', open } });
  };

  const settingsPane = (open: boolean): void => {
    surfaces.settings = open;
    syncInteractive();
    bridge.emit({ type: 'ui', ui: { action: 'openSettings', open } });
  };

  // Opacity goes through a layered-window path on Windows, which is close
  // enough to the display-affinity machinery to be worth re-asserting after.
  const changeOpacity = (value: number): void => {
    const applied = setOpacity(hud, value);
    assertProtection(hud);
    settings.update({ hud: { ...settings.get().hud, opacity: applied } });
    pushSettings();
  };

  const changeWidth = (width: number): void => {
    const applied = setWidth(hud, width);
    assertProtection(hud);
    settings.update({ hud: { ...settings.get().hud, width: applied } });
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
    opacityDown: () => changeOpacity(settings.get().hud.opacity - 0.1),
    opacityUp: () => changeOpacity(settings.get().hud.opacity + 0.1),
    widthDown: () => changeWidth(settings.get().hud.width - HUD_LIMITS.widthStep),
    widthUp: () => changeWidth(settings.get().hud.width + HUD_LIMITS.widthStep),
    copyCode: () => bridge.emit({ type: 'ui', ui: { action: 'copyActive' } }),
    tabCode: () => bridge.emit({ type: 'ui', ui: { action: 'focusTab', tab: 'code' } }),
    tabNotes: () => bridge.emit({ type: 'ui', ui: { action: 'focusTab', tab: 'notes' } }),
    tabSay: () => bridge.emit({ type: 'ui', ui: { action: 'focusTab', tab: 'say' } }),
    debug: () => bridge.emit({ type: 'ui', ui: { action: 'toggleDebug' } }),
    settings: () => settingsPane(!surfaces.settings),
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
      case 'setOpacity': return changeOpacity(command.value);
      case 'move': return move(command.dx, command.dy);
      case 'setPromptBarOpen': return promptBar(command.open);
      case 'setSettingsOpen': return settingsPane(command.open);
      case 'updateSettings': {
        const updated = settings.update(command.patch);
        if (command.patch.hotkeys) hotkeys.apply(updated.hotkeys, handlers);
        // Width and opacity are window state, not just stored values.
        if (command.patch.hud?.width !== undefined) setWidth(hud, updated.hud.width);
        if (command.patch.hud?.opacity !== undefined) setOpacity(hud, updated.hud.opacity);
        if (command.patch.hud !== undefined) assertProtection(hud);
        rebuildProvider();
        return pushSettings();
      }
      case 'ready': return publishAll();
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

  const publishAll = (): void => {
    log.info('ipc', `publishing state to the HUD (apiKey=${keys.has() ? 'stored' : 'missing'})`);
    pushSettings();
    runner.publishState();
    diagnostics();
    // A reloaded HUD has forgotten which surfaces were open; main has not.
    // With no key there is nothing else worth showing, so settings opens itself.
    promptBar(surfaces.promptBar);
    settingsPane(keys.has() ? surfaces.settings : true);
  };

  // Both, deliberately: `did-finish-load` can fire before the HUD's listener
  // is attached, and the HUD's `ready` can arrive before main finished wiring.
  hud.webContents.on('did-finish-load', publishAll);

  applyMode(settings.get().mode);
  app.on('before-quit', () => {
    runner.dispose();
    bridge.dispose();
    hotkeys.unregisterAll();
  });
}
