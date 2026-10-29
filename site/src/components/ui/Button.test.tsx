import { createRef } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RouterProvider, useRouter } from '../../lib/router';
import { Button, LinkButton, buttonClass } from './Button';

function Where() {
  const { loc } = useRouter();
  return <p data-testid="where">{loc.path}</p>;
}

describe('Button', () => {
  it('is a type="button" secondary pill by default and handles clicks', async () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Try again</Button>);
    const b = screen.getByRole('button', { name: 'Try again' });
    expect(b).toHaveAttribute('type', 'button');
    expect(b).toHaveClass('btn', 'btn--secondary');
    await userEvent.click(b);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('takes variant, size, block, type and a ref', () => {
    const ref = createRef<HTMLButtonElement>();
    render(<Button ref={ref} variant="primary" size="lg" block type="submit" className="x">Go</Button>);
    const b = screen.getByRole('button', { name: 'Go' });
    expect(b).toHaveClass('btn--primary', 'btn--lg', 'btn--block', 'x');
    expect(b).toHaveAttribute('type', 'submit');
    expect(ref.current).toBe(b);
  });

  it('a disabled button is exposed as disabled and ignores clicks', async () => {
    const onClick = vi.fn();
    render(<Button disabled onClick={onClick}>Nope</Button>);
    const b = screen.getByRole('button', { name: 'Nope' });
    expect(b).toBeDisabled();
    await userEvent.click(b);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('buttonClass builds the same class list', () => {
    expect(buttonClass()).toBe('btn btn--secondary');
    expect(buttonClass({ variant: 'primary', size: 'sm' }, 'extra')).toBe('btn btn--primary btn--sm extra');
  });
});

describe('LinkButton', () => {
  beforeEach(() => window.history.replaceState(null, '', '/'));

  it('with `to`, is a link that navigates in-app', () => {
    render(
      <RouterProvider>
        <LinkButton to="/river" variant="primary">Open the River</LinkButton>
        <Where />
      </RouterProvider>,
    );
    const a = screen.getByRole('link', { name: 'Open the River' });
    expect(a).toHaveAttribute('href', '/river');
    expect(a).toHaveClass('btn', 'btn--primary');
    fireEvent.click(a);
    expect(screen.getByTestId('where')).toHaveTextContent('/river');
  });

  it('with `href`, is a plain link (external, mailto)', () => {
    render(<LinkButton href="mailto:someone@example.com" size="sm">Email</LinkButton>);
    const a = screen.getByRole('link', { name: 'Email' });
    expect(a).toHaveAttribute('href', 'mailto:someone@example.com');
    expect(a).toHaveClass('btn', 'btn--secondary', 'btn--sm');
  });
});
