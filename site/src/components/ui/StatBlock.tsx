import type { ReactNode } from 'react';
import { cx } from './cx';
import { Highlight } from './Highlight';
import './ui.css';

export interface StatBlockProps {
  /** The number, already formatted ("92,447", "1 in 4"). */
  value: ReactNode;
  /** What it counts ("alumni"). Read right after the value. */
  label: ReactNode;
  /** A smaller line of context ("Classes of 1995–2024"). */
  detail?: ReactNode;
  /** Put the value on a lime underlay (the one number that matters most in a view). */
  highlight?: boolean;
  /** 'lg' (default): display size; 'md': for rows of three or four, or inside cards. */
  size?: 'md' | 'lg';
  /** Element. Default 'div'; 'li' inside a <ul> of stats. */
  as?: 'div' | 'li';
  className?: string;
}

/**
 * A big number with a label and an optional detail line. The value comes first in reading order
 * too ("92,447 alumni"), so a row of StatBlocks reads naturally.
 */
export function StatBlock({ value, label, detail, highlight, size = 'lg', as: Tag = 'div', className }: StatBlockProps) {
  return (
    <Tag className={cx('ui-stat', `ui-stat--${size}`, className)}>
      <span className="ui-stat__value num">{highlight ? <Highlight as="span">{value}</Highlight> : value}</span>
      {' '}
      <span className="ui-stat__label">{label}</span>
      {detail != null && detail !== '' && <span className="ui-stat__detail">{detail}</span>}
    </Tag>
  );
}
