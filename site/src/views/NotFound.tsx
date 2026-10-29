import { Link } from '../lib/router';

export default function NotFound() {
  return (
    <div className="container" style={{ padding: '96px var(--gutter)' }}>
      <p className="eyebrow">404</p>
      <h1>This path isn’t on the map.</h1>
      <p className="lede">The page you’re looking for doesn’t exist. Most careers take a detour too.</p>
      <p><Link to="/">Back to the Atlas →</Link></p>
    </div>
  );
}
