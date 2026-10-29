import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { fmtInt } from '../../lib/format';
import { below, useMediaQuery } from './useMediaQuery';
import './controls.css';

/** One entry in a {@link ProgramPicker}. */
export interface PickerOption {
  /** Stable value passed to `onChange` (a canonical program name, or e.g. "all"). */
  value: string;
  /** What the list and the input show. */
  label: string;
  /** People behind the option, shown right-aligned (omit or null to hide). */
  n?: number | null;
  /** Secondary line under the label (e.g. a level, "No River: under 50 people"). */
  hint?: string;
}

export interface ProgramPickerProps {
  /** Visible field label ("Program"); also the combobox's accessible name. */
  label: string;
  /** Keep the label for screen readers only (when the surrounding form already shows one). */
  hideLabel?: boolean;
  /**
   * Keep the label for screen readers only on viewports narrower than this many px (e.g. 640 on
   * phones, where the value, "All programs" or "Commerce", already names the field).
   */
  hideLabelBelow?: number;
  options: PickerOption[];
  /** Selected option's value; null shows the placeholder. */
  value: string | null;
  onChange: (value: string) => void;
  /** Input id (defaults to a generated one), for an external <label htmlFor>. */
  id?: string;
  /** Default "Search programs". */
  placeholder?: string;
  /** Accessible name of the popup list. Default "Programs". */
  listLabel?: string;
  /** Singular/plural noun for the live "12 programs match" announcement. Default ['program', 'programs']. */
  noun?: [string, string];
  disabled?: boolean;
  /** Tooltip on the disabled input ("Choose a level to pick a program"). */
  disabledReason?: string;
  /** Extra aria-describedby ids for the input. */
  describedBy?: string;
  /** Custom matcher; defaults to {@link filterOptions} (accent-insensitive, best matches first). */
  filter?: (options: PickerOption[], query: string) => PickerOption[];
  /** Extra class on the outer wrapper (layout hooks such as flex sizing). */
  className?: string;
}

const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/**
 * Default matcher: every typed word must appear in the label (accents and case ignored). Labels
 * that start with the query rank first, then labels where every word starts a word, then the
 * rest; ties keep the given order (so "largest first" lists stay that way).
 */
