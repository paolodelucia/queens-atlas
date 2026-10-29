/**
 * Shared "Campus zine" primitives. Loud, warm, made by a student for students: cream ground, ink
 * type in Bricolage Grotesque, white cards with 2px ink outlines and solid offset shadows, and two
 * UI accents, lime and lilac. Styles live in ui.css and use tokens.css variables only.
 *
 * Rules of thumb
 *   - Lime and lilac are UI only (selected states, stickers, highlights, the primary button's
 *     shadow). Never a data colour: charts keep --sector-*, --seq-*, --data-mono. Data marks may
 *     take a thin outline: `stroke: var(--mark-stroke); stroke-width: 1` (bars, bubbles, swatches;
 *     not dense Sankey links).
 *   - At most one or two Stickers and one or two Highlights per view; one primary button per view.
 *   - Text on lime or lilac is always dark (--on-accent), in both themes. The primitives do this.
 *
 *   <SectionHeading level={1} eyebrow="The River" title="Where each program’s grads go" id="river-title">
 *     <p>Follow a class from first job to today.</p>
 *   </SectionHeading>
 *     Eyebrow pill + display heading + optional dek. `level` 1–3; `size` 'hero' | 'page' |
 *     'section' (default from level); `eyebrowTone` 'outline' | 'lime' | 'lilac'; `id` goes on
 *     the heading for aria-labelledby. The bare `.eyebrow` class (base.css) is the same pill.
 *
 *   <Card as="section" aria-labelledby="facts-h" variant="plain" pad="md">…</Card>
 *     2px outline, 18px radius, 5px offset shadow. `variant` 'plain' | 'lime' | 'lilac' | 'ink'
 *     (lime/lilac for one callout, never behind a chart; 'ink' is inverted with a lilac shadow);
 *     `pad` 'none' | 'sm' | 'md' | 'lg'; `flat` drops the shadow (nested cards); `interactive`
 *     lifts on hover and rings when a link inside has keyboard focus. For a whole-card link, give
 *     the link `className="ui-card__link"` (it stretches over the card). `as` picks the element.
 *
 *   <Sticker tone="lime" tilt={-6}>hello, Big Four</Sticker>
 *     A tilted note on a chart. `tone` 'lime' | 'lilac'; `tilt` degrees (clamped to ±10, use ±4–10
 *     and alternate signs); `as` 'span' | 'p' | 'div'. Position it from the view (className or
 *     style, e.g. absolute over the chart's top-right corner). It is plain text to screen readers.
 *
 *   <p><Highlight>1 in 4</Highlight> leave Canada within ten years.</p>
 *     Lime (or `tone="lilac"`) underlay behind a key number. Renders <strong> by default; `as`
 *     'mark' | 'span' when importance isn't the point.
 *
 *   <StatBlock value={fmtInt(92447)} label="alumni" detail="Classes of 1995–2024" highlight />
 *     Big number + label + detail; reads "92,447 alumni". `size` 'lg' | 'md'; `as` 'div' | 'li'
 *     (wrap a row in <ul className="…" role="list">); `highlight` puts the value on lime.
 *
 *   <Button variant="primary" onClick={go}>Find my twin</Button>
 *   <LinkButton to="/river" variant="secondary" size="lg">Open the River</LinkButton>
 *   <LinkButton href="mailto:…">Email us</LinkButton>
 *     Pill buttons. `variant` 'secondary' (default: white, ink outline, ink offset shadow) |
 *     'primary' (ink fill, lime text, lilac shadow); `size` 'sm' 36px | 'md' 44px | 'lg' 52px,
 *     all at least 44px tall under 640px; `block` for full width. Button defaults to
 *     type="button". LinkButton takes `to` (in-app, SPA navigation) or `href` (anything else).
 *     `buttonClass({ variant, size })` gives the class names for an element that can't be either.
 */
export { Button, LinkButton, buttonClass } from './Button';
export type { ButtonLook, ButtonProps, ButtonSize, ButtonVariant, LinkButtonProps } from './Button';
export { Card } from './Card';
export type { CardProps, CardVariant } from './Card';
export { Highlight } from './Highlight';
export type { HighlightProps } from './Highlight';
export { SectionHeading } from './SectionHeading';
export type { SectionHeadingProps } from './SectionHeading';
export { StatBlock } from './StatBlock';
export type { StatBlockProps } from './StatBlock';
export { Sticker, clampTilt } from './Sticker';
export type { StickerProps } from './Sticker';
export { cx } from './cx';
