/** Code / Notes / Say. A tab whose section is absent is not rendered. */

import type { SectionKey } from '../../shared/types';

const LABELS: Record<SectionKey, string> = { code: 'Code', notes: 'Notes', say: 'Say' };

export interface TabsProps {
  tabs: SectionKey[];
  active: SectionKey;
  onSelect: (tab: SectionKey) => void;
}

export function Tabs(props: TabsProps): JSX.Element | null {
  if (props.tabs.length === 0) return null;
  return (
    <div className="tabs" role="tablist" aria-label="Answer sections">
      {props.tabs.map((tab, index) => (
        <button
          key={tab}
          type="button"
          role="tab"
          id={`tab-${tab}`}
          aria-selected={tab === props.active}
          aria-controls="card-body"
          tabIndex={tab === props.active ? 0 : -1}
          className={`tabs__tab${tab === props.active ? ' tabs__tab--active' : ''}`}
          onClick={() => props.onSelect(tab)}
        >
          {LABELS[tab]}
          <span className="tabs__hint" aria-hidden="true">
            {index + 1}
          </span>
        </button>
      ))}
    </div>
  );
}
