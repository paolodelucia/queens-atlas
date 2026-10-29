import './controls.css';

export interface ToggleProps {
  /** Visible text and accessible name ("Show all fields"). */
  label: string;
  /** Shorter visible text under 520px ("All fields"); keep it a substring of `label` so voice control still matches. */
  short?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** Tooltip with more detail. */
  title?: string;
  /**
   * Id of the element the switch changes, as aria-controls. Pass it only while that element is
   * rendered (e.g. `controls={open ? 'tables' : undefined}`): aria-controls must point at
   * something that exists.
   */
  controls?: string;
  /** Extra class on the button. */
  className?: string;
}

/** An on/off switch (role="switch") for view options. 36px tall; 44px under 640px. */
export function Toggle({ label, short, checked, onChange, title, controls, className }: ToggleProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={short ? label : undefined}
      aria-controls={controls}
      title={title}
      className={`toggle${className ? ` ${className}` : ''}`}
      onClick={() => onChange(!checked)}
    >
      <span className="toggle__track" aria-hidden="true"><span className="toggle__thumb" /></span>
      {short ? (
        <span aria-hidden="true">
          <span className="toggle__long">{label}</span>
          <span className="toggle__short">{short}</span>
        </span>
      ) : <span>{label}</span>}
    </button>
  );
}
