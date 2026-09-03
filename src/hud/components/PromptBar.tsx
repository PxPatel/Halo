/** The only focusable surface in the HUD besides settings (SPEC 5). */

import { useEffect, useRef, useState } from 'react';

const COMMANDS = ['/explain', '/optimize', '/edge', '/shorter', '/say', '/again'];

export interface PromptBarProps {
  open: boolean;
  onSubmit: (text: string) => void;
  onClose: () => void;
}

export function PromptBar(props: PromptBarProps): JSX.Element | null {
  const [text, setText] = useState('');
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (props.open) input.current?.focus();
    else setText('');
  }, [props.open]);

  if (!props.open) return null;

  const hints = text.startsWith('/')
    ? COMMANDS.filter((command) => command.startsWith(text.split(' ')[0] ?? ''))
    : [];

  return (
    <form
      className="prompt surface"
      onSubmit={(event) => {
        event.preventDefault();
        const value = text.trim();
        if (value) props.onSubmit(value);
        props.onClose();
      }}
    >
      <div className="prompt__row">
        <span className="prompt__caret" aria-hidden="true">
          ›
        </span>
        <input
          ref={input}
          className="prompt__input"
          value={text}
          placeholder="Ask a follow-up, or / for commands"
          aria-label="Ask Halo"
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') props.onClose();
          }}
        />
      </div>
      {hints.length > 0 && (
        <ul className="prompt__hints" aria-label="Slash commands">
          {hints.map((command) => (
            <li key={command}>
              <button type="button" onClick={() => setText(`${command} `)}>
                {command}
              </button>
            </li>
          ))}
        </ul>
      )}
    </form>
  );
}
