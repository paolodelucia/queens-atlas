/**
 * Form pieces both modes share: the degree options, the typed graduation year, and radio chips
 * (first job in the alumni form, "pick a first job" in the student view).
 */
import { useId, useState } from 'react';
import type { ReactNode } from 'react';
import type { SegOption } from '../../components/controls';
import { familyColor } from '../../data/taxonomy';
import type { FamilyId } from '../../data/types';
import type { Level } from './model';

/**
 * Degree options. Abbreviated labels show their full form as a tooltip; where the full form doesn't
 * contain the visible text, Segmented keeps the visible text as the name and reads the full form
 * as the description (WCAG 2.5.3, label in name).
 */
export const LEVEL_OPTIONS: SegOption<Level | ''>[] = [
  { value: 'undergrad', label: 'Undergrad', ariaLabel: 'Undergraduate', tooltip: 'Undergraduate' },
  { value: 'graduate', label: 'Master’s/PhD', short: 'Grad', ariaLabel: 'Master’s/PhD (graduate)', tooltip: 'Master’s/PhD (graduate)' },
  { value: 'mba', label: 'MBA' },
  { value: 'law', label: 'JD', ariaLabel: 'JD (law)', tooltip: 'Law (JD)' },
  { value: 'medicine', label: 'MD', ariaLabel: 'MD (medicine)', tooltip: 'Medicine (MD)' },
];

/** Class on the Degree control, so the view can move focus to its first option. */
export const LEVEL_FIELD_CLASS = 'twin-level';

/** A four-digit year, typed. Keeps a draft and commits once it's a full year (or on blur / Enter). */
export function YearField({ id, label, value, onCommit, hint, placeholder = 'e.g. 2010' }: {
  id: string; label: ReactNode; value: string; onCommit: (v: string) => void; hint: ReactNode; placeholder?: string;
}) {
  const [draft, setDraft] = useState(value);
  const [prev, setPrev] = useState(value);
  if (value !== prev) {
    setPrev(value);
    setDraft(value);
  }
  const commit = (v: string) => { if (v !== value) onCommit(v); };
  return (
    <div className="field twin-form__year">
      <label className="field__label" htmlFor={id}>{label}</label>
      <input
        id={id}
        className="twin-year"
        type="text"
        inputMode="numeric"
        autoComplete="off"
        maxLength={4}
        placeholder={placeholder}
        aria-describedby={`${id}-hint`}
        value={draft}
        onChange={(e) => {
          const v = e.target.value.replace(/\D/g, '').slice(0, 4);
          setDraft(v);
          if (v.length === 4 || v === '') commit(v);
        }}
        onBlur={() => commit(draft)}
        onKeyDown={(e) => { if (e.key === 'Enter') commit(draft); }}
      />
      <p className="twin-hint" id={`${id}-hint`}>{hint}</p>
    </div>
  );
}

export interface ChipOption<T extends string> { id: T; label: string; dot?: FamilyId; muted?: boolean }

/** Radio chips laid out in rows (a long list reads better laid out than hidden in a menu). */
export function ChoiceChips<T extends string>({ legend, hideLegend, options, value, onChange, className }: {
  legend: string; hideLegend?: boolean; options: ChipOption<T>[]; value: T | null; onChange: (v: T) => void; className?: string;
}) {
  const name = useId();
  return (
    <fieldset className={`field twin-choice${className ? ` ${className}` : ''}`}>
      <legend className={hideLegend ? 'sr-only' : 'field__label'}>{legend}</legend>
      <div className="twin-chips">
        {options.map((o) => (
          <label key={o.id} className={`twin-chip${o.muted ? ' twin-chip--muted' : ''}`}>
            <input type="radio" name={name} value={o.id} checked={value === o.id} onChange={() => onChange(o.id)} />
            <span>
              {o.dot && <i className="twin-dot" style={{ background: familyColor(o.dot) }} aria-hidden="true" />}
              {o.label}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
