/** Small, hand-made diaspora.json for tests: covers the awkward cases on purpose. */
import type { DiasporaFile, Metro } from '../../data/types';

const m = (id: string, name: string, region: string, country: string, lat: number, lon: number, n: number): Metro =>
  ({ id, name, region, country, lat, lon, n });

export const METROS: Metro[] = [
  m('toronto', 'Toronto', 'Ontario', 'CA', 43.6532, -79.3832, 30120),
  m('kingston', 'Kingston', 'Ontario', 'CA', 44.2312, -76.486, 8330),
  m('ottawa', 'Ottawa', 'Ontario', 'CA', 45.4215, -75.6972, 6340),
  m('vancouver', 'Vancouver', 'British Columbia', 'CA', 49.2827, -123.1207, 4108),
  m('new-york', 'New York', 'New York', 'US', 40.7128, -74.006, 912),
  m('london-gb', 'London', 'England', 'GB', 51.5074, -0.1278, 634),
  m('sydney', 'Sydney', 'New South Wales', 'AU', -33.8688, 151.21, 116),
  m('tokyo', 'Tokyo', 'Tokyo', 'JP', 35.6762, 139.65, 63),
  m('auckland', 'Auckland', 'Auckland', 'NZ', -36.85, 174.76, 21),
  m('whitehorse', 'Whitehorse', 'Yukon', 'CA', 60.72, -135.06, 69),
  /** Deliberately absent from metroDetail. */
  m('nodetail', 'Long Sault', 'Ontario', 'CA', 45.03, -74.89, 10),
  /** Same name as london-gb and in no view: its display name, and London UK's, must be qualified. */
  m('london-on', 'London', 'Ontario', 'CA', 42.98, -81.25, 763),
];

export function makeFile(): DiasporaFile {
  return {
    metros: METROS.map((x) => ({ ...x })),
    views: [
      {
        level: 'all', program: 'all', cohort: 'all', n: 92830,
        metros: [
          ['toronto', 30120], ['kingston', 8330], ['ottawa', 6340], ['vancouver', 4108], ['new-york', 912],
          ['london-gb', 634], ['sydney', 116], ['whitehorse', 69], ['tokyo', 63], ['auckland', 21], ['nodetail', 10],
          // Unknown id: must be skipped, not crash.
          ['atlantis', 40],
        ],
        countries: [['CA', 80571], ['US', 5110], ['GB', 1564], ['AU', 424], ['JP', 116], ['NZ', 79]],
      },
      {
        level: 'all', program: 'all', cohort: '2020-2024', n: 17581,
        metros: [['toronto', 7000], ['kingston', 2500], ['new-york', 120]],
        countries: [['CA', 15891], ['US', 567]],
      },
      {
        level: 'undergrad', program: 'all', cohort: 'all', n: 44659,
        metros: [['toronto', 16000], ['kingston', 4000], ['london-gb', 300]],
        countries: [['CA', 39000], ['US', 2500], ['GB', 700]],
      },
      {
        level: 'undergrad', program: 'Computer Science', cohort: 'all', n: 1384,
        metros: [['toronto', 595], ['kingston', 185], ['ottawa', 113], ['vancouver', 38]],
        countries: [['CA', 1243], ['US', 77], ['GB', 11]],
      },
      {
        level: 'undergrad', program: 'Computer Science', cohort: '2015-2019', n: 300,
        metros: [['toronto', 150], ['kingston', 40]],
        countries: [['CA', 280]],
      },
      {
        level: 'graduate', program: 'Computer Science', cohort: 'all', n: 469,
        metros: [['toronto', 160], ['kingston', 90]],
        countries: [['CA', 380], ['US', 40]],
      },
      // Placeable only at country level: no metro reaches 10.
      { level: 'graduate', program: 'Art Conservation', cohort: 'all', n: 55, metros: [], countries: [['CA', 50]] },
    ],
    metroDetail: {
      toronto: {
        families: [['finance_accounting', 2054], ['tech', 1662], ['law', 1216]],
        employers: [{ name: 'RBC', n: 349 }, { name: 'TD', n: 260 }],
        programs: [{ level: 'undergrad', program: 'Commerce', n: 3435 }, { level: 'law', program: 'Law', n: 1747 }],
        cohorts: [['pre-1995', 3005], ['2020-2024', 6614], ['2005-2009', 5939]],
      },
      kingston: { families: [], employers: [], programs: [], cohorts: [] },
      ottawa: { families: [['government_policy', 900]], employers: [], programs: [], cohorts: [] },
    },
    flows: [
      { from: 'kingston', to: 'toronto', n: 699 },
      { from: 'toronto', to: 'kingston', n: 220 },
      { from: 'vancouver', to: 'sydney', n: 12 },
      { from: 'tokyo', to: 'vancouver', n: 10 },
      { from: 'toronto', to: 'london-gb', n: 75 },
      { from: 'atlantis', to: 'toronto', n: 50 },
      { from: 'toronto', to: 'nowhere', n: 30 },
      { from: 'toronto', to: 'toronto', n: 20 },
      { from: 'ottawa', to: 'toronto', n: 0 },
    ],
    abroad: {
      byCohort: [
        { cohort: 'all', n: 92830, abroad: 12259, us: 5110 },
        { cohort: '2020-2024', n: 17581, abroad: 1690, us: 567 },
        { cohort: 'pre-1995', n: 10923, abroad: 1584, us: 940 },
        { cohort: '1995-1999', n: 8315, abroad: 1430, us: null },
        { cohort: '2005-2009', n: 0, abroad: null, us: null },
      ],
      byProgram: [
        { level: 'undergrad', program: 'Computer Science', n: 1384, abroad: 141, us: 77 },
        { level: 'graduate', program: 'Computer Science', n: 469, abroad: 103, us: null },
        { level: 'graduate', program: 'Art Conservation', n: 55, abroad: null, us: null },
        { level: 'undergrad', program: 'Commerce', n: 7171, abroad: 1032, us: 433 },
        { level: 'undergrad', program: 'Nursing', n: 900, abroad: 0, us: 0 },
      ],
    },
    kingston: {
      firstJobInKingston: 2776,
      stillInKingston: 1150,
      nowElsewhere: [{ name: 'Ottawa', n: 206 }, { name: 'Toronto', n: 699 }],
    },
  };
}
