import type { HTMLAttributes, ReactNode } from 'react';
import { cx } from './cx';
import './ui.css';

export type CardVariant = 'plain' | 'lime' | 'lilac' | 'ink';

export interface CardProps extends HTMLAttributes<HTMLElement> {
  /** Element to render. Default 'div'; use 'section' or 'article' with a heading inside. */
  as?: 'div' | 'section' | 'article' | 'aside' | 'li' | 'figure';
  /**
   * 'plain' (default): white card (a dark surface in dark mode). 'lime' / 'lilac': accent fill for
   * a callout, at most one or two per view; text inside is always dark. 'ink': inverted (ink in
   * light, cream in dark) with a lilac shadow. Never put a chart on a lime or lilac card.
   */
  variant?: CardVariant;
  /** Inner padding. Default 'md' (16px on phones, 24px from 640px). */
  pad?: 'none' | 'sm' | 'md' | 'lg';
  /** Drop the offset shadow (e.g. a card nested in a card). */
  flat?: boolean;
  /** Lifts on hover and rings on :focus-within: for a card that is one big link. */
  interactive?: boolean;
  children?: ReactNode;
}

/** The zine card: 2px outline, 18px radius, a solid 5px offset shadow. */
export function Card({ as: Tag = 'div', variant = 'plain', pad = 'md', flat, interactive, className, children, ...rest }: CardProps) {
  return (
    <Tag
      className={cx(
        'ui-card',
        `ui-card--${variant}`,
        pad !== 'md' && `ui-card--pad-${pad}`,
        flat && 'ui-card--flat',
        interactive && 'ui-card--interactive',
        className,
      )}
      {...rest}
    >
      {children}
    </Tag>
  );
}
