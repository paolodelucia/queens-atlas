import { render, screen } from '@testing-library/react';
import { SectionHeading } from './SectionHeading';

describe('SectionHeading', () => {
  it('renders an eyebrow pill before an h2 by default', () => {
    render(<SectionHeading eyebrow="Things we learned" title="Findings from 92,000 careers" id="facts" />);
    const h = screen.getByRole('heading', { level: 2, name: 'Findings from 92,000 careers' });
    expect(h).toHaveAttribute('id', 'facts');
    const eyebrow = screen.getByText('Things we learned');
    expect(eyebrow).toHaveClass('eyebrow', 'ui-heading__eyebrow');
    // The eyebrow comes first in reading order.
    expect(eyebrow.compareDocumentPosition(h) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(h.closest('.ui-heading')).toHaveClass('ui-heading--section');
  });

  it('labels a section through its heading id', () => {
    render(
      <section aria-labelledby="t">
        <SectionHeading title="The River" id="t" />
      </section>,
    );
    expect(screen.getByRole('region', { name: 'The River' })).toBeInTheDocument();
  });

  it('level 1 defaults to the page size; size and eyebrow tone can be set', () => {
    const { rerender } = render(<SectionHeading level={1} title="Atlas" eyebrow="Method" eyebrowTone="lime" />);
    expect(screen.getByRole('heading', { level: 1 }).closest('.ui-heading')).toHaveClass('ui-heading--page');
    expect(screen.getByText('Method')).toHaveClass('ui-heading__eyebrow--lime');
    rerender(<SectionHeading level={1} size="hero" title="Atlas" />);
    expect(screen.getByRole('heading', { level: 1 }).closest('.ui-heading')).toHaveClass('ui-heading--hero');
  });

  it('omits the eyebrow when not given and renders a dek', () => {
    const { container } = render(
      <SectionHeading level={3} title="Small">
        <p>The dek.</p>
      </SectionHeading>,
    );
    expect(container.querySelector('.eyebrow')).toBeNull();
    expect(screen.getByRole('heading', { level: 3, name: 'Small' })).toBeInTheDocument();
    expect(screen.getByText('The dek.').parentElement).toHaveClass('ui-heading__dek');
  });
});
