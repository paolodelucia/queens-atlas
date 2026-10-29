import { render, screen } from '@testing-library/react';
import { Card } from './Card';

describe('Card', () => {
  it('renders a plain card with the default padding and its children', () => {
    render(<Card data-testid="c"><p>Hello</p></Card>);
    const card = screen.getByTestId('c');
    expect(card.tagName).toBe('DIV');
    expect(card).toHaveClass('ui-card', 'ui-card--plain');
    expect(card.className).not.toMatch(/ui-card--pad-/);
    expect(card).toHaveTextContent('Hello');
  });

  it('renders a labelled region when used as a section', () => {
    render(
      <Card as="section" aria-labelledby="h">
        <h2 id="h">Findings</h2>
      </Card>,
    );
    expect(screen.getByRole('region', { name: 'Findings' })).toHaveClass('ui-card');
  });

  it('applies variant, padding, flat and interactive modifiers and keeps extra classes', () => {
    render(<Card data-testid="c" variant="lilac" pad="lg" flat interactive className="mine">x</Card>);
    expect(screen.getByTestId('c')).toHaveClass(
      'ui-card--lilac', 'ui-card--pad-lg', 'ui-card--flat', 'ui-card--interactive', 'mine',
    );
  });

  it('passes other attributes through', () => {
    render(<Card as="aside" aria-label="Notes" id="notes">x</Card>);
    const aside = screen.getByRole('complementary', { name: 'Notes' });
    expect(aside).toHaveAttribute('id', 'notes');
    expect(aside).toHaveClass('ui-card--plain');
  });

  it('a whole-card link keeps its own accessible name', () => {
    render(
      <Card as="article" interactive>
        <h3><a className="ui-card__link" href="/river">The River</a></h3>
        <p>Where each program’s grads go.</p>
      </Card>,
    );
    expect(screen.getByRole('link', { name: 'The River' })).toHaveAttribute('href', '/river');
    expect(screen.getByRole('article')).toHaveClass('ui-card--interactive');
  });
});
