/** The expanded HUD. Props in, pixels out: no pipeline logic lives here. */

import { CATEGORY_LABELS, type Category, type SectionKey, type Sections } from '../../shared/types';
import { Kbd } from './Kbd';
import { Markdown } from './Markdown';
import { ModeDot, type Tone } from './ModeDot';
import { Tabs } from './Tabs';

export interface CardProps {
  tone: Tone;
  category: Category;
  sections: Sections;
  tabs: SectionKey[];
  tab: SectionKey;
  streaming: boolean;
  fromCache: boolean;
  elapsedMs: number | null;
  error: { message: string; retryable: boolean } | null;
  lowConfidence: boolean;
  hotkeys: Record<string, string>;
  onSelectTab: (tab: SectionKey) => void;
  onDismiss: () => void;
  onCopy: (text: string) => void;
  onRegenerate: () => void;
}

function elapsed(ms: number | null): string | null {
  if (ms === null) return null;
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}

export function Card(props: CardProps): JSX.Element {
  const body = props.sections[props.tab] ?? '';
  const time = elapsed(props.elapsedMs);

  return (
    <section className="card surface" aria-label="Halo answer">
      <header className="card__head">
        <ModeDot tone={props.tone} lowConfidence={props.lowConfidence} />
        <h1 className="card__eyebrow">{CATEGORY_LABELS[props.category]}</h1>
        {props.fromCache && <span className="chip">cached</span>}
        <span className="card__spacer" />
        {time && <span className="card__time">{time}</span>}
        <button type="button" className="icon-btn" onClick={props.onDismiss} aria-label="Dismiss">
          ✕
        </button>
      </header>

      {props.streaming && <div className="card__progress" aria-hidden="true" />}

      <Tabs tabs={props.tabs} active={props.tab} onSelect={props.onSelectTab} />

      <div
        className="card__body"
        id="card-body"
        role="tabpanel"
        aria-labelledby={`tab-${props.tab}`}
        aria-live="polite"
        aria-busy={props.streaming}
        tabIndex={0}
      >
        {props.error ? (
          <p className="card__error">
            {props.error.message}
            {props.error.retryable ? ' — try again.' : ''}
          </p>
        ) : body ? (
          <>
            <Markdown source={body} onCopyCode={props.onCopy} />
            {props.streaming && <span className="caret" aria-hidden="true" />}
          </>
        ) : (
          <p className="card__placeholder">
            {props.streaming ? 'Reading the screen…' : 'Nothing to show.'}
          </p>
        )}
      </div>

      <footer className="card__foot">
        <button type="button" className="ghost-btn" onClick={() => props.onCopy(body)}>
          Copy
          <Kbd chord={props.hotkeys['copyCode']} />
        </button>
        <button type="button" className="ghost-btn" onClick={props.onRegenerate}>
          Regenerate
        </button>
        <span className="card__spacer" />
        <span className="card__hint">
          Dismiss
          <Kbd chord={props.hotkeys['dismiss']} />
        </span>
      </footer>
    </section>
  );
}
