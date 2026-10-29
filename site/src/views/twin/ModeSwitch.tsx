/**
 * "I'm a student" / "I've graduated": the page's main switch. Native radios (arrow keys, focus and
 * form semantics from the browser), drawn as two large zine pills; the selected one is lilac like
 * every other selected control. It is bigger than the shared Segmented on purpose: it decides what
 * the whole page is about.
 */
import { useId } from 'react';
import type { Mode } from './model';

const OPTIONS: { value: Mode; label: string; hint: string }[] = [
  { value: 'student', label: 'I’m a student', hint: 'See where your program leads' },
  { value: 'alum', label: 'I’ve graduated', hint: 'Find people who started like you' },
];

export function ModeSwitch({ mode, onChange }: { mode: Mode; onChange: (m: Mode) => void }) {
  const name = useId();
  return (
    <fieldset className="twin-modes">
      <legend className="sr-only">Which are you?</legend>
      {OPTIONS.map((o) => (
        <label key={o.value} className="twin-modes__opt">
          <input
            type="radio"
            name={name}
            value={o.value}
            checked={mode === o.value}
            onChange={() => onChange(o.value)}
            aria-describedby={`${name}-${o.value}`}
          />
          <span className="twin-modes__face" aria-hidden="true">
            <span className="twin-modes__label">{o.label}</span>
            <span className="twin-modes__hint">{o.hint}</span>
          </span>
          <span className="sr-only">{o.label}</span>
          <span id={`${name}-${o.value}`} hidden>{o.hint}</span>
        </label>
      ))}
    </fieldset>
  );
}
