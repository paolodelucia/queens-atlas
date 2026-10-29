import type { HTMLAttributes, ReactNode } from 'react';
import { cx } from './cx';
import './ui.css';

export interface HighlightProps extends HTMLAttributes<HTMLElement> {
  children: ReactNode;
  /** Underlay colour. Default 'lime'. */
  tone?: 'lime' | 'lilac';
  /**
   * Element. Default 'strong' (the number matters). 'mark' when it highlights a match or a
   * reference; 'span' for purely visual emphasis.
   */
  as?: 'strong' | 'mark' | 'span';
}

/**
 * A lime underlay behind a key number or phrase ("<Highlight>1 in 4</Highlight> leave Canada").
 * The text on it is always dark, in both themes. Once or twice per view.
 */
export function Highlight({ children, tone = 'lime', as: Tag = 'strong', className, ...rest }: HighlightProps) {
  return (
    <Tag className={cx('ui-hl', tone === 'lilac' && 'ui-hl--lilac', className)} {...rest}>
      {children}
    </Tag>
  );
}
