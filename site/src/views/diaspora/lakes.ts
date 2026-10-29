/**
 * world-atlas (Natural Earth admin-0) has no inland water: the Great Lakes are solid land, which
 * looks wrong on a map whose whole story starts on the shore of Lake Ontario. These are
 * hand-simplified outlines (a few dozen points each, traced from shoreline towns) drawn in the
 * water colour on top of the land. They are cartographic context only, never data.
 *
 * Coordinates are [lon, lat]. Ring winding is normalised at runtime (d3-geo wants exterior rings
 * clockwise; a ring wound the wrong way would paint the whole globe).
 */
import type { Feature, FeatureCollection, LineString, Polygon, Position } from 'geojson';

type Ring = Position[];

const LAKE_ONTARIO: Ring = [
  [-79.85, 43.29], [-79.78, 43.33], [-79.67, 43.44], [-79.55, 43.55], [-79.39, 43.63], [-79.22, 43.7],
  [-79.05, 43.81], [-78.85, 43.86], [-78.55, 43.9], [-78.28, 43.94], [-77.95, 43.98], [-77.72, 43.99],
  [-77.55, 43.95], [-77.3, 43.87], [-77.15, 43.83], [-76.86, 43.94], [-76.7, 44.1], [-76.55, 44.18],
  [-76.48, 44.22], [-76.33, 44.12], [-76.25, 44.02], [-76.12, 43.95], [-76.2, 43.86], [-76.19, 43.68],
  [-76.21, 43.53], [-76.52, 43.46], [-76.7, 43.34], [-76.98, 43.28], [-77.3, 43.27], [-77.6, 43.26],
  [-77.95, 43.36], [-78.2, 43.37], [-78.5, 43.37], [-78.72, 43.34], [-79.06, 43.26], [-79.27, 43.2],
  [-79.56, 43.2], [-79.75, 43.24],
];

const LAKE_ERIE: Ring = [
  [-83.15, 42.05], [-82.9, 42.03], [-82.6, 42.03], [-82.52, 41.93], [-82.45, 42.1], [-81.85, 42.27],
  [-81.5, 42.5], [-81.21, 42.66], [-80.8, 42.64], [-80.45, 42.6], [-80.05, 42.55], [-80.2, 42.78],
  [-79.85, 42.83], [-79.6, 42.85], [-79.25, 42.87], [-78.92, 42.88], [-79.05, 42.7], [-79.33, 42.49],
  [-79.75, 42.27], [-80.09, 42.15], [-80.4, 42.0], [-80.79, 41.9], [-81.25, 41.76], [-81.69, 41.5],
  [-82.18, 41.47], [-82.5, 41.39], [-82.72, 41.45], [-82.94, 41.52], [-83.25, 41.62], [-83.47, 41.69],
  [-83.4, 41.9],
];

const LAKE_HURON: Ring = [
  [-82.42, 43.0], [-82.5, 43.27], [-82.54, 43.43], [-82.62, 43.75], [-82.65, 43.85], [-82.8, 44.0],
  [-82.95, 44.06], [-83.27, 43.97], [-83.45, 43.75], [-83.85, 43.62], [-83.9, 43.85], [-83.85, 44.03],
  [-83.5, 44.25], [-83.32, 44.42], [-83.29, 44.66], [-83.35, 44.9], [-83.42, 45.06], [-83.45, 45.3],
  [-83.82, 45.42], [-84.2, 45.6], [-84.47, 45.65], [-84.72, 45.78], [-84.72, 45.86], [-84.4, 45.97],
  [-83.9, 45.99], [-84.05, 46.25], [-83.8, 46.3], [-83.55, 46.25], [-83.0, 46.18], [-82.4, 46.18],
  [-81.95, 46.12], [-81.55, 46.03], [-81.1, 45.98], [-80.85, 45.95], [-80.55, 45.78], [-80.35, 45.58],
  [-80.08, 45.35], [-79.95, 45.1], [-79.83, 44.88], [-79.9, 44.75], [-80.02, 44.53], [-80.22, 44.5],
  [-80.6, 44.61], [-80.94, 44.57], [-80.95, 44.7], [-81.14, 44.75], [-81.25, 45.0], [-81.32, 45.25],
  [-81.66, 45.26], [-81.62, 45.1], [-81.48, 44.88], [-81.4, 44.6], [-81.38, 44.5], [-81.64, 44.18],
  [-81.72, 43.74], [-81.76, 43.31], [-82.1, 43.15],
];

const LAKE_MICHIGAN: Ring = [
  [-84.75, 45.8], [-85.0, 45.75], [-84.98, 45.45], [-85.26, 45.32], [-85.4, 45.18], [-85.62, 45.05],
  [-85.76, 45.02], [-86.05, 44.9], [-86.24, 44.63], [-86.33, 44.25], [-86.45, 43.95], [-86.43, 43.65],
  [-86.28, 43.23], [-86.23, 43.06], [-86.21, 42.79], [-86.28, 42.4], [-86.49, 42.11], [-86.9, 41.72],
  [-87.35, 41.62], [-87.53, 41.7], [-87.62, 41.88], [-87.67, 42.06], [-87.8, 42.3], [-87.82, 42.58],
  [-87.78, 42.73], [-87.88, 43.04], [-87.9, 43.3], [-87.71, 43.75], [-87.65, 44.09], [-87.5, 44.46],
  [-87.43, 44.62], [-87.25, 44.85], [-87.05, 45.15], [-86.95, 45.29], [-87.25, 45.15], [-87.45, 44.95],
  [-87.7, 44.7], [-88.0, 44.55], [-87.85, 44.72], [-87.6, 45.1], [-87.4, 45.45], [-87.05, 45.75],
  [-86.95, 45.9], [-86.6, 45.85], [-86.25, 45.95], [-85.8, 46.05], [-85.45, 46.08], [-85.0, 46.0],
  [-84.75, 45.87],
];

