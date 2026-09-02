/**
 * View routing and event subscription. Every decision it makes is about
 * *rendering*; pipeline decisions arrive from main as state (SPEC 15).
 */

import { useEffect } from 'react';
import { TUNING } from '../shared/constants';
import { Card } from './components/Card';
import { Debug } from './components/Debug';
import { Pill } from './components/Pill';
import { PromptBar } from './components/PromptBar';
import { Settings } from './components/Settings';
import {
  selectCategory,
  selectSections,
  selectStatus,
  selectTab,
  selectTabs,
  selectView,
  send,
  useHud,
} from './store';

function minutesLeft(shushUntil: number | null): number | null {
  if (shushUntil === null) return null;
  const remaining = Math.ceil((shushUntil - Date.now()) / 60_000);
  return remaining > 0 ? remaining : null;
}

export function App(): JSX.Element {
  const state = useHud();
  const sections = selectSections(state);
  const tab = selectTab(state);
  const view = selectView(state);

  useEffect(() => {
    const copyActive = (): void => {
      const current = useHud.getState();
      const text = selectSections(current).code ?? selectSections(current)[selectTab(current)] ?? '';
      if (text) send({ type: 'copyToClipboard', text });
    };
    return window.halo.onEvent((event) => {
      useHud.getState().apply(event);
      if (event.type === 'ui' && event.ui.action === 'copyActive') copyActive();
    });
  }, []);

  const fontSize = state.settings?.hud.fontSize ?? 14;

  return (
    <div
      className={`hud hud--${view}`}
      style={{
        // Layout must not break at 20px, so every size is relative to this.
        fontSize: `${fontSize}px`,
        maxHeight: `${Math.round(TUNING.hud.maxCardHeightPct * 100)}vh`,
      }}
    >
      {state.diagnostics && !state.diagnostics.protectionVerified && (
        <p className="banner" role="alert">
          {state.diagnostics.message ?? 'Halo is not hidden from screen capture.'}
        </p>
      )}

      {view === 'settings' && state.settings ? (
        <Settings
          settings={state.settings}
          hasApiKey={state.hasApiKey}
          conflicts={state.hotkeyConflicts}
          protectionVerified={state.diagnostics?.protectionVerified ?? true}
          onClose={() => state.setSettingsOpen(false)}
          onSetApiKey={(key) => send({ type: 'setApiKey', key })}
          onPatch={(patch) => send({ type: 'updateSettings', patch })}
        />
      ) : view === 'card' ? (
        <Card
          mode={state.mode}
          pipeline={state.pipeline}
          category={selectCategory(state)}
          sections={sections}
          tabs={selectTabs(state)}
          tab={tab}
          streaming={state.active !== null}
          elapsedMs={state.elapsedMs}
          error={state.error}
          lowConfidence={state.lowConfidence}
          onSelectTab={state.setTab}
          onDismiss={() => send({ type: 'dismiss' })}
          onCopy={() => {
            const text = sections.code ?? sections[tab] ?? '';
            if (text) send({ type: 'copyToClipboard', text });
          }}
          onRegenerate={() => send({ type: 'submitPrompt', text: '/again' })}
        />
      ) : (
        <Pill
          mode={state.mode}
          pipeline={state.pipeline}
          status={selectStatus(state)}
          lowConfidence={state.lowConfidence}
          shushMinutesLeft={minutesLeft(state.shushUntil)}
        />
      )}

      <PromptBar
        open={state.promptBarOpen}
        onSubmit={(text) => send({ type: 'submitPrompt', text })}
        onClose={() => send({ type: 'setPromptBarOpen', open: false })}
      />

      {state.debugOpen && (
        <Debug
          mode={state.mode}
          pipeline={state.pipeline}
          shushUntil={state.shushUntil}
          diagnostics={state.diagnostics}
        />
      )}
    </div>
  );
}
