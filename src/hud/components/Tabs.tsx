/** Code / Notes / Say as a segmented control. Absent sections are not rendered. */

import type { CSSProperties } from 'react';
import type { SectionKey } from '../../shared/types';

const LABELS: Record<SectionKey, string> = { code: 'Code', notes: 'Notes', say: 'Say' };

export interface TabsProps {
  tabs: SectionKey[];
  active: SectionKey;
  onSelect: (tab: SectionKey) => void;
}

export function Tabs(props: TabsProps): JSX.Element | null {
  if (props.tabs.length === 0) return null;
  const index = Math.max(0, props.tabs.indexOf(props.active));
  const style = { '--count': props.tabs.length, '--index': index } as CSSProperties;

  return (
    <div className="tabs" role="tablist" aria-label="Answer sections" style={style}>
      <span className="tabs__indicator" aria-hidden="true" />
      {props.tabs.map((tab, position) => (
        <button
          key={tab}
          type="button"
          role="tab"
          id={`tab-${tab}`}
          aria-selected={tab === props.active}
          aria-controls="card-body"
          tabIndex={tab === props.active ? 0 : -1}
          className={`tabs__tab${tab === props.active ? ' is-active' : ''}`}
          onClick={() => props.onSelect(tab)}
        >
          <span>{LABELS[tab]}</span>
          <span className="tabs__index" aria-hidden="true">
            {position + 1}
          </span>
        </button>
      ))}
    </div>
  );
}
