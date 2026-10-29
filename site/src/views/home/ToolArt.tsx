/**
 * Small illustrative previews for the three tool cards. Drawn, not screenshotted: each is a
 * schematic of what the tool shows, in the sector palette, and purely decorative (aria-hidden;
 * the card's heading and hook carry the meaning).
 */
import { SECTOR } from '../../data/taxonomy';
import type { SectorId } from '../../data/taxonomy';
import { layoutFlows } from './model';
import type { FlowData } from './model';

const c = (s: SectorId) => SECTOR[s].color;

// An illustrative three-stage river (made-up proportions, the shape of the real thing).
const DEMO: FlowData = {
  n: 100,
  stages: ['s0', 'y5', 'now'],
  nodes: [
    { stage: 's0', sector: 'tech', value: 14 }, { stage: 's0', sector: 'finance', value: 26 },
    { stage: 's0', sector: 'education', value: 22 }, { stage: 's0', sector: 'public', value: 16 },
    { stage: 's0', sector: 'engineering', value: 22 },
    { stage: 'y5', sector: 'tech', value: 20 }, { stage: 'y5', sector: 'finance', value: 24 },
    { stage: 'y5', sector: 'education', value: 12 }, { stage: 'y5', sector: 'public', value: 18 },
    { stage: 'y5', sector: 'management', value: 10 }, { stage: 'y5', sector: 'engineering', value: 16 },
    { stage: 'now', sector: 'tech', value: 22 }, { stage: 'now', sector: 'finance', value: 20 },
    { stage: 'now', sector: 'education', value: 10 }, { stage: 'now', sector: 'public', value: 18 },
    { stage: 'now', sector: 'management', value: 18 }, { stage: 'now', sector: 'engineering', value: 12 },
  ],
  links: [
    { from: 's0', fromSector: 'tech', to: 'y5', toSector: 'tech', value: 14 },
    { from: 's0', fromSector: 'finance', to: 'y5', toSector: 'finance', value: 20 },
    { from: 's0', fromSector: 'finance', to: 'y5', toSector: 'management', value: 6 },
    { from: 's0', fromSector: 'education', to: 'y5', toSector: 'education', value: 12 },
    { from: 's0', fromSector: 'education', to: 'y5', toSector: 'public', value: 6 },
    { from: 's0', fromSector: 'education', to: 'y5', toSector: 'finance', value: 4 },
    { from: 's0', fromSector: 'public', to: 'y5', toSector: 'public', value: 12 },
    { from: 's0', fromSector: 'public', to: 'y5', toSector: 'management', value: 4 },
    { from: 's0', fromSector: 'engineering', to: 'y5', toSector: 'engineering', value: 16 },
    { from: 's0', fromSector: 'engineering', to: 'y5', toSector: 'tech', value: 6 },
    { from: 'y5', fromSector: 'tech', to: 'now', toSector: 'tech', value: 18 },
    { from: 'y5', fromSector: 'tech', to: 'now', toSector: 'management', value: 2 },
    { from: 'y5', fromSector: 'finance', to: 'now', toSector: 'finance', value: 18 },
    { from: 'y5', fromSector: 'finance', to: 'now', toSector: 'management', value: 6 },
    { from: 'y5', fromSector: 'education', to: 'now', toSector: 'education', value: 10 },
    { from: 'y5', fromSector: 'education', to: 'now', toSector: 'public', value: 2 },
    { from: 'y5', fromSector: 'public', to: 'now', toSector: 'public', value: 16 },
    { from: 'y5', fromSector: 'public', to: 'now', toSector: 'finance', value: 2 },
    { from: 'y5', fromSector: 'management', to: 'now', toSector: 'management', value: 10 },
    { from: 'y5', fromSector: 'engineering', to: 'now', toSector: 'engineering', value: 12 },
    { from: 'y5', fromSector: 'engineering', to: 'now', toSector: 'tech', value: 4 },
  ],
};

export function RiverArt() {
  const L = layoutFlows(DEMO, { width: 260, height: 132, nodeWidth: 5, gap: 5 });
  return (
    <svg className="tool-art" viewBox="-30 -24 320 180" aria-hidden="true" focusable="false">
      <g className="tool-art__ribbons">
        {L.links.map((l, i) => (
          <path key={i} d={l.d} style={{ stroke: c(l.fromSector), strokeWidth: Math.max(1, l.w - 1) }} />
        ))}
      </g>
      {L.nodes.map((n) => (
        <rect key={`${n.stage}${n.sector}`} x={n.x} y={n.y} width={5} height={n.h} rx={1.5} style={{ fill: c(n.sector) }} />
      ))}
    </svg>
  );
}

const DESTS: { x: number; y: number; r: number }[] = [
  { x: 132, y: 98, r: 9 },   // the big nearby metro
  { x: 150, y: 70, r: 6 },
  { x: 104, y: 52, r: 4.5 },
  { x: 58, y: 70, r: 5 },    // out west
  { x: 34, y: 92, r: 4 },
  { x: 120, y: 128, r: 4 },  // south of the border
  { x: 236, y: 58, r: 6 },   // across the ocean
  { x: 258, y: 82, r: 4 },
];
const ORIGIN = { x: 160, y: 92 };

export function DiasporaArt() {
  const dots: { x: number; y: number }[] = [];
  for (let y = 18; y <= 150; y += 12) for (let x = 12; x <= 300; x += 12) dots.push({ x, y });
  return (
    <svg className="tool-art" viewBox="0 0 320 170" aria-hidden="true" focusable="false">
      <g className="tool-art__grid">
        {dots.map((d, i) => <circle key={i} cx={d.x} cy={d.y} r={1.3} />)}
      </g>
      <g className="tool-art__arcs">
        {DESTS.map((d, i) => {
          const mx = (ORIGIN.x + d.x) / 2;
          const lift = Math.max(18, Math.abs(d.x - ORIGIN.x) * 0.45);
          return <path key={i} d={`M${ORIGIN.x},${ORIGIN.y} Q${mx},${Math.min(ORIGIN.y, d.y) - lift} ${d.x},${d.y}`} />;
        })}
      </g>
      <g className="tool-art__dests">
        {DESTS.map((d, i) => <circle key={i} cx={d.x} cy={d.y} r={d.r} />)}
      </g>
      <circle className="tool-art__origin" cx={ORIGIN.x} cy={ORIGIN.y} r={5} />
    </svg>
  );
}

const TWIN_SECTORS: SectorId[] = [
  'finance', 'finance', 'tech', 'finance', 'management', 'finance', 'public',
  'finance', 'tech', 'finance', 'management', 'finance', 'creative', 'finance',
  'management', 'finance', 'tech', 'neutral', 'finance', 'finance', 'tech',
  'finance', 'public', 'finance', 'management', 'finance', 'tech', 'finance',
  'finance', 'management', 'finance', 'neutral', 'finance', 'tech', 'finance',
];

export function TwinArt() {
  const cols = 7;
  const you = 17; // the middle of the 7x5 grid
  return (
    <svg className="tool-art" viewBox="0 0 320 170" aria-hidden="true" focusable="false">
      {TWIN_SECTORS.map((s, i) => {
        const x = 70 + (i % cols) * 30;
        const y = 25 + Math.floor(i / cols) * 30;
        return i === you
          ? <g key={i}><circle className="tool-art__you-ring" cx={x} cy={y} r={11} /><circle className="tool-art__you" cx={x} cy={y} r={6} /></g>
          : <circle key={i} cx={x} cy={y} r={8} style={{ fill: c(s) }} />;
      })}
    </svg>
  );
}
