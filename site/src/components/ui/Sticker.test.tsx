import { render, screen } from '@testing-library/react';
import { Sticker, clampTilt } from './Sticker';

describe('Sticker', () => {
  it('renders its note as plain text, lime and tilted -6° by default', () => {
    render(<p>Chart <Sticker>hello, Big Four</Sticker></p>);
    const s = screen.getByText('hello, Big Four');
    expect(s.tagName).toBe('SPAN');
    expect(s).toHaveClass('ui-sticker', 'ui-sticker--lime');
    expect(s.style.getPropertyValue('--ui-tilt')).toBe('-6deg');
    // No role or hiding: it reads in place, like any text.
    expect(s).not.toHaveAttribute('role');
    expect(s).not.toHaveAttribute('aria-hidden');
  });

  it('takes a tone, an element and a tilt, clamped to ±10°', () => {
    render(<Sticker as="p" tone="lilac" tilt={25}>big tilt</Sticker>);
    const s = screen.getByText('big tilt');
    expect(s.tagName).toBe('P');
    expect(s).toHaveClass('ui-sticker--lilac');
    expect(s.style.getPropertyValue('--ui-tilt')).toBe('10deg');
  });

  it('keeps caller styles and classes alongside the tilt', () => {
    render(<Sticker className="spot" style={{ top: 12 }} tilt={4}>note</Sticker>);
    const s = screen.getByText('note');
    expect(s).toHaveClass('ui-sticker', 'spot');
    expect(s.style.top).toBe('12px');
    expect(s.style.getPropertyValue('--ui-tilt')).toBe('4deg');
  });

  it('clampTilt bounds the angle and ignores non-numbers', () => {
    expect(clampTilt(-30)).toBe(-10);
    expect(clampTilt(7)).toBe(7);
    expect(clampTilt(Number.NaN)).toBe(0);
  });
});
