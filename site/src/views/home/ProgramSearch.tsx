import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { filterOptions } from '../../components/controls';
import type { PickerOption } from '../../components/controls';
import { fmtInt } from '../../lib/format';
import type { ProgramChoice } from './model';

export interface ProgramSearchProps {
  choices: ProgramChoice[];
  value: ProgramChoice | null;
  onChange: (choice: ProgramChoice) => void;
  /** Accessible name of the combobox (the visible question is the page's H1). */
  label: string;
  placeholder: string;
  /** Extra aria-describedby ids for the input. */
  describedBy?: string;
}

const fold = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();

/**
 * The landing page's big program search: the shared ProgramPicker's interaction model (an ARIA
 * 1.2 editable combobox with a listbox popup, matched by the shared `filterOptions`) at hero size.
 * Type to filter; ↓/↑ and Page Down/Up move; Enter picks; Escape closes and restores the current
 * choice; Tab leaves as usual. Typing a program's name exactly and leaving picks it.
 *
 * Each option shows the program, its level and its size, so "Computer Science" at two levels
 * never looks like one program.
 */
export function ProgramSearch({ choices, value, onChange, label, placeholder, describedBy }: ProgramSearchProps) {
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const inputId = `${uid}-input`;
  const listId = `${uid}-list`;
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const [open, setOpen] = useState(false);
  /** Text typed since the last pick; null = show the picked program. */
  const [query, setQuery] = useState<string | null>(null);
  const [active, setActive] = useState(0);

  const byKey = useMemo(() => new Map(choices.map((c) => [c.key, c])), [choices]);
  const options = useMemo<PickerOption[]>(() => choices.map((c) => ({ value: c.key, label: c.text })), [choices]);
  const filtering = query != null && query.trim() !== '';
  const results = useMemo(
    () => (filtering ? filterOptions(options, query) : options).map((o) => byKey.get(o.value)).filter((c): c is ProgramChoice => Boolean(c)),
    [filtering, options, query, byKey],
  );
  const activeIdx = Math.max(0, Math.min(active, results.length - 1));
  const optId = (i: number) => `${uid}-opt-${i}`;
  const count = results.length;

  useEffect(() => {
    if (!open) return;
    listRef.current?.querySelector<HTMLElement>('[data-active="true"]')?.scrollIntoView?.({ block: 'nearest' });
  }, [open, activeIdx]);

  const close = () => { setOpen(false); setQuery(null); };
  const pick = (c: ProgramChoice | undefined) => {
    if (c && c.key !== value?.key) onChange(c);
    close();
  };
  const openAtValue = () => {
    setActive(Math.max(0, choices.findIndex((c) => c.key === value?.key)));
    setOpen(true);
  };
  const move = (delta: number) => setActive(Math.max(0, Math.min(results.length - 1, activeIdx + delta)));

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        if (!open) openAtValue();
        else if (!e.altKey) move(1);
        break;
      case 'ArrowUp':
        e.preventDefault();
        if (!open) openAtValue();
        else move(-1);
        break;
      case 'PageDown':
        if (open) { e.preventDefault(); move(8); }
        break;
      case 'PageUp':
        if (open) { e.preventDefault(); move(-8); }
        break;
      case 'Enter':
        if (open && count) { e.preventDefault(); pick(results[activeIdx]); }
        break;
      case 'Escape':
        if (open || query !== null) { e.preventDefault(); e.stopPropagation(); close(); }
        break;
    }
  };

  const onBlur = () => {
    // Leaving closes the list without choosing, except that typing a name exactly counts.
    const typed = query == null ? '' : fold(query);
    const exact = typed ? choices.find((c) => fold(c.text) === typed) ?? choices.find((c) => fold(c.program) === typed) : undefined;
    if (exact) pick(exact);
    else close();
  };

  return (
    <div className="psearch">
      <label className="sr-only" htmlFor={inputId}>{label}</label>
      <div className={open ? 'psearch__box is-open' : 'psearch__box'}>
        <svg className="psearch__icon" viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" focusable="false">
          <circle cx="10.5" cy="10.5" r="6.5" fill="none" stroke="currentColor" strokeWidth="2.6" />
          <path d="m15.5 15.5 5 5" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" />
        </svg>
        <input
          ref={inputRef}
          id={inputId}
          className="psearch__input"
          type="text"
          role="combobox"
          autoComplete="off"
          spellCheck={false}
          enterKeyHint="search"
          aria-autocomplete="list"
          aria-expanded={open}
          aria-controls={listId}
          aria-activedescendant={open && count ? optId(activeIdx) : undefined}
          aria-describedby={describedBy}
          value={query ?? value?.text ?? ''}
          placeholder={placeholder}
          onChange={(e) => { setQuery(e.target.value); setActive(0); setOpen(true); }}
          onClick={() => { if (!open) openAtValue(); }}
          onFocus={(e) => e.currentTarget.select()}
          onBlur={onBlur}
          onKeyDown={onKeyDown}
        />
        <button
          type="button"
          className="psearch__toggle"
          tabIndex={-1}
          aria-label={open ? 'Close the program list' : 'Show all programs'}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            if (open) close();
            else { setQuery(null); openAtValue(); }
            inputRef.current?.focus();
          }}
        >
          <svg viewBox="0 0 12 12" width="14" height="14" aria-hidden="true" focusable="false">
            <path d="M2.5 4.5 6 8l3.5-3.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <ul
          ref={listRef}
          id={listId}
          role="listbox"
          aria-label="Programs"
          className="psearch__list"
          hidden={!open}
          onMouseDown={(e) => e.preventDefault()}
        >
          {results.map((c, i) => (
            <li
              key={c.key}
              id={optId(i)}
              role="option"
              aria-selected={i === activeIdx}
              data-active={i === activeIdx}
              data-current={c.key === value?.key || undefined}
              className="psearch__opt"
              onClick={() => pick(c)}
              onMouseMove={() => { if (i !== activeIdx) setActive(i); }}
            >
              <span className="psearch__text">
                <span className="psearch__name">{c.program}</span>
                <span className="psearch__level">{c.levelLabel}</span>
              </span>
              <span className="psearch__n num">{fmtInt(c.n)}<span className="sr-only"> grads</span></span>
            </li>
          ))}
          {!count && <li className="psearch__empty" role="presentation">No program matches “{query?.trim()}”</li>}
        </ul>
        <span className="sr-only" aria-live="polite">
          {open && filtering ? `${count} ${count === 1 ? 'program matches' : 'programs match'}` : ''}
        </span>
      </div>
    </div>
  );
}
