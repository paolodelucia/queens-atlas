import { Card, Highlight, Sticker } from '../../components/ui';
import type { Fact } from '../../data/types';
import { Link } from '../../lib/router';
import { factLinkLabel, factSticker, factVisual, isNumericValue } from './model';

/**
 * One headline fact, built to survive being cropped and posted on its own: the number, the
 * sentence, its denominator, and a footer with the site name and the source. `highlight` puts
 * the number on lime (one card per page). A sticker appears only where the fact's own number
 * supports it (model.factSticker).
 */
export function FactCard({ fact, source, highlight = false, tilt = 5 }: {
  fact: Fact; source: string; highlight?: boolean; tilt?: number;
}) {
  const visual = factVisual(fact.value);
  const numeric = isNumericValue(fact.value);
  const cta = factLinkLabel(fact.link);
  const sticker = factSticker(fact);
  const headingId = `fact-${fact.id}-text`;

  return (
    <Card as="article" className="fact" id={`fact-${fact.id}`} aria-labelledby={headingId}>
      {sticker && <Sticker as="p" tone="lilac" tilt={tilt} className="fact__sticker">{sticker}</Sticker>}
      <h3 className="fact__claim" id={headingId}>
        <span className={numeric ? 'fact__value num' : 'fact__value fact__value--word'}>
          {highlight && numeric ? <Highlight as="span">{fact.value}</Highlight> : fact.value}
        </span>{' '}
        <span className="fact__text">{fact.text}</span>
      </h3>
      {visual.kind === 'share' && (
        <div className="fact__meter" aria-hidden="true">
          <span style={{ width: `${Math.max(0.6, visual.share * 100)}%` }} />
        </div>
      )}
      {visual.kind === 'oneIn' && (
        <div className={visual.of > 12 ? 'fact__units fact__units--dense' : 'fact__units'} aria-hidden="true">
          {Array.from({ length: visual.of }, (_, i) => <span key={i} className={i === 0 ? 'is-hit' : undefined} />)}
        </div>
      )}
      {fact.detail && <p className="fact__detail">{fact.detail}</p>}
      <footer className="fact__foot">
        {cta && fact.link && <Link to={fact.link} className="fact__link">{cta} <span aria-hidden="true">→</span></Link>}
        <span className="fact__source">{source}</span>
      </footer>
    </Card>
  );
}
