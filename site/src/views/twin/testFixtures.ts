/**
 * Hand-made Career Twin data for tests. Never read from the real export: every number here is
 * invented so the tests pin behaviour, not this year's data.
 *
 *   Commerce (undergrad, River)     '*'          1,000  the program view; Big Four first employers
 *                                    2015-2019     300  "recent classes only"; bank first employers
 *                                    1995-1999      90  boundary years 1995 / 1999
 *                                    2000-2004     110  boundary year 2000
 *                                    2010-2014     250  (any first job)
 *                                    2010-2014     120  finance_accounting: the exact alumni match
 *                                    2020-2024     500  boundary year 2024
 *                     s0 finance_accounting        400  a first job with its own group
 *                     s0 further_study              60  pivoted and located null
 *   undergrad, any program, s0 tech                900  the level-wide group a "Tech" chip falls back to
 *   Linguistics (undergrad, no River) '*'           34  small; nothing named; nulls everywhere
 *   MBA                                            500  single-program level
 *   everyone                                      5,000
 */
import type { FamilyId, Meta, TwinFile, TwinGroup, YearPoint } from '../../data/types';

export const pt = (year: number | 'now', n: number, fields: [FamilyId, number][]): YearPoint => ({ year, n, fields });

export const blank: Omit<TwinGroup, 'level' | 'program' | 'cohort' | 's0' | 'n' | 'years'> = {
  seniorityNow: [], employersNow: [], titlesNow: [], employersFirst: [],
  pivoted: null, managerBy: [], located: null, abroad: null, us: null, topMetros: [],
};

export const COMMERCE: TwinGroup = {
  ...blank, level: 'undergrad', program: 'Commerce', cohort: '*', s0: '*', n: 1000,
  years: [
    pt(0, 1000, [
      ['finance_accounting', 400], ['sales_marketing', 150], ['consulting', 120], ['tech', 80], ['no_role_listed', 70],
      ['further_study', 60], ['operations_management', 50], ['founder', 20], ['service_trades', 15], ['law', 9], ['teaching', 6],
      ['smaller_groups', 12],
    ]),
    pt(1, 1000, [['finance_accounting', 380], ['sales_marketing', 140], ['no_role_listed', 140], ['consulting', 110], ['tech', 70], ['operations_management', 60]]),
    pt(2, 900, [['finance_accounting', 330], ['sales_marketing', 130], ['consulting', 100], ['operations_management', 70], ['no_role_listed', 90]]),
    pt(3, 800, [['finance_accounting', 290], ['sales_marketing', 120], ['operations_management', 90], ['consulting', 80]]),
    pt(5, 600, [['finance_accounting', 210], ['operations_management', 100], ['sales_marketing', 90], ['consulting', 60]]),
    pt(7, 500, [['finance_accounting', 170], ['operations_management', 100], ['sales_marketing', 70], ['founder', 30]]),
    pt(10, 400, [['finance_accounting', 130], ['operations_management', 90], ['sales_marketing', 50], ['founder', 30], ['law', 12]]),
    pt(15, 120, [['finance_accounting', 40], ['operations_management', 30], ['founder', 12]]),
    pt(20, 30, [['finance_accounting', 11], ['operations_management', 9]]),
    pt('now', 1000, [['finance_accounting', 350], ['operations_management', 180], ['sales_marketing', 120], ['founder', 50], ['no_role_listed', 60]]),
  ],
  seniorityNow: [['entry', 150], ['mid', 160], ['senior', 120], ['manager', 140], ['director', 110], ['vp', 60], ['executive', 70]],
  employersFirst: [
    { name: 'EY', n: 60 }, { name: 'Deloitte', n: 50 }, { name: 'KPMG', n: 45 }, { name: 'PwC', n: 40 },
    { name: 'RBC', n: 20 }, { name: 'TD', n: 12 },
  ],
  employersNow: [{ name: 'RBC', n: 30 }, { name: 'EY', n: 22 }],
  titlesNow: [{ name: 'Partner', n: 25 }, { name: 'Associate', n: 21 }],
  pivoted: { n: 330, of: 800 },
  managerBy: [
    { years: 1, n: 50, of: 1000 }, { years: 3, n: 150, of: 800 }, { years: 5, n: 300, of: 600 },
    { years: 10, n: 300, of: 400 }, { years: 15, n: 100, of: 120 },
  ],
  located: 990, abroad: 165, us: 70,
  topMetros: [{ name: 'Toronto', n: 500 }, { name: 'London, Ont.', n: 30 }, { name: 'London, UK', n: 25 }],
};

