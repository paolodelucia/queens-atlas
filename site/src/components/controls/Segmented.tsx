import { useId } from 'react';
import { nameAndDescription } from './labelInName';
import { useMediaQuery } from './useMediaQuery';
import './controls.css';

/** Where `short` labels replace `label` (the same breakpoint as `.seg__short` in controls.css). */
const SHORT_QUERY = '(max-width: 519.98px)';

/** One choice in a {@link Segmented} control. */
export interface SegOption<T extends string> {
  value: T;
  /** Visible label. */
  label: string;
  /** Shorter label swapped in under 520px (e.g. "’05–’15" for "2005–2015"). */
  short?: string;
  /**
   * Fuller accessible name ("Class of 2005–2015" for "2005–2015", "JD (law)" for "JD"). It is used
   * as the name only while it contains the visible text, word for word (WCAG 2.5.3, label in
   * name; see `labelInName`). Otherwise, e.g. under 520px where "’05–’15" shows, the visible text
   * is the name and this is read as the option's description instead.
   */
  ariaLabel?: string;
  /** Tooltip (the title attribute), e.g. the long form of an abbreviated label. */
  tooltip?: string;
  /** Greyed out, skipped by the arrow keys and not clickable. */
  disabled?: boolean;
  /** Why it is disabled ("Fewer than 50 people"): shown as a tooltip and read as the option's description. */
  reason?: string;
}

export interface SegmentedProps<T extends string> {
  /** Group label ("Level"). Rendered as the fieldset legend. */
  legend: string;
  /** Keep the legend for screen readers only (e.g. a Chart/Table switch whose options say it all). */
  hideLegend?: boolean;
  options: SegOption<T>[];
  value: T;
  onChange: (value: T) => void;
  /**
   * 'auto' (default): natural width; scrolls sideways (no scrollbar) when it doesn't fit.
   * 'fill': on phones (under 640px) the control takes the whole row and its options share the
   * width, wrapping onto a second row rather than scrolling; under 520px they tighten (6px padding,
   * 13px text) so six short options fit a 360px screen.
   */
  fit?: 'auto' | 'fill';
  /** Extra class on the outer fieldset (layout hooks such as flex sizing). */
  className?: string;
}

/**
 * A segmented control built on native radios, so arrow keys, focus, disabled options and form
 * semantics come from the browser. Outlined pills; the selected one is lilac and bold. 36px tall;
 * 44px under 640px. Each option's accessible name
 * always contains the text it shows (long forms that don't go to its description).
 */
export function Segmented<T extends string>({
  legend, hideLegend, options, value, onChange, fit = 'auto', className,
}: SegmentedProps<T>) {
  const name = useId();
  const narrow = useMediaQuery(SHORT_QUERY);
  return (
    <fieldset className={`field${fit === 'fill' ? ' field--fill' : ''}${className ? ` ${className}` : ''}`}>
      <legend className={hideLegend ? 'sr-only' : 'field__label'}>{legend}</legend>
      <div className="seg">
        {options.map((o, i) => {
          const visible = narrow && o.short ? o.short : o.label;
          // The long label is the fuller form of a short one when no ariaLabel is given.
          const acc = nameAndDescription(visible, o.ariaLabel ?? (visible === o.label ? undefined : o.label));
          const descId = acc.description ? `${name}-desc-${i}` : undefined;
          const whyId = o.disabled && o.reason ? `${name}-why-${i}` : undefined;
          const describedBy = [descId, whyId].filter(Boolean).join(' ') || undefined;
          const tip = whyId ? `${o.tooltip ?? o.ariaLabel ?? o.label}: ${o.reason}` : o.tooltip;
          return (
            <label key={o.value} className="seg__opt" title={tip}>
              <input
                type="radio"
                name={name}
                value={o.value}
                checked={value === o.value}
                disabled={o.disabled}
                onChange={() => onChange(o.value)}
                aria-label={acc.name}
                aria-describedby={describedBy}
              />
              {/* data-label: CSS lays out an invisible bold copy so selecting doesn't change the width. */}
              <span className="seg__face" aria-hidden="true">
                {o.short ? (
                  <>
                    <span className="seg__long" data-label={o.label}>{o.label}</span>
                    <span className="seg__short" data-label={o.short}>{o.short}</span>
                  </>
                ) : <span className="seg__txt" data-label={o.label}>{o.label}</span>}
              </span>
              {/* Referenced by aria-describedby only: hidden, so browse mode doesn't read it twice. */}
              {descId && <span id={descId} hidden>{acc.description}</span>}
              {whyId && <span id={whyId} hidden>{o.reason}</span>}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
