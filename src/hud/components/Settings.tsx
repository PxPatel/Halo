/**
 * Settings pane. The API key is write-only from here: the renderer is told
 * whether one exists and nothing more (SPEC 11).
 */

import { useEffect, useRef, useState } from 'react';
import type { HotkeyConflict } from '../../shared/ipc';
import type { Mode, Settings as SettingsValue } from '../../shared/types';

const MODES: Mode[] = ['off', 'manual', 'auto'];

export interface SettingsProps {
  settings: SettingsValue;
  hasApiKey: boolean;
  conflicts: HotkeyConflict[];
  protectionVerified: boolean;
  onClose: () => void;
  onSetApiKey: (key: string) => void;
  onPatch: (patch: Partial<SettingsValue>) => void;
}

export function Settings(props: SettingsProps): JSX.Element {
  const [key, setKey] = useState('');
  const body = useRef<HTMLDivElement>(null);
  const conflicted = new Set(props.conflicts.map((conflict) => conflict.action));

  // The pane is only ever shown while main has made the window focusable, so
  // taking focus here is what makes Tab and Escape work without a mouse.
  useEffect(() => body.current?.focus(), []);

  return (
    <section className="settings" aria-label="Halo settings">
      <header className="card__header">
        <h1 className="card__title">Settings</h1>
        <button type="button" className="card__dismiss" onClick={props.onClose} aria-label="Close settings">
          ×
        </button>
      </header>

      <div
        ref={body}
        className="settings__body"
        tabIndex={0}
        onKeyDown={(event) => {
          if (event.key === 'Escape') props.onClose();
        }}
      >
        {!props.protectionVerified && (
          <p className="settings__warning" role="alert">
            Screen-capture exclusion is not active. Halo may be visible in screen shares.
          </p>
        )}

        <label className="settings__field">
          <span>Anthropic API key {props.hasApiKey ? '(stored)' : '(required)'}</span>
          <input
            type="password"
            value={key}
            autoComplete="off"
            placeholder={props.hasApiKey ? '••••••••' : 'sk-ant-…'}
            onChange={(event) => setKey(event.target.value)}
          />
        </label>
        <button
          type="button"
          disabled={key.trim() === ''}
          onClick={() => {
            props.onSetApiKey(key.trim());
            setKey('');
          }}
        >
          Save key
        </button>

        <label className="settings__field">
          <span>Mode</span>
          <select
            value={props.settings.mode}
            onChange={(event) => props.onPatch({ mode: event.target.value as Mode })}
          >
            {MODES.map((mode) => (
              <option key={mode} value={mode}>
                {mode}
              </option>
            ))}
          </select>
        </label>

        <label className="settings__field">
          <span>Script file (markdown)</span>
          <input
            type="text"
            value={props.settings.scriptPath ?? ''}
            placeholder="C:\\Users\\you\\notes.md"
            onChange={(event) => props.onPatch({ scriptPath: event.target.value || null })}
          />
        </label>

        <label className="settings__field">
          <span>Base font size ({props.settings.hud.fontSize}px)</span>
          <input
            type="range"
            min={11}
            max={28}
            value={props.settings.hud.fontSize}
            onChange={(event) =>
              props.onPatch({ hud: { ...props.settings.hud, fontSize: Number(event.target.value) } })
            }
          />
        </label>

        <label className="settings__field">
          <span>Opacity ({Math.round(props.settings.hud.opacity * 100)}%)</span>
          <input
            type="range"
            min={20}
            max={100}
            value={Math.round(props.settings.hud.opacity * 100)}
            onChange={(event) =>
              props.onPatch({
                hud: { ...props.settings.hud, opacity: Number(event.target.value) / 100 },
              })
            }
          />
        </label>

        <h2 className="settings__heading">Hotkeys</h2>
        <ul className="settings__hotkeys">
          {Object.entries(props.settings.hotkeys).map(([action, accelerator]) => (
            <li key={action} className={conflicted.has(action) ? 'settings__hotkey--conflict' : ''}>
              <span>{action}</span>
              <input
                type="text"
                value={accelerator}
                aria-label={`${action} hotkey`}
                onChange={(event) =>
                  props.onPatch({
                    hotkeys: { ...props.settings.hotkeys, [action]: event.target.value },
                  })
                }
              />
              {conflicted.has(action) && <span className="settings__conflict">in use</span>}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