const LAKE_SUPERIOR: Ring = [
  [-84.4, 46.5], [-84.6, 46.55], [-84.55, 46.92], [-84.65, 47.35], [-84.85, 47.7], [-84.95, 47.95],
  [-85.8, 48.25], [-86.4, 48.72], [-86.7, 48.78], [-87.1, 48.78], [-87.6, 48.92], [-88.25, 48.95],
  [-89.0, 48.5], [-89.22, 48.4], [-89.4, 48.1], [-89.68, 47.96], [-90.33, 47.75], [-91.27, 47.29],
  [-91.67, 47.02], [-92.1, 46.78], [-91.38, 46.78], [-90.85, 46.95], [-90.88, 46.62], [-90.4, 46.57],
  [-89.9, 46.7], [-89.31, 46.87], [-88.95, 47.0], [-88.55, 47.25], [-88.2, 47.45], [-87.88, 47.47],
  [-87.7, 47.4], [-88.0, 47.2], [-88.2, 47.0], [-88.45, 46.78], [-87.73, 46.83], [-87.4, 46.55],
  [-87.0, 46.48], [-86.65, 46.42], [-86.3, 46.6], [-85.98, 46.67], [-85.4, 46.7], [-84.96, 46.77],
  [-84.95, 46.55], [-84.65, 46.48],
];

const LAKE_ST_CLAIR: Ring = [
  [-82.88, 42.35], [-82.85, 42.55], [-82.65, 42.62], [-82.45, 42.52], [-82.42, 42.35], [-82.6, 42.3],
];

const LAKE_SIMCOE: Ring = [
  [-79.69, 44.39], [-79.55, 44.5], [-79.42, 44.6], [-79.25, 44.52], [-79.15, 44.43], [-79.22, 44.33],
  [-79.38, 44.28], [-79.48, 44.22], [-79.52, 44.32], [-79.6, 44.37],
];

const LAKE_NIPISSING: Ring = [
  [-80.25, 46.22], [-80.0, 46.33], [-79.6, 46.33], [-79.45, 46.25], [-79.7, 46.15], [-80.05, 46.12],
];

/** Islands drawn back in land colour on top of the lakes. */
const MANITOULIN: Ring = [
  [-83.25, 45.93], [-82.95, 45.97], [-82.48, 45.93], [-82.2, 46.01], [-81.93, 45.98], [-81.72, 45.88],
  [-81.68, 45.72], [-81.78, 45.62], [-82.05, 45.57], [-82.35, 45.65], [-82.75, 45.75], [-83.1, 45.82],
];

/** Rivers as polylines (stroked in the water colour): the St. Lawrence up to where Natural Earth
 * already has it as water (Sorel), and the Ottawa River. */
const ST_LAWRENCE: Position[] = [
  [-76.4, 44.2], [-76.16, 44.31], [-75.92, 44.38], [-75.68, 44.58], [-75.52, 44.71], [-75.18, 44.9],
  [-74.73, 45.02], [-74.4, 45.12], [-74.13, 45.25], [-73.85, 45.38], [-73.55, 45.5], [-73.45, 45.7],
  [-73.12, 46.04],
];
const OTTAWA_RIVER: Position[] = [
  [-77.1, 45.83], [-76.6, 45.58], [-76.35, 45.45], [-75.7, 45.43], [-75.2, 45.55], [-74.6, 45.61],
  [-74.2, 45.5], [-74.0, 45.45], [-73.85, 45.4],
];

/** Shoelace sum in lon/lat: negative = clockwise with north up, which is what d3-geo expects. */
export function ringIsClockwise(ring: Ring): boolean {
  let sum = 0;
  for (let i = 0; i < ring.length; i++) {
    const [x0, y0] = ring[i];
    const [x1, y1] = ring[(i + 1) % ring.length];
    sum += x0 * y1 - x1 * y0;
  }
  return sum < 0;
}

/** Close the ring and wind it clockwise. */
export function normaliseRing(ring: Ring): Ring {
  const r = ring.slice();
  const [fx, fy] = r[0];
  const [lx, ly] = r[r.length - 1];
  if (fx !== lx || fy !== ly) r.push([fx, fy]);
  return ringIsClockwise(r) ? r : r.reverse();
}

function polygon(name: string, ring: Ring): Feature<Polygon> {
  return { type: 'Feature', properties: { name }, geometry: { type: 'Polygon', coordinates: [normaliseRing(ring)] } };
}

export const LAKES: FeatureCollection<Polygon> = {
  type: 'FeatureCollection',
  features: [
    polygon('Lake Superior', LAKE_SUPERIOR),
    polygon('Lake Michigan', LAKE_MICHIGAN),
    polygon('Lake Huron', LAKE_HURON),
    polygon('Lake Erie', LAKE_ERIE),
    polygon('Lake Ontario', LAKE_ONTARIO),
    polygon('Lake St. Clair', LAKE_ST_CLAIR),
    polygon('Lake Simcoe', LAKE_SIMCOE),
    polygon('Lake Nipissing', LAKE_NIPISSING),
  ],
};

export const ISLANDS: FeatureCollection<Polygon> = {
  type: 'FeatureCollection',
  features: [polygon('Manitoulin Island', MANITOULIN)],
};

export const RIVERS: FeatureCollection<LineString> = {
  type: 'FeatureCollection',
  features: [
    { type: 'Feature', properties: { name: 'St. Lawrence River' }, geometry: { type: 'LineString', coordinates: ST_LAWRENCE } },
    { type: 'Feature', properties: { name: 'Ottawa River' }, geometry: { type: 'LineString', coordinates: OTTAWA_RIVER } },
  ],
};