export const COMMERCE_RECENT: TwinGroup = {
  ...blank, level: 'undergrad', program: 'Commerce', cohort: '2015-2019', s0: '*', n: 300,
  years: [
    pt(0, 300, [['finance_accounting', 140], ['consulting', 50], ['tech', 40], ['sales_marketing', 30], ['no_role_listed', 20]]),
    pt(1, 300, [['finance_accounting', 135], ['consulting', 48]]),
    pt(5, 120, [['finance_accounting', 50], ['consulting', 20]]),
    pt('now', 300, [['finance_accounting', 120], ['consulting', 60]]),
  ],
  employersFirst: [{ name: 'RBC', n: 30 }, { name: 'TD', n: 25 }, { name: 'BMO', n: 20 }, { name: 'Scotiabank', n: 15 }],
  pivoted: { n: 80, of: 260 },
  located: 300, abroad: 30, us: 20,
};

const band = (cohort: TwinGroup['cohort'], n: number): TwinGroup => ({
  ...blank, level: 'undergrad', program: 'Commerce', cohort, s0: '*', n,
  years: [pt(0, n, [['finance_accounting', Math.round(n * 0.4)]]), pt('now', n, [['finance_accounting', Math.round(n * 0.35)]])],
});
export const COMMERCE_1995 = band('1995-1999', 90);
export const COMMERCE_2000 = band('2000-2004', 110);
export const COMMERCE_2010_ALL = band('2010-2014', 250);
export const COMMERCE_2020 = band('2020-2024', 500);

export const COMMERCE_2010_FIN: TwinGroup = {
  ...blank, level: 'undergrad', program: 'Commerce', cohort: '2010-2014', s0: 'finance_accounting', n: 120,
  years: [
    pt(0, 120, [['finance_accounting', 120]]),
    pt(1, 120, [['finance_accounting', 110], ['smaller_groups', 6]]),
    pt(3, 120, [['finance_accounting', 100], ['operations_management', 8]]),
    pt(5, 120, [['finance_accounting', 82], ['operations_management', 14], ['consulting', 9]]),
    pt(10, 120, [['finance_accounting', 66], ['operations_management', 20], ['consulting', 10]]),
    pt(15, 24, [['finance_accounting', 15], ['operations_management', 6]]),
    pt('now', 120, [['finance_accounting', 64], ['operations_management', 22], ['consulting', 11], ['no_role_listed', 6]]),
  ],
  seniorityNow: [['director', 30], ['manager', 25], ['mid', 12]],
  employersFirst: [{ name: 'EY', n: 18 }, { name: 'PwC', n: 14 }, { name: 'Deloitte', n: 12 }, { name: 'KPMG', n: 11 }],
  pivoted: { n: 45, of: 115 },
  managerBy: [{ years: 1, n: 6, of: 120 }, { years: 3, n: 30, of: 120 }, { years: 5, n: 60, of: 120 }, { years: 10, n: 90, of: 120 }],
  located: 119, abroad: 24, us: 9,
  topMetros: [{ name: 'Toronto', n: 60 }],
};

