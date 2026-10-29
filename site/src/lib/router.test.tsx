import { act, fireEvent, render, screen } from '@testing-library/react';
import { Link, RouterProvider, useQueryState, useRouter } from './router';

function Where() {
  const { loc } = useRouter();
  return <p data-testid="where">{loc.path}{loc.search}</p>;
}

type Level = 'all' | 'mba';
const parseLevel = (raw: string): Level | null => (raw === 'all' || raw === 'mba' ? raw : null);

function LevelPicker() {
  const [level, setLevel] = useQueryState<Level>('level', 'all', parseLevel);
  return (
    <>
      <p data-testid="level">{level}</p>
      <button type="button" onClick={() => setLevel('mba')}>mba</button>
      <button type="button" onClick={() => setLevel('all')}>all</button>
    </>
  );
}

function setUrl(url: string) {
  window.history.replaceState(null, '', url);
}

describe('router', () => {
  beforeEach(() => setUrl('/'));

  it('reads the current path, ignoring a trailing slash', () => {
    setUrl('/river/');
    render(<RouterProvider><Where /></RouterProvider>);
    expect(screen.getByTestId('where')).toHaveTextContent('/river');
  });

  it('Link navigates without a page load and pushes history', () => {
    render(<RouterProvider><Link to="/twin">twin</Link><Where /></RouterProvider>);
    const before = window.history.length;
    fireEvent.click(screen.getByText('twin'));
    expect(screen.getByTestId('where')).toHaveTextContent('/twin');
    expect(window.location.pathname).toBe('/twin');
    expect(window.history.length).toBe(before + 1);
  });

  it('Link lets modified clicks through to the browser (open in new tab)', () => {
    render(<RouterProvider><Link to="/twin">twin</Link><Where /></RouterProvider>);
    fireEvent.click(screen.getByText('twin'), { ctrlKey: true });
    expect(screen.getByTestId('where')).toHaveTextContent('/');
  });

  it('responds to back/forward', () => {
    render(<RouterProvider><Where /></RouterProvider>);
    act(() => {
      setUrl('/method');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    expect(screen.getByTestId('where')).toHaveTextContent('/method');
  });
});

describe('useQueryState', () => {
  beforeEach(() => setUrl('/river'));

  it('falls back to the default when the param is absent', () => {
    render(<RouterProvider><LevelPicker /></RouterProvider>);
    expect(screen.getByTestId('level')).toHaveTextContent('all');
  });

  it('reads a valid param', () => {
    setUrl('/river?level=mba');
    render(<RouterProvider><LevelPicker /></RouterProvider>);
    expect(screen.getByTestId('level')).toHaveTextContent('mba');
  });

  it('ignores a hand-edited invalid param', () => {
    setUrl('/river?level=%3Cscript%3E');
    render(<RouterProvider><LevelPicker /></RouterProvider>);
    expect(screen.getByTestId('level')).toHaveTextContent('all');
  });

  it('writes to the URL with replaceState, keeps other params, and drops defaults', () => {
    setUrl('/river?program=Commerce');
    render(<RouterProvider><LevelPicker /></RouterProvider>);
    const before = window.history.length;
    fireEvent.click(screen.getByText('mba'));
    expect(window.location.search).toBe('?program=Commerce&level=mba');
    expect(screen.getByTestId('level')).toHaveTextContent('mba');
    fireEvent.click(screen.getByText('all'));
    expect(window.location.search).toBe('?program=Commerce');
    expect(window.history.length).toBe(before);
  });
});
