/**
 * Settings pane. The API key is write-only from here: the renderer is told
 * whether one exists and nothing more (SPEC 11).
 */

import { useEffect, useRef, useState } from 'react';
import { HUD_LIMITS } from '../../shared/constants';
import type { HotkeyConflict } from '../../shared/ipc';
import type { Mode, Settings as SettingsValue } from '../../shared/types';

const MODES: Mode[] = ['off', 'manual', 'auto'];

const MODE_HINTS: Record<Mode, string> = {
  off: 'Nothing is captured and nothing is sent.',
  manual: 'Answers only when you ask.',
  auto: 'Watches for the screen to settle, then holds an answer.',
};

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
  const hud = props.settings.hud;

  // The pane is only ever shown while main has made the window focusable, so
  // taking focus here is what makes Tab and Escape work without a mouse.
  useEffect(() => body.current?.focus(), []);

  return (
    <section className="settings surface" aria-label="Halo settings">
      <header className="card__head">
        <h1 className="card__eyebrow">Settings</h1>
        <span className="card__spacer" />
        <button type="button" className="icon-btn" onClick={props.onClose} aria-label="Close settings">
          ✕
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

        <h2 className="settings__section">Connection</h2>
        <label className="field">
          <span className="field__label">
            Anthropic API key
            <span className={`chip${props.hasApiKey ? ' chip--ok' : ''}`}>
              {props.hasApiKey ? 'stored' : 'required'}
            </span>
          </span>
          <div className="field__row">
            <input
              type="password"
              value={key}
              autoComplete="off"
              placeholder={props.hasApiKey ? '••••••••••••' : 'sk-ant-…'}
              onChange={(event) => setKey(event.target.value)}
            />
            <button
              type="button"
              className="ghost-btn"
              disabled={key.trim() === ''}
              onClick={() => {
                props.onSetApiKey(key.trim());
                setKey('');
              }}
            >
              Save
            </button>
          </div>
          <span className="field__hint">Stored by Windows, read only by Halo, never logged.</span>
        </label>

        <h2 className="settings__section">Behaviour</h2>
        <div className="field">
          <span className="field__label">Mode</span>
          <div className="segmented" role="group" aria-label="Mode">
            {MODES.map((mode) => (
              <button
                key={mode}
                type="button"
                className={`segmented__item${props.settings.mode === mode ? ' is-active' : ''}`}
                aria-pressed={props.settings.mode === mode}
                onClick={() => props.onPatch({ mode })}
              >
                {mode}
              </button>
            ))}
          </div>
          <span className="field__hint">{MODE_HINTS[props.settings.mode]}</span>
        </div>

        <label className="field">
          <span className="field__label">Script file</span>
          <input
            type="text"
            value={props.settings.scriptPath ?? ''}
            placeholder="C:\\Users\\you\\notes.md"
            onChange={(event) => props.onPatch({ scriptPath: event.target.value || null })}
          />
          <span className="field__hint">
            A markdown file — a resume, product notes, a style guide — added to every answer.
          </span>
        </label>

        <h2 className="settings__section">Size and appearance</h2>
        <label className="field">
          <span className="field__label">
            Card width <span className="field__value">{hud.width}px</span>
          </span>
          <input
            type="range"
            min={HUD_LIMITS.minWidth}
            max={HUD_LIMITS.maxWidth}
            step={20}
            value={hud.width}
            onChange={(event) => props.onPatch({ hud: { ...hud, width: Number(event.target.value) } })}
          />
        </label>

        <label className="field">
          <span className="field__label">
            Text size <span className="field__value">{hud.fontSize}px</span>
          </span>
          <input
            type="range"
            min={HUD_LIMITS.minFontSize}
            max={HUD_LIMITS.maxFontSize}
            value={hud.fontSize}
            onChange={(event) =>
              props.onPatch({ hud: { ...hud, fontSize: Number(event.target.value) } })
            }
          />
        </label>

        <label className="field">
          <span className="field__label">
            Opacity <span className="field__value">{Math.round(hud.opacity * 100)}%</span>
          </span>
          <input
            type="range"
            min={20}
            max={100}
            value={Math.round(hud.opacity * 100)}
            onChange={(event) =>
              props.onPatch({ hud: { ...hud, opacity: Number(event.target.value) / 100 } })
            }
          />
        </label>

        <h2 className="settings__section">Hotkeys</h2>
        <ul className="hotkeys">
          {Object.entries(props.settings.hotkeys).map(([action, accelerator]) => (
            <li key={action} className={conflicted.has(action) ? 'is-conflict' : ''}>
              <span className="hotkeys__action">{action}</span>
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
              {conflicted.has(action) && <span className="hotkeys__conflict">in use</span>}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
