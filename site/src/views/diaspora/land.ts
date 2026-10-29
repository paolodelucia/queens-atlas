/**
 * Basemap loading. The world-atlas TopoJSON files are imported as asset URLs (`?url`), not as
 * modules, so none of their bytes land in the JS bundle: the 110m file (~39 kB gzipped) is
 * fetched alongside diaspora.json, and the 50m file (~236 kB gzipped) only when someone zooms in
 * far enough to need the detail. Each file is fetched and converted once per page load.
 */
import { feature, mesh } from 'topojson-client';
import type { GeometryCollection, Topology } from 'topojson-specification';
import type { Feature, FeatureCollection, MultiLineString } from 'geojson';
import url110 from 'world-atlas/countries-110m.json?url';
import url50 from 'world-atlas/countries-50m.json?url';

export type LandDetail = '110m' | '50m';

export interface LandShapes {
  land: Feature | FeatureCollection;
  /** Shared country borders only (coastlines excluded), so borders draw as hairlines. */
  borders: MultiLineString;
}

type WorldTopo = Topology<{ countries: GeometryCollection; land: GeometryCollection }>;

const cache = new Map<LandDetail, Promise<LandShapes>>();

export function toShapes(topo: WorldTopo): LandShapes {
  return {
    land: feature(topo, topo.objects.land),
    borders: mesh(topo, topo.objects.countries, (a, b) => a !== b),
  };
}

export function loadLand(detail: LandDetail): Promise<LandShapes> {
  let p = cache.get(detail);
  if (!p) {
    p = fetch(detail === '110m' ? url110 : url50)
      .then((r) => {
        if (!r.ok) throw new Error(`Could not load the ${detail} basemap (${r.status})`);
        return r.json() as Promise<WorldTopo>;
      })
      .then(toShapes);
    p.catch(() => cache.delete(detail));
    cache.set(detail, p);
  }
  return p;
}
