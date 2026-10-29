import { act, render, screen, waitFor } from '@testing-library/react';
import { __resetDataCache, loadData, useData } from './load';

function Probe() {
  const s = useData('meta');
  if (s.status === 'loading') return <p>loading</p>;
  if (s.status === 'error') return <button type="button" onClick={s.retry}>retry: {s.error.message}</button>;
  return <p>ready: {JSON.stringify(s.data.k)}</p>;
}

const ok = (body: unknown) => Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));

describe('data loading', () => {
  beforeEach(() => __resetDataCache());
  afterEach(() => vi.restoreAllMocks());

  it('fetches each file once and shares the result', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(() => ok({ k: 10 }));
    const [a, b] = await Promise.all([loadData('meta'), loadData('meta')]);
    expect(a).toBe(b);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    // Versioned by a content hash so a deploy can't pair new code with stale cached data.
    expect(String(fetchMock.mock.calls[0][0])).toMatch(/data\/meta\.json\?v=\w+$/);
  });

  it('shows loading then data', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(() => ok({ k: 10 }));
    render(<Probe />);
    expect(screen.getByText('loading')).toBeInTheDocument();
    expect(await screen.findByText('ready: 10')).toBeInTheDocument();
  });

  it('surfaces HTTP errors and recovers on retry', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockImplementationOnce(() => Promise.resolve(new Response('nope', { status: 404 })))
      .mockImplementation(() => ok({ k: 10 }));
    render(<Probe />);
    const retry = await screen.findByRole('button', { name: /retry: Could not load meta data \(404\)/ });
    await act(async () => retry.click());
    await waitFor(() => expect(screen.getByText('ready: 10')).toBeInTheDocument());
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('surfaces network failures', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(() => Promise.reject(new TypeError('Failed to fetch')));
    render(<Probe />);
    expect(await screen.findByRole('button', { name: /Failed to fetch/ })).toBeInTheDocument();
  });
});
