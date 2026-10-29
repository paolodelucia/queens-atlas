import { fireEvent, render, screen, within } from '@testing-library/react';
import { RouterProvider } from '../lib/router';
import { SITE } from '../site.config';
import { Layout, SiteFooter } from './Layout';
import type { FooterSite } from './Layout';

const DISCLAIMER = 'Not affiliated with Queen’s University or LinkedIn. Groups only: small groups are hidden and numbers are '
  + 'lightly perturbed. Not career advice.';

function footer(site: FooterSite) {
  render(<RouterProvider><SiteFooter site={site} /></RouterProvider>);
  return screen.getByRole('contentinfo');
}

describe('SiteFooter', () => {
  beforeEach(() => window.history.replaceState(null, '', '/'));

  it('with an author and a contact email: byline, data and privacy links, removal and contact mailto links', () => {
    const f = footer({ name: 'Atlas', author: { name: 'Jane Doe', url: 'https://jane.example' }, contactEmail: 'jane@example.com' });
    expect(f).toHaveTextContent('Atlas · a student project by Jane Doe');
    expect(within(f).getByRole('link', { name: 'Jane Doe' })).toHaveAttribute('href', 'https://jane.example');
    expect(within(f).getByRole('link', { name: 'About the data' })).toHaveAttribute('href', '/method#data');
    expect(within(f).getByRole('link', { name: 'Privacy' })).toHaveAttribute('href', '/method#privacy');
    const remove = within(f).getByRole('link', { name: 'Remove my profile' }).getAttribute('href')!;
    expect(remove.startsWith('mailto:jane@example.com?subject=')).toBe(true);
    expect(decodeURIComponent(remove.split('subject=')[1])).toBe('Remove my profile from Atlas');
    expect(within(f).getByRole('link', { name: 'Contact' })).toHaveAttribute('href', 'mailto:jane@example.com');
    expect(within(f).getByText(/^Not affiliated/)).toHaveTextContent(DISCLAIMER);
  });

  it('without an author or contact email: just the name, the two Method links and the disclaimer', () => {
    const f = footer({ name: 'Atlas', author: { name: '', url: '' }, contactEmail: '' });
    expect(f).not.toHaveTextContent('student project');
    expect(within(f).getByText('Atlas')).toBeInTheDocument();
    expect(within(f).getAllByRole('link').map((a) => a.textContent)).toEqual(['About the data', 'Privacy']);
    expect(f).toHaveTextContent(DISCLAIMER);
  });

  it('an author without a URL is credited as plain text', () => {
    const f = footer({ name: 'Atlas', author: { name: 'Jane Doe', url: '' }, contactEmail: '' });
    expect(f).toHaveTextContent('a student project by Jane Doe');
    expect(within(f).queryByRole('link', { name: 'Jane Doe' })).toBeNull();
  });

  it('the footer links navigate in-app to the Method anchors', () => {
    const f = footer({ name: 'Atlas', author: { name: '', url: '' }, contactEmail: '' });
    fireEvent.click(within(f).getByRole('link', { name: 'Privacy' }));
    expect(window.location.pathname).toBe('/method');
    expect(window.location.hash).toBe('#privacy');
  });
});

describe('Layout', () => {
  beforeEach(() => {
    window.history.replaceState(null, '', '/river');
    localStorage.clear();
    delete document.documentElement.dataset.theme;
  });

  it('has a skip link, the wordmark, the main nav with the current page, the theme toggle and the footer', () => {
    render(<RouterProvider><Layout><h1>Page</h1></Layout></RouterProvider>);
    expect(screen.getByRole('link', { name: 'Skip to content' })).toHaveAttribute('href', '#main');
    expect(screen.getByRole('link', { name: `${SITE.name}, home` })).toHaveAttribute('href', '/');
    const nav = screen.getByRole('navigation', { name: 'Main' });
    expect(within(nav).getByRole('link', { name: 'River' })).toHaveAttribute('aria-current', 'page');
    expect(within(nav).getByRole('link', { name: 'Method' })).not.toHaveAttribute('aria-current');
    expect(screen.getByRole('main')).toHaveAttribute('id', 'main');
    expect(screen.getByRole('contentinfo')).toHaveTextContent(SITE.name);
  });

  it('the theme toggle flips the theme and remembers it', () => {
    render(<RouterProvider><Layout><p>x</p></Layout></RouterProvider>);
    fireEvent.click(screen.getByRole('button', { name: 'Switch to dark theme' }));
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(localStorage.getItem('theme')).toBe('dark');
    fireEvent.click(screen.getByRole('button', { name: 'Switch to light theme' }));
    expect(document.documentElement.dataset.theme).toBe('light');
  });
});
