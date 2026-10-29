import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CopyLink, writeToClipboard } from './CopyLink';

function withClipboard(writeText: ((t: string) => Promise<void>) | undefined) {
  vi.stubGlobal('navigator', { ...navigator, clipboard: writeText ? { writeText } : undefined });
}

const live = (container: HTMLElement) => container.querySelector('[aria-live="polite"]')!;

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('CopyLink', () => {
  it('copies the given URL and says so, visibly and through a live region', async () => {
    const writeText = vi.fn(async () => {});
    withClipboard(writeText);
    const { container } = render(<CopyLink url="https://example.com/river?level=law" ariaLabel="Copy link to this view" />);
    const button = screen.getByRole('button', { name: 'Copy link to this view' });
    expect(button).toHaveTextContent('Copy link');
    expect(live(container)).toHaveTextContent('');
    await userEvent.click(button);
    expect(writeText).toHaveBeenCalledWith('https://example.com/river?level=law');
    expect(button).toHaveTextContent('Copied');
    expect(live(container)).toHaveTextContent('Link copied');
  });

  it('reads a function URL at click time and defaults to the page URL', async () => {
    const writeText = vi.fn(async () => {});
    withClipboard(writeText);
    let n = 0;
    const { unmount } = render(<CopyLink url={() => `https://example.com/?n=${++n}`} />);
    await userEvent.click(screen.getByRole('button', { name: 'Copy link' }));
    expect(writeText).toHaveBeenLastCalledWith('https://example.com/?n=1');
    unmount();
    render(<CopyLink />);
    await userEvent.click(screen.getByRole('button', { name: 'Copy link' }));
    expect(writeText).toHaveBeenLastCalledWith(window.location.href);
  });

  it('goes back to "Copy link" after a moment', async () => {
    vi.useFakeTimers();
    withClipboard(vi.fn(async () => {}));
    const { container } = render(<CopyLink url="https://example.com/" />);
    const button = screen.getByRole('button', { name: 'Copy link' });
    await act(async () => { fireEvent.click(button); });
    expect(button).toHaveTextContent('Copied');
    act(() => { vi.advanceTimersByTime(3000); });
    expect(button).toHaveTextContent('Copy link');
    expect(live(container)).toHaveTextContent('');
  });

  it('without the Clipboard API, shows the link selected in a field to copy by hand', async () => {
    withClipboard(undefined);
    render(<CopyLink url="https://example.com/river?cohort=all" ariaLabel="Copy link to this view" />);
    const button = screen.getByRole('button', { name: 'Copy link to this view' });
    await userEvent.click(button);
    const field = await screen.findByRole('textbox', { name: 'Copy this link' });
    expect(field).toHaveValue('https://example.com/river?cohort=all');
    expect(field).toHaveAttribute('readonly');
    await waitFor(() => expect(field).toHaveFocus());
    const input = field as HTMLInputElement;
    expect([input.selectionStart, input.selectionEnd]).toEqual([0, input.value.length]);
    expect(button).toHaveAttribute('aria-controls', field.closest('.copylink__panel')!.id);
    // Escape closes it and returns focus to the button
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(button).toHaveFocus();
  });

  it('falls back when the browser refuses, and closes with Done or a click outside', async () => {
    withClipboard(vi.fn(async () => { throw new DOMException('denied', 'NotAllowedError'); }));
    render(<><CopyLink url="https://example.com/" /><p>Elsewhere</p></>);
    await userEvent.click(screen.getByRole('button', { name: 'Copy link' }));
    await screen.findByRole('textbox', { name: 'Copy this link' });
    await userEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.getByRole('button', { name: 'Copy link' })).toHaveFocus();
    await userEvent.click(screen.getByRole('button', { name: 'Copy link' }));
    await screen.findByRole('textbox', { name: 'Copy this link' });
    await userEvent.click(screen.getByText('Elsewhere'));
    expect(screen.queryByRole('textbox')).toBeNull();
  });
});

describe('CopyLink align', () => {
  it('lines the fallback panel up with the button end by default, or its start with align="start"', async () => {
    withClipboard(undefined);
    const { container, unmount } = render(<CopyLink url="https://example.com/" />);
    expect(container.querySelector('.copylink')).not.toHaveClass('copylink--start');
    unmount();
    const start = render(<CopyLink url="https://example.com/" align="start" className="hero-copy" />);
    const wrap = start.container.querySelector('.copylink')!;
    expect(wrap).toHaveClass('copylink', 'copylink--start', 'hero-copy');
    await userEvent.click(screen.getByRole('button', { name: 'Copy link' }));
    const panel = (await screen.findByRole('textbox', { name: 'Copy this link' })).closest('.copylink__panel');
    expect(wrap).toContainElement(panel as HTMLElement);
  });
});

describe('writeToClipboard', () => {
  it('resolves true on success and false when unavailable or refused', async () => {
    withClipboard(vi.fn(async () => {}));
    await expect(writeToClipboard('x')).resolves.toBe(true);
    withClipboard(undefined);
    await expect(writeToClipboard('x')).resolves.toBe(false);
    withClipboard(vi.fn(async () => { throw new Error('nope'); }));
    await expect(writeToClipboard('x')).resolves.toBe(false);
  });
});
