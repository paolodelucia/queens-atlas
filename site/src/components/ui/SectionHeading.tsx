import type { ReactNode } from 'react';
import { cx } from './cx';
import './ui.css';

export interface SectionHeadingProps {
  /** Heading text. */
  title: ReactNode;
  /** Short label in a pill above the heading ("The River", "Things we learned"). */
  eyebrow?: ReactNode;
  /** Pill fill: 'outline' (default), 'lime' or 'lilac'. */
  eyebrowTone?: 'outline' | 'lime' | 'lilac';
  /** Heading level. Default 2. */
  level?: 1 | 2 | 3;
  /**
   * Type size, independent of level: 'hero' (home H1), 'page' (tool-page H1), 'section' (H2).
   * Default: 'page' for level 1, 'section' otherwise.
   */
  size?: 'hero' | 'page' | 'section';
  /** Id on the heading, for aria-labelledby on the surrounding <section>. */
  id?: string;
  /** Dek / lede under the heading. */
  children?: ReactNode;
  className?: string;
}

/** An eyebrow pill and a display heading (Bricolage 800, tight tracking), with an optional dek. */
export function SectionHeading({
  title, eyebrow, eyebrowTone = 'outline', level = 2, size, id, children, className,
}: SectionHeadingProps) {
  const H = `h${level}` as 'h1' | 'h2' | 'h3';
  const s = size ?? (level === 1 ? 'page' : 'section');
  return (
    <div className={cx('ui-heading', `ui-heading--${s}`, className)}>
      {eyebrow != null && eyebrow !== '' && (
        <p className={cx('eyebrow', 'ui-heading__eyebrow', eyebrowTone !== 'outline' && `ui-heading__eyebrow--${eyebrowTone}`)}>
          {eyebrow}
        </p>
      )}
      <H id={id} className="ui-heading__title">{title}</H>
      {children != null && <div className="ui-heading__dek">{children}</div>}
    </div>
  );
}
