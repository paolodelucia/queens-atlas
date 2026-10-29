import { useEffect, useState, useSyncExternalStore } from 'react';
import type { ReactNode } from 'react';
import { Link, useRouter } from '../lib/router';
import { SITE } from '../site.config';
import './layout.css';

const NAV = [
  { to: '/river', label: 'River' },
  { to: '/diaspora', label: 'Diaspora' },
  { to: '/twin', label: 'Career Twin' },
  { to: '/method', label: 'Method' },
];

type Theme = 'light' | 'dark' | null;

function readTheme(): Theme {
  try {
    const t = localStorage.getItem('theme');
    return t === 'light' || t === 'dark' ? t : null;
  } catch {
    return null;
  }
}

const DARK_QUERY = '(prefers-color-scheme: dark)';

function subscribeToScheme(onChange: () => void) {
  if (typeof window.matchMedia !== 'function') return () => {};
  const mq = window.matchMedia(DARK_QUERY);
  mq.addEventListener?.('change', onChange);
  return () => mq.removeEventListener?.('change', onChange);
}

function prefersDark() {
  return typeof window.matchMedia === 'function' && window.matchMedia(DARK_QUERY).matches;
}

/** The brand mark: a lime tile with an ink "A" and a lilac offset shadow (same as favicon.svg). */
export function BrandMark({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 32 32" aria-hidden="true" focusable="false">
      <rect className="brandmark__shadow" x="5" y="5" width="25" height="25" rx="7" />
      <rect className="brandmark__tile" x="2" y="2" width="25" height="25" rx="7" strokeWidth="2.5" />
      <path className="brandmark__a" fillRule="evenodd" d="M12.6 7h3.8L22 22h-3.8l-1.1-3h-5.2l-1.1 3H7zM14.5 12.05l1.55 4.15h-3.1z" />
    </svg>
  );
}

/** What the footer needs from site.config (a parameter so tests can vary it). */
export interface FooterSite {
  name: string;
  author: { name: string; url: string };
  contactEmail: string;
}

/**
 * Minimal footer: "Atlas · a student project by <name>" (the byline only when an author is set),
 * links to the data and privacy notes, mailto links for removal and contact (only when a contact
 * email is set), and a one-line disclaimer.
 */
export function SiteFooter({ site = SITE }: { site?: FooterSite }) {
  const author = site.author.name.trim();
  const email = site.contactEmail.trim();
  return (
    <footer className="site-footer">
      <div className="container site-footer__inner">
        <div className="site-footer__row">
          <p className="site-footer__sig">
            <span className="site-footer__name">{site.name}</span>
            {author && (
              <>
                {' · a student project by '}
                {site.author.url ? <a href={site.author.url}>{author}</a> : author}
              </>
            )}
          </p>
          <ul className="site-footer__links">
            <li><Link to="/method#data">About the data</Link></li>
            <li><Link to="/method#privacy">Privacy</Link></li>
            {email && (
              <>
                <li><a href={`mailto:${email}?subject=${encodeURIComponent(`Remove my profile from ${site.name}`)}`}>Remove my profile</a></li>
                <li><a href={`mailto:${email}`}>Contact</a></li>
              </>
            )}
          </ul>
        </div>
        <p className="site-footer__fine">
          Not affiliated with Queen’s University or LinkedIn. Groups only: small groups are hidden and numbers are
          lightly perturbed. Not career advice.
        </p>
      </div>
    </footer>
  );
}

export function Layout({ children }: { children: ReactNode }) {
  const { loc } = useRouter();
  const [theme, setTheme] = useState<Theme>(readTheme);

  useEffect(() => {
    const root = document.documentElement;
    if (theme) root.dataset.theme = theme;
    else delete root.dataset.theme;
    try {
      if (theme) localStorage.setItem('theme', theme);
      else localStorage.removeItem('theme');
    } catch {
      /* storage unavailable (private mode): theme still applies for this visit */
    }
  }, [theme]);

  const osDark = useSyncExternalStore(subscribeToScheme, prefersDark, () => false);
  const isDark = theme === 'dark' || (theme === null && osDark);

  // Browser chrome (theme-color) follows the page colour, including a manual theme choice.
  useEffect(() => {
    const page = getComputedStyle(document.documentElement).getPropertyValue('--page').trim();
    if (!page) return;
    document.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.setAttribute('content', page));
  }, [isDark]);

  return (
    <>
      <a className="skip-link" href="#main">Skip to content</a>
      <header className="site-header">
        <div className="container site-header__inner">
          <Link to="/" className="wordmark" aria-label={`${SITE.name}, home`}>
            <BrandMark className="wordmark__mark" />
            <span className="wordmark__name">{SITE.name}</span>
          </Link>
          <nav aria-label="Main" className="site-header__nav">
            <ul className="site-nav">
              {NAV.map((n) => (
                <li key={n.to}>
                  <Link to={n.to} aria-current={loc.path === n.to ? 'page' : undefined}>{n.label}</Link>
                </li>
              ))}
            </ul>
          </nav>
          <button
            type="button"
            className="theme-toggle"
            aria-label={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
            onClick={() => setTheme(isDark ? 'light' : 'dark')}
          >
            {isDark ? (
              <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true" focusable="false">
                <circle cx="10" cy="10" r="3.6" fill="currentColor" />
                <g stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <path d="M10 1.8v2M10 16.2v2M1.8 10h2M16.2 10h2M4.2 4.2l1.4 1.4M14.4 14.4l1.4 1.4M4.2 15.8l1.4-1.4M14.4 5.6l1.4-1.4" />
                </g>
              </svg>
            ) : (
              <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true" focusable="false">
                <path d="M16.6 12.6A7 7 0 0 1 7.4 3.4a7 7 0 1 0 9.2 9.2Z" fill="currentColor" />
              </svg>
            )}
          </button>
        </div>
      </header>
      <main id="main" tabIndex={-1}>{children}</main>
      <SiteFooter />
    </>
  );
}
