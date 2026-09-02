/** The expanded HUD. Props in, pixels out: no pipeline logic lives here. */

import { CATEGORY_LABELS, type Category, type Mode, type PipelineStateName, type SectionKey, type Sections } from '../../shared/types';
import { Markdown } from './Markdown';
import { ModeDot } from './ModeDot';
import { Tabs } from './Tabs';

export interface CardProps {
  mode: Mode;
  pipeline: PipelineStateName;
  category: Category;
  sections: Sections;
  tabs: SectionKey[];
  tab: SectionKey;
  streaming: boolean;
  elapsedMs: number | null;
  error: { message: string; retryable: boolean } | null;
  lowConfidence: boolean;
  onSelectTab: (tab: SectionKey) => void;
  onDismiss: () => void;
  onCopy: () => void;
  onRegenerate: () => void;
}

function elapsed(ms: number | null): string {
  if (ms === null) return '';
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}

export function Card(props: CardProps): JSX.Element {
  const body = props.sections[props.tab] ?? '';
  return (
    <section className="card" aria-label="Halo answer">
      <header className="card__header">
        <ModeDot mode={props.mode} pipeline={props.pipeline} lowConfidence={props.lowConfidence} />
        <h1 className="card__title">{CATEGORY_LABELS[props.category]}</h1>
        <button type="button" className="card__dismiss" onClick={props.onDismiss} aria-label="Dismiss">
          ×
        </button>
      </header>

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
          <Markdown source={body} />
        ) : (
          <p className="card__placeholder">{props.streaming ? 'Thinking…' : 'Nothing to show.'}</p>
        )}
      </div>

      <footer className="card__footer">
        <button type="button" onClick={props.onCopy}>
          Copy
        </button>
        <button type="button" onClick={props.onRegenerate}>
          Regenerate
        </button>
        <span className="card__elapsed">{elapsed(props.elapsedMs)}</span>
      </footer>
    </section>
  );
}
