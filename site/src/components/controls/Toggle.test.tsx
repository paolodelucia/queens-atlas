import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { Toggle } from './Toggle';

function Harness({ onChange = () => {}, short }: { onChange?: (v: boolean) => void; short?: string }) {
  const [on, setOn] = useState(false);
  return <Toggle label="Show all fields" short={short} checked={on} onChange={(v) => { setOn(v); onChange(v); }} />;
}

describe('Toggle', () => {
  it('is a switch that flips on click, Enter and Space', async () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    const sw = screen.getByRole('switch', { name: 'Show all fields' });
    expect(sw).toHaveAttribute('aria-checked', 'false');
    await userEvent.click(sw);
    expect(sw).toHaveAttribute('aria-checked', 'true');
    await userEvent.keyboard('{Enter}');
    expect(sw).toHaveAttribute('aria-checked', 'false');
    await userEvent.keyboard(' ');
    expect(onChange.mock.calls.map(([v]) => v)).toEqual([true, false, true]);
  });

  it('points aria-controls at the element it changes only when given one', () => {
    const { rerender } = render(<><Toggle label="Table" checked={false} onChange={() => {}} /></>);
    expect(screen.getByRole('switch', { name: 'Table' })).not.toHaveAttribute('aria-controls');
    rerender(<><Toggle label="Table" checked onChange={() => {}} controls="tables" /><div id="tables" /></>);
    const sw = screen.getByRole('switch', { name: 'Table' });
    expect(sw).toHaveAttribute('aria-controls', 'tables');
    expect(document.getElementById(sw.getAttribute('aria-controls')!)).not.toBeNull();
  });

  it('keeps the full label as its name when a short one is shown on narrow screens', () => {
    const { container } = render(<Harness short="All fields" />);
    expect(screen.getByRole('switch', { name: 'Show all fields' })).toBeInTheDocument();
    expect(container.querySelector('.toggle__short')).toHaveTextContent('All fields');
  });
});