export function filterOptions(options: PickerOption[], query: string): PickerOption[] {
  const q = fold(query).trim().replace(/\s+/g, ' ');
  if (!q) return options;
  const tokens = q.split(' ');
  const scored: { o: PickerOption; score: number; i: number }[] = [];
  options.forEach((o, i) => {
    const name = fold(o.label);
    if (!tokens.every((t) => name.includes(t))) return;
    const words = name.split(/[\s\-–&/,()’']+/);
    const score = name.startsWith(q) ? 0 : tokens.every((t) => words.some((w) => w.startsWith(t))) ? 1 : 2;
    scored.push({ o, score, i });
  });
  return scored.sort((a, b) => a.score - b.score || a.i - b.i).map((s) => s.o);
}

/**
 * Searchable single-choice picker: an ARIA 1.2 editable combobox with a listbox popup.
 * Type to filter; ↓/↑ (or Page Down/Up) move; Enter picks; Escape closes and restores the current
 * choice; Tab closes and moves on as usual. Typing a label exactly and leaving picks it.
 * 36px tall; 44px under 640px.
 */
export function ProgramPicker({
  label, hideLabel, hideLabelBelow, options, value, onChange, id, placeholder = 'Search programs', listLabel = 'Programs',
  noun = ['program', 'programs'], disabled, disabledReason, describedBy, filter = filterOptions, className,
}: ProgramPickerProps) {
  const uid = useId();
  const inputId = id ?? `${uid}-input`;
  const listId = `${uid}-list`;
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const [open, setOpen] = useState(false);
  /** Text typed since the last pick; null = show the selected label. */
  const [query, setQuery] = useState<string | null>(null);
  const [active, setActive] = useState(0);
  const narrow = useMediaQuery(hideLabelBelow ? below(hideLabelBelow) : null);
  const labelHidden = hideLabel || narrow;

  const selected = value == null ? undefined : options.find((o) => o.value === value);
  const filtering = query != null && query.trim() !== '';
  const results = useMemo(() => (filtering ? filter(options, query) : options), [filtering, filter, options, query]);
  const activeIdx = Math.max(0, Math.min(active, results.length - 1));
  const optId = (i: number) => `${uid}-opt-${i}`;
  const expanded = open && !disabled;

  useEffect(() => {
    if (!expanded) return;
    listRef.current?.querySelector<HTMLElement>('[data-active="true"]')?.scrollIntoView?.({ block: 'nearest' });
  }, [expanded, activeIdx]);

  const close = () => { setOpen(false); setQuery(null); };
  const pick = (o: PickerOption | undefined) => {
    if (o && o.value !== value) onChange(o.value);
    close();
  };
  const openAtSelected = () => {
    setActive(Math.max(0, options.findIndex((o) => o.value === value)));
    setOpen(true);
  };
  const move = (delta: number) => setActive(Math.max(0, Math.min(results.length - 1, activeIdx + delta)));

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        if (!open) openAtSelected();
        else if (!e.altKey) move(1);
        break;
      case 'ArrowUp':
        e.preventDefault();
        if (!open) openAtSelected();
        else move(-1);
        break;
      case 'PageDown':
        if (open) { e.preventDefault(); move(8); }
        break;
      case 'PageUp':
        if (open) { e.preventDefault(); move(-8); }
        break;
      case 'Enter':
        if (open) { e.preventDefault(); pick(results[activeIdx]); }
        break;
      case 'Escape':
        if (open || query !== null) { e.preventDefault(); e.stopPropagation(); close(); }
        break;
      // Tab is left to the browser: focus moves on to the next control and onBlur closes the list.
    }
  };

  const onBlur = () => {
    // Leaving closes the list without choosing, except that typing a label exactly (any case)
    // counts as choosing it.
    const typed = query == null ? '' : fold(query).trim();
    const exact = typed ? options.find((o) => fold(o.label) === typed) : undefined;
    if (exact) pick(exact);
    else close();
  };

  const count = results.length;
  return (
    <div className={`field field--picker${className ? ` ${className}` : ''}`}>
      <label className={labelHidden ? 'sr-only' : 'field__label'} htmlFor={inputId}>{label}</label>
      <div className={`combo${expanded ? ' is-open' : ''}`}>
        <input
          ref={inputRef}
          id={inputId}
          className="combo__input"
          type="text"
          role="combobox"
          autoComplete="off"
          spellCheck={false}
          aria-autocomplete="list"
          aria-expanded={expanded}
          aria-controls={listId}
          aria-activedescendant={expanded && count ? optId(activeIdx) : undefined}
          aria-describedby={describedBy}
          disabled={disabled}
          title={disabled ? disabledReason : undefined}
          value={query ?? selected?.label ?? ''}
          placeholder={placeholder}
          onChange={(e) => { setQuery(e.target.value); setActive(0); setOpen(true); }}
          onClick={() => { if (!open) openAtSelected(); }}
          onFocus={(e) => e.currentTarget.select()}
          onBlur={onBlur}
          onKeyDown={onKeyDown}
        />
        <button
          type="button"
          className="combo__toggle"
          tabIndex={-1}
          aria-label={expanded ? `Close ${listLabel.toLowerCase()}` : `Show all ${listLabel.toLowerCase()}`}
          disabled={disabled}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            if (open) close();
            else { setQuery(null); openAtSelected(); }
            inputRef.current?.focus();
          }}
        >
          <svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true"><path d="M2.5 4.5 6 8l3.5-3.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </button>
        <ul
          ref={listRef}
          id={listId}
          role="listbox"
          aria-label={listLabel}
          className="combo__list"
          hidden={!expanded}
          // Keep focus in the input while clicking an option.
          onMouseDown={(e) => e.preventDefault()}
        >
          {results.map((o, i) => (
            <li
              key={o.value}
              id={optId(i)}
              role="option"
              aria-selected={i === activeIdx}
              data-active={i === activeIdx}
              data-current={o.value === value || undefined}
              className="combo__opt"
              onClick={() => pick(o)}
              onMouseMove={() => { if (i !== activeIdx) setActive(i); }}
            >
              <span className="combo__text">
                <span className="combo__name">{o.label}</span>
                {o.hint && <span className="combo__hint">{o.hint}</span>}
              </span>
              {o.n != null && <span className="combo__n num">{fmtInt(o.n)}</span>}
            </li>
          ))}
          {!count && <li className="combo__empty" role="presentation">No {noun[1]} match “{query?.trim()}”</li>}
        </ul>
        <span className="sr-only" aria-live="polite">
          {expanded && filtering ? `${count} ${count === 1 ? noun[0] : noun[1]} match` : ''}
        </span>
      </div>
    </div>
  );
}
