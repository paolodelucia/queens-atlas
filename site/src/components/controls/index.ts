/**
 * Shared form controls for the tool pages (River, Twin, Diaspora). Each control is 36px tall, 44px
 * under 640px, and styled in controls.css with generic classes (.field, .seg, .combo, .toggle,
 * .copylink); views add layout only, through `className`, and use these options rather than
 * overriding the controls' own CSS.
 *
 *   <Segmented legend="Level" fit="fill" value={level} onChange={setLevel} options={[
 *     { value: 'law', label: 'JD', ariaLabel: 'JD (law)', tooltip: 'Law (JD)' },
 *     { value: '2005-2015', label: '2005–2015', short: '’05–’15', ariaLabel: 'Class of 2005–2015' },
 *   ]} />
 *     Native radios. Options: { value, label, short?, ariaLabel?, tooltip?, disabled?, reason? }.
 *     `short` swaps in under 520px. Label in name (WCAG 2.5.3) is guaranteed: `ariaLabel` is the
 *     accessible name only while it contains the visible text word for word (case, punctuation and
 *     parentheses ignored, as axe does); otherwise the visible text ("’05–’15", "Undergrad") is the
 *     name and `ariaLabel` is read as the description. `tooltip` is the title attribute. A disabled
 *     option shows `reason` in its tooltip and accessible description. `hideLegend` keeps the
 *     legend for screen readers only (e.g. a Chart/Table switch). `fit="fill"`: options wrap onto
 *     a second row instead of scrolling sideways when the row is too narrow; on phones (<640px)
 *     the control also takes the whole row, options share the width, and tighten under 520px.
 *
 *   <ProgramPicker label="Program" hideLabelBelow={640} value={program} onChange={setProgram}
 *                  options={[{ value: 'Commerce', label: 'Commerce', n: 3533 }]} />
 *     Editable combobox + listbox. Options: { value, label, n?, hint? }. `value` may be null (shows
 *     `placeholder`). `hideLabel` keeps the label for screen readers only; `hideLabelBelow` does so
 *     on viewports narrower than that many px (the combobox keeps its name). Also: id, listLabel,
 *     noun (live count), disabled, disabledReason, describedBy, filter (defaults to the exported
 *     filterOptions), className.
 *
 *   <Toggle label="Show all fields" short="All fields" checked={on} onChange={setOn}
 *           controls={tableShown ? 'tables' : undefined} />
 *     role="switch" button for view options. `controls` sets aria-controls; pass it only while
 *     the controlled element is rendered.
 *
 *   <CopyLink url={() => canonicalUrl()} ariaLabel="Copy link to this view" compact align="start" />
 *     Clipboard API, "Link copied" in a polite live region, and a select-and-copy panel where the
 *     clipboard is unavailable. `compact` shows the icon only under 640px. `align` picks the
 *     button edge the panel lines up with: 'end' (default) for buttons on the right, 'start' for
 *     buttons near the left edge.
 */
export { CopyLink, writeToClipboard } from './CopyLink';
export type { CopyLinkProps } from './CopyLink';
export { ProgramPicker, filterOptions } from './ProgramPicker';
export type { PickerOption, ProgramPickerProps } from './ProgramPicker';
export { Segmented } from './Segmented';
export type { SegOption, SegmentedProps } from './Segmented';
export { Toggle } from './Toggle';
export type { ToggleProps } from './Toggle';
export { labelInName } from './labelInName';
export { below, useMediaQuery } from './useMediaQuery';
