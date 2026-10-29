import { render, screen } from '@testing-library/react';
import { Highlight } from './Highlight';

describe('Highlight', () => {
  it('wraps the key number in <strong> with the lime underlay by default', () => {
    render(<p><Highlight>1 in 4</Highlight> leave Canada.</p>);
    const hl = screen.getByText('1 in 4');
    expect(hl.tagName).toBe('STRONG');
    expect(hl).toHaveClass('ui-hl');
    expect(hl).not.toHaveClass('ui-hl--lilac');
    expect(hl.closest('p')).toHaveTextContent('1 in 4 leave Canada.');
  });

  it('can be a <mark> or a <span>, and lilac', () => {
    const { rerender } = render(<Highlight as="mark" tone="lilac">Law</Highlight>);
    expect(screen.getByText('Law').tagName).toBe('MARK');
    expect(screen.getByText('Law')).toHaveClass('ui-hl', 'ui-hl--lilac');
    rerender(<Highlight as="span" className="x">Law</Highlight>);
    expect(screen.getByText('Law').tagName).toBe('SPAN');
    expect(screen.getByText('Law')).toHaveClass('ui-hl', 'x');
  });
});
