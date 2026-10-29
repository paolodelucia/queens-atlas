import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ErrorBoundary } from './ErrorBoundary';
import { Empty, ErrorState, Loading } from './Status';

describe('Status', () => {
  it('Loading is a polite status with its label', () => {
    render(<Loading label="Loading the river…" />);
    expect(screen.getByRole('status')).toHaveTextContent('Loading the river…');
  });

  it('ErrorState is an alert with the message and a Try again button', async () => {
    const retry = vi.fn();
    render(<ErrorState error={new Error('Could not load river.json')} retry={retry} />);
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Something went wrong. Could not load river.json');
    // The "oops" sticker is decoration only.
    expect(screen.getByText('oops')).toHaveAttribute('aria-hidden', 'true');
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it('ErrorState without retry has no button; Empty renders its children', () => {
    render(<><ErrorState error={new Error('nope')} /><Empty>No programs match.</Empty></>);
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByText('No programs match.')).toBeInTheDocument();
  });

  it('ErrorBoundary shows the error state and recovers on Try again', async () => {
    let fail = true;
    function Flaky() {
      if (fail) throw new Error('Chart exploded');
      return <p>Chart</p>;
    }
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(<ErrorBoundary><Flaky /></ErrorBoundary>);
    expect(screen.getByRole('alert')).toHaveTextContent('Chart exploded');
    fail = false;
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(screen.getByText('Chart')).toBeInTheDocument();
    spy.mockRestore();
  });
});
