import { lazy, Suspense, useEffect } from 'react';
import type { ComponentType } from 'react';
import { Layout } from './components/Layout';
import { ErrorBoundary } from './components/ErrorBoundary';
import { Loading } from './components/Status';
import { RouterProvider, useRouter } from './lib/router';
import NotFound from './views/NotFound';

const HomeView = lazy(() => import('./views/home/HomeView'));
const RiverView = lazy(() => import('./views/river/RiverView'));
const DiasporaView = lazy(() => import('./views/diaspora/DiasporaView'));
const TwinView = lazy(() => import('./views/twin/TwinView'));
const MethodView = lazy(() => import('./views/method/MethodView'));

export const ROUTES: Record<string, { component: ComponentType; title: string }> = {
  '/': { component: HomeView, title: 'Atlas: where 92,000 Queen’s grads actually end up' },
  '/river': { component: RiverView, title: 'The River · Atlas' },
  '/diaspora': { component: DiasporaView, title: 'The Diaspora · Atlas' },
  '/twin': { component: TwinView, title: 'Career Twin · Atlas' },
  '/method': { component: MethodView, title: 'Method · Atlas' },
};

function Routes() {
  const { loc } = useRouter();
  const route = ROUTES[loc.path];
  const View = route?.component ?? NotFound;

  useEffect(() => {
    document.title = route?.title ?? 'Not found · Atlas';
  }, [route]);

  // In-app links to an anchor (/method#privacy): the target only exists once the lazy view and
  // its data have rendered, so look for it for up to ~2 s.
  useEffect(() => {
    const id = decodeURIComponent(window.location.hash.slice(1));
    if (!id) return;
    let tries = 0;
    let raf = 0;
    const seek = () => {
      const el = document.getElementById(id);
      if (el) el.scrollIntoView();
      else if (tries++ < 120) raf = requestAnimationFrame(seek);
    };
    raf = requestAnimationFrame(seek);
    return () => cancelAnimationFrame(raf);
  }, [loc]);

  return (
    <ErrorBoundary resetKey={loc.path}>
      <Suspense fallback={<Loading label="Loading…" />}>
        <View />
      </Suspense>
    </ErrorBoundary>
  );
}

export default function App() {
  return (
    <RouterProvider>
      <Layout>
        <Routes />
      </Layout>
    </RouterProvider>
  );
}