export const COMMERCE_FIN: TwinGroup = {
  ...blank, level: 'undergrad', program: 'Commerce', cohort: '*', s0: 'finance_accounting', n: 400,
  years: [
    pt(0, 400, [['finance_accounting', 400]]),
    pt(1, 400, [['finance_accounting', 370], ['consulting', 12]]),
    pt(3, 330, [['finance_accounting', 260], ['operations_management', 25], ['consulting', 15]]),
    pt(5, 250, [['finance_accounting', 170], ['operations_management', 30], ['consulting', 20]]),
    pt(10, 160, [['finance_accounting', 90], ['operations_management', 30], ['consulting', 15], ['no_role_listed', 8]]),
    pt('now', 400, [['finance_accounting', 230], ['operations_management', 70], ['consulting', 40], ['no_role_listed', 20]]),
  ],
  employersFirst: [{ name: 'EY', n: 50 }],
  pivoted: { n: 150, of: 380 },
  managerBy: [{ years: 10, n: 100, of: 160 }],
  located: 398, abroad: 60, us: 30,
};

export const COMMERCE_STUDY: TwinGroup = {
  ...blank, level: 'undergrad', program: 'Commerce', cohort: '*', s0: 'further_study', n: 60,
  years: [
    pt(0, 60, [['further_study', 60]]),
    pt(1, 60, [['further_study', 40], ['law', 8]]),
    pt(5, 40, [['law', 20], ['finance_accounting', 9]]),
    pt('now', 60, [['law', 25], ['finance_accounting', 12]]),
  ],
  pivoted: null, located: null, abroad: null, us: null,
};

export const UG_TECH: TwinGroup = {
  ...blank, level: 'undergrad', program: '*', cohort: '*', s0: 'tech', n: 900,
  years: [
    pt(0, 900, [['tech', 900]]),
    pt(3, 700, [['tech', 600], ['operations_management', 30]]),
    pt(10, 300, [['tech', 180], ['operations_management', 40]]),
    pt('now', 900, [['tech', 610], ['operations_management', 90]]),
  ],
  pivoted: { n: 200, of: 850 },
};

export const LINGUISTICS: TwinGroup = {
  ...blank, level: 'undergrad', program: 'Linguistics', cohort: '*', s0: '*', n: 34,
  years: [
    pt(0, 34, [['smaller_groups', 18], ['no_role_listed', 7], ['further_study', 6]]),
    pt(1, 34, [['smaller_groups', 20], ['no_role_listed', 8]]),
    pt(2, 30, [['smaller_groups', 19]]),
    pt(3, 25, [['smaller_groups', 15], ['teaching', 5]]),
    pt('now', 34, [['smaller_groups', 14], ['teaching', 8]]),
  ],
  seniorityNow: [['mid', 9]],
  pivoted: null, located: null, abroad: null, us: null,
};

export const MBA: TwinGroup = {
  ...blank, level: 'mba', program: 'MBA', cohort: '*', s0: '*', n: 500,
  years: [pt(0, 500, [['consulting', 150], ['finance_accounting', 140]]), pt('now', 500, [['consulting', 120], ['operations_management', 110]])],
};

export const EVERYONE: TwinGroup = {
  ...blank, level: '*', program: '*', cohort: '*', s0: '*', n: 5000,
  years: [pt(0, 5000, [['finance_accounting', 900]]), pt('now', 5000, [['operations_management', 800]])],
  located: 4900, abroad: 600, us: 300,
};

export const META: Meta = {
  generated: '2026-10-27', snapshot: '2025-09', k: { field: 5, named: 10 },
  counts: { profiles: 1, alumni: 1, roles: 1, employers: 1, countries: 1, metros: 1, paths: 1, firstYear: 1995, lastYear: 2024 },
  programs: [
    { level: 'undergrad', program: 'Commerce', discipline: 'business_commerce', n: 1000, river: true },
    { level: 'undergrad', program: 'Linguistics', discipline: 'humanities', n: 34, river: false },
    { level: 'mba', program: 'MBA', discipline: 'business_commerce', n: 500, river: true },
  ],
  cohorts: [],
};

export const TWIN: TwinFile = {
  min_group: 20,
  min_year: 10,
  groups: [
    COMMERCE, COMMERCE_RECENT, COMMERCE_1995, COMMERCE_2000, COMMERCE_2010_ALL, COMMERCE_2010_FIN, COMMERCE_2020,
    COMMERCE_FIN, COMMERCE_STUDY, UG_TECH, LINGUISTICS, MBA, EVERYONE,
  ],
};
