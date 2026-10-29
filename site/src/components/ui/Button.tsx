import type { AnchorHTMLAttributes, ComponentPropsWithRef, ReactNode } from 'react';
import { Link } from '../../lib/router';
import { cx } from './cx';
import './ui.css';

export type ButtonVariant = 'primary' | 'secondary';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonLook {
  /**
   * 'secondary' (default): white pill, ink outline, ink offset shadow. 'primary': ink fill, lime
   * text, lilac offset shadow; one per view, for the main action.
   */
  variant?: ButtonVariant;
  /** Height: 'sm' 36px, 'md' 44px (default), 'lg' 52px. Every size is at least 44px under 640px. */
  size?: ButtonSize;
  /** Full width of its container. */
  block?: boolean;
}

/** Class names for the zine button look, for the rare element that can't be a Button or LinkButton. */
export function buttonClass({ variant = 'secondary', size = 'md', block }: ButtonLook = {}, className?: string): string {
  return cx('btn', `btn--${variant}`, size !== 'md' && `btn--${size}`, block && 'btn--block', className);
}

export type ButtonProps = ButtonLook & ComponentPropsWithRef<'button'>;

/** A zine button. `type` defaults to "button". */
export function Button({ variant, size, block, className, type = 'button', ...rest }: ButtonProps) {
  return <button type={type} className={buttonClass({ variant, size, block }, className)} {...rest} />;
}

type AnchorRest = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href' | 'children'>;

export type LinkButtonProps = ButtonLook & AnchorRest & { children: ReactNode } & (
  /** In-app route ("/river?level=law"): SPA navigation through the router's Link. */
  | { to: string; href?: never }
  /** Anything else: an external URL, mailto:, a file. */
  | { href: string; to?: never }
);

/** A link that looks like a button (it navigates; use Button for actions). */
export function LinkButton({ variant, size, block, className, children, ...rest }: LinkButtonProps) {
  const cls = buttonClass({ variant, size, block }, className);
  if (typeof rest.to === 'string') {
    const { to, ...anchor } = rest;
    return <Link to={to} className={cls} {...anchor}>{children}</Link>;
  }
  const { href, ...anchor } = rest;
  return <a href={href} className={cls} {...anchor}>{children}</a>;
}
