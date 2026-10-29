import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ShareProgram } from './ShareProgram';

const TITLE = 'Commerce at Queen’s';
const LINK = `${window.location.origin}/p/undergrad-commerce/`;
const realMatchMedia = window.matchMedia;

/** Pretend to be a phone (coarse pointer) or a desktop. */
function pointer(coarse: boolean) {
  window.matchMedia = ((query: string) => ({
    matches: coarse && query === '(pointer: coarse)', media: query, onchange: null,
    addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false,
  })) as typeof window.matchMedia;
}
/** Call after userEvent.setup(), which installs a clipboard of its own. */
function clipboard() {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
  return writeText;
}
function shareApi(impl?: () => Promise<void>) {
  const share = vi.fn(impl ?? (() => Promise.resolve()));
  Object.defineProperty(navigator, 'share', { value: share, configurable: true, writable: true });
  return share;
}

beforeEach(() => pointer(false));
afterEach(() => {
  window.matchMedia = realMatchMedia;
  Reflect.deleteProperty(navigator, 'share');
  vi.restoreAllMocks();
});

const renderIt = () => render(<ShareProgram level="undergrad" program="Commerce" title={TITLE} />);

describe('ShareProgram', () => {
  it('without the share API, copies the program’s share link, with CopyLink’s feedback', async () => {
    const user = userEvent.setup();
    const writeText = clipboard();
    renderIt();
    expect(screen.getByRole('group', { name: `Share ${TITLE}` })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: `Share ${TITLE}: copy its link` }));
    expect(writeText).toHaveBeenCalledWith(LINK);
    expect(await screen.findByText(/^Link copied/)).toBeInTheDocument();
    expect(screen.getByText('Copied')).toBeInTheDocument();
  });

  it('on a desktop that has the share API, still copies (the share sheet is for phones)', async () => {
    const user = userEvent.setup();
    const writeText = clipboard();
    const share = shareApi();
    renderIt();
    await user.click(screen.getByRole('button', { name: `Share ${TITLE}: copy its link` }));
    expect(writeText).toHaveBeenCalledWith(LINK);
    expect(share).not.toHaveBeenCalled();
  });

  it('on a phone with the share API, opens the share sheet with the title and link', async () => {
    pointer(true);
    const user = userEvent.setup();
    const writeText = clipboard();
    const share = shareApi();
    renderIt();
    const button = screen.getByRole('button', { name: `Share ${TITLE}` });
    expect(button).toHaveTextContent('Share');
    await user.click(button);
    expect(share).toHaveBeenCalledWith({ title: TITLE, url: LINK });
    expect(writeText).not.toHaveBeenCalled();
  });

  it('treats closing the share sheet as nothing, and any other failure as “copy instead”', async () => {
    pointer(true);
    const user = userEvent.setup();
    const writeText = clipboard();
    const share = shareApi(() => Promise.reject(new DOMException('cancelled', 'AbortError')));
    const { unmount } = renderIt();
    await user.click(screen.getByRole('button', { name: `Share ${TITLE}` }));
    expect(share).toHaveBeenCalledTimes(1);
    expect(writeText).not.toHaveBeenCalled();
    unmount();

    shareApi(() => Promise.reject(new DOMException('no', 'NotAllowedError')));
    renderIt();
    await user.click(screen.getByRole('button', { name: `Share ${TITLE}` }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(LINK));
    expect(screen.getByRole('button', { name: `Share ${TITLE}` })).toHaveTextContent('Copied');
    expect(screen.getByText(/^Link copied/)).toBeInTheDocument();
  });

  it('offers the card itself as a download', () => {
    renderIt();
    const save = screen.getByRole('link', { name: `Save image of the ${TITLE} card` });
    expect(save).toHaveAttribute('href', '/share/undergrad-commerce.jpg');
    expect(save).toHaveAttribute('download', 'atlas-undergrad-commerce.jpg');
    expect(save).toHaveTextContent('Save image');
  });
});
