import { useRef } from 'react';
import type { KeyboardEvent } from 'react';
import type { RiverTab } from './model';

const TABS: { id: RiverTab; label: string }[] = [
  { id: 'flow', label: 'Flow' },
  { id: 'years', label: 'Year by year' },
];

export const tabId = (t: RiverTab) => `river-tab-${t}`;
export const panelId = (t: RiverTab) => `river-panel-${t}`;

function Glyph({ tab }: { tab: RiverTab }) {
  return tab === 'flow' ? (
    <svg className="river-tabs__glyph" viewBox="0 0 20 16" aria-hidden="true">
      <path d="M2 3h2v4H2zM16 2h2v3h-2zM16 8h2v6h-2zM2 10h2v4H2z" />
      <path className="river-tabs__flow" d="M4 5C10 5 10 3.5 16 3.5M4 5.5C10 5.5 10 11 16 11M4 12C10 12 10 12 16 12" />
    </svg>
  ) : (
    <svg className="river-tabs__glyph" viewBox="0 0 20 16" aria-hidden="true">
      <path d="M2 14V9C6 7 9 10 12 7S16 4 18 4V14Z" />
      <path className="river-tabs__flow" d="M2 6C6 5 9 7 12 4.5S16 2 18 2" />
    </svg>
  );
}

/**
 * The River's two charts as ARIA tabs: arrow keys, Home and End move between them (and select,
 * so the URL follows); only the selected tab names a panel, the one that is rendered.
 */
export function RiverTabs({ value, onChange }: { value: RiverTab; onChange: (t: RiverTab) => void }) {
  const refs = useRef<Partial<Record<RiverTab, HTMLButtonElement | null>>>({});
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const i = TABS.findIndex((t) => t.id === value);
    let next: number;
    switch (e.key) {
      case 'ArrowRight': next = (i + 1) % TABS.length; break;
      case 'ArrowLeft': next = (i - 1 + TABS.length) % TABS.length; break;
      case 'Home': next = 0; break;
      case 'End': next = TABS.length - 1; break;
      default: return;
    }
    e.preventDefault();
    const t = TABS[next].id;
    onChange(t);
    refs.current[t]?.focus();
  };
  return (
    <div className="river-tabs" role="tablist" aria-label="Chart" onKeyDown={onKeyDown}>
      {TABS.map((t) => {
        const on = t.id === value;
        return (
          <button
            key={t.id}
            ref={(el) => { refs.current[t.id] = el; }}
            type="button"
            role="tab"
            id={tabId(t.id)}
            aria-selected={on}
            aria-controls={on ? panelId(t.id) : undefined}
            tabIndex={on ? 0 : -1}
            className="river-tabs__tab"
            onClick={() => onChange(t.id)}
          >
            <Glyph tab={t.id} />
            {t.label}
          </button>
        );
      })}
    </div>
  );
}
