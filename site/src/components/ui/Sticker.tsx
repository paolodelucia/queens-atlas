import type { CSSProperties, HTMLAttributes, ReactNode } from 'react';
import { cx } from './cx';
import './ui.css';

export interface StickerProps extends HTMLAttributes<HTMLElement> {
  children: ReactNode;
  /** Fill. Default 'lime'. */
  tone?: 'lime' | 'lilac';
  /** Rotation in degrees, clamped to ±10. Default -6. Alternate signs when two share a view. */
  tilt?: number;
  /** Element to render. Default 'span' (inline); 'p' for a standalone note. */
  as?: 'span' | 'p' | 'div';
}

const MAX_TILT = 10;

/** Clamp a tilt to ±10° (non-numbers become 0). */
export function clampTilt(tilt: number): number {
  return Number.isFinite(tilt) ? Math.max(-MAX_TILT, Math.min(MAX_TILT, tilt)) : 0;
}

/**
 * A small tilted label (lime or lilac, 2px outline, weight 800) for a one-line note on a chart:
 * "hello, Big Four". At most one or two per view. It is ordinary text for assistive tech, so write
 * it to make sense read in place. Position it from the view with `className` / `style`.
 */
export function Sticker({ children, tone = 'lime', tilt = -6, as: Tag = 'span', className, style, ...rest }: StickerProps) {
  return (
    <Tag
      className={cx('ui-sticker', `ui-sticker--${tone}`, className)}
      style={{ ...style, '--ui-tilt': `${clampTilt(tilt)}deg` } as CSSProperties}
      {...rest}
    >
      {children}
    </Tag>
  );
}
