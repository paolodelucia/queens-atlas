/** A tiny river.json for unit and component tests (numbers are made up, shapes are real). */
import type { FamilyId, RiverFile, RiverLink, RiverSlice, YearPoint } from '../../data/types';

export function makeSlice(over: Partial<RiverSlice> = {}): RiverSlice {
  return {
    level: 'all', program: 'all', cohort: '2010-2014', n: 1000,
    stages: ['s0', 'y3', 'y5', 'y10', 'now'],
    totals: {}, links: [], suppressed: null, details: {}, years: [],
    ...over,
  };
}

const L = (from_stage: RiverLink['from_stage'], from: RiverLink['from'], to_stage: RiverLink['to_stage'], to: RiverLink['to'], n: number): RiverLink =>
  ({ from_stage, from, to_stage, to, n });

const Y = (year: number | 'now', n: number, fields: [FamilyId, number][]): YearPoint => ({ year, n, fields });

/** Commerce, class of 2010–2014: finance shrinks but stays the largest field. */
export const commerce = makeSlice({
  level: 'undergrad', program: 'Commerce', cohort: '2010-2014', n: 1060,
  totals: {
    s0: { finance_accounting: 410, sales_marketing: 177, further_study: 47, no_role_listed: 73, smaller_groups: 20, other: 10, tech: 66 },
    y3: { finance_accounting: 380, sales_marketing: 190, operations_management: 120, no_role_listed: 100, smaller_groups: 40 },
    y5: { finance_accounting: 364, sales_marketing: 199, operations_management: 152, no_role_listed: 111, smaller_groups: 42 },
    y10: { finance_accounting: 359, sales_marketing: 174, operations_management: 174, no_role_listed: 92, smaller_groups: 32 },
    now: { finance_accounting: 348, sales_marketing: 168, operations_management: 168, no_role_listed: 84, smaller_groups: 33 },
  },
  links: [
    L('s0', 'finance_accounting', 'y3', 'finance_accounting', 300),
    L('s0', 'finance_accounting', 'y3', 'operations_management', 25),
    L('s0', 'sales_marketing', 'y3', 'sales_marketing', 120),
    L('s0', 'no_role_listed', 'y3', 'no_role_listed', 40),
    L('y3', 'finance_accounting', 'y5', 'finance_accounting', 320),
    L('y5', 'finance_accounting', 'y10', 'finance_accounting', 269),
    L('y5', 'operations_management', 'y10', 'operations_management', 100),
    L('y10', 'finance_accounting', 'now', 'finance_accounting', 300),
    L('y10', 'sales_marketing', 'now', 'sales_marketing', 140),
  ],
  suppressed: 676,
  details: {
    s0: {
      finance_accounting: {
        employers: [{ name: 'RBC', n: 64 }, { name: 'EY', n: 56 }],
        titles: [{ name: 'Staff Accountant', n: 44 }],
      },
    },
  },
  // Years 0..13 then today; years 12 and 13 only cover the earlier classes (n drops).
  years: [
    Y(0, 1060, [['finance_accounting', 410], ['sales_marketing', 177], ['no_role_listed', 73], ['tech', 66], ['further_study', 47], ['smaller_groups', 20], ['other', 10]]),
    Y(1, 1060, [['finance_accounting', 400], ['sales_marketing', 180], ['no_role_listed', 90], ['tech', 60], ['operations_management', 50]]),
    Y(2, 1060, [['finance_accounting', 390], ['sales_marketing', 185], ['operations_management', 100], ['no_role_listed', 95]]),
    Y(3, 1060, [['finance_accounting', 380], ['sales_marketing', 190], ['operations_management', 120], ['no_role_listed', 100], ['smaller_groups', 40]]),
    Y(4, 1060, [['finance_accounting', 370], ['sales_marketing', 195], ['operations_management', 140], ['no_role_listed', 105]]),
    Y(5, 1060, [['finance_accounting', 364], ['sales_marketing', 199], ['operations_management', 152], ['no_role_listed', 111], ['smaller_groups', 42]]),
    Y(6, 1060, [['finance_accounting', 362], ['sales_marketing', 190], ['operations_management', 160], ['no_role_listed', 100]]),
    Y(7, 1060, [['finance_accounting', 361], ['sales_marketing', 185], ['operations_management', 165], ['no_role_listed', 98]]),
    Y(8, 1060, [['finance_accounting', 360], ['sales_marketing', 180], ['operations_management', 170], ['no_role_listed', 95]]),
    Y(9, 1060, [['finance_accounting', 360], ['sales_marketing', 177], ['operations_management', 172], ['no_role_listed', 93]]),
    Y(10, 1060, [['finance_accounting', 359], ['sales_marketing', 174], ['operations_management', 174], ['no_role_listed', 92], ['smaller_groups', 32]]),
    Y(11, 1060, [['finance_accounting', 358], ['operations_management', 175], ['sales_marketing', 172], ['no_role_listed', 90]]),
    Y(12, 830, [['finance_accounting', 280], ['operations_management', 140], ['sales_marketing', 130]]),
    Y(13, 40, [['finance_accounting', 26], ['operations_management', 20]]),
    Y('now', 1060, [['finance_accounting', 348], ['sales_marketing', 168], ['operations_management', 168], ['no_role_listed', 84], ['smaller_groups', 33]]),
  ],
});

/** Level-wide, all programs: further study is the most common first step. */
export const allAlumni = makeSlice({
  level: 'all', program: 'all', cohort: '2010-2014', n: 13440,
  totals: {
    s0: { further_study: 1492, operations_management: 1409, engineering: 1292, no_role_listed: 982 },
    y3: { operations_management: 1600, engineering: 1300, no_role_listed: 1500 },
    y5: { operations_management: 1792, engineering: 1293, no_role_listed: 1593 },
    y10: { operations_management: 1996, engineering: 1112, no_role_listed: 1404, further_study: 31 },
    now: { operations_management: 2090, engineering: 1044, no_role_listed: 1413 },
  },
  links: [
    L('s0', 'operations_management', 'y3', 'operations_management', 900),
    L('s0', 'further_study', 'y3', 'engineering', 120),
  ],
  suppressed: 1945,
  years: [
    Y(0, 13440, [['further_study', 1492], ['operations_management', 1409], ['engineering', 1292], ['no_role_listed', 982]]),
    Y(5, 13440, [['operations_management', 1792], ['no_role_listed', 1593], ['engineering', 1293]]),
    Y(10, 13440, [['operations_management', 1996], ['no_role_listed', 1404], ['engineering', 1112], ['further_study', 31]]),
    Y('now', 13440, [['operations_management', 2090], ['no_role_listed', 1413], ['engineering', 1044]]),
  ],
});

/** A recent class: only first destination and today. */
export const recent = makeSlice({
  level: 'all', program: 'all', cohort: '2020-2024', n: 11365,
  stages: ['s0', 'now'],
  totals: {
    s0: { tech: 1244, operations_management: 1235, no_role_listed: 916 },
    now: { no_role_listed: 1901, tech: 1275, operations_management: 1179 },
  },
  links: [L('s0', 'tech', 'now', 'tech', 1000), L('s0', 'operations_management', 'now', 'operations_management', 800)],
  suppressed: 650,
  years: [
    Y(0, 11365, [['tech', 1244], ['operations_management', 1235], ['no_role_listed', 916]]),
    Y(1, 11365, [['tech', 1250], ['operations_management', 1200], ['no_role_listed', 1500]]),
    Y(2, 8000, [['tech', 900], ['operations_management', 850]]),
    Y('now', 11365, [['no_role_listed', 1901], ['tech', 1275], ['operations_management', 1179]]),
  ],
});

/** A small program (30–49 people): the "small class" note shows. */
export const smallProgram = makeSlice({
  level: 'graduate', program: 'Analytics', cohort: 'all', n: 42,
  stages: ['s0', 'now'],
  totals: { s0: { tech: 20, finance_accounting: 8 }, now: { tech: 24, finance_accounting: 9 } },
  links: [L('s0', 'tech', 'now', 'tech', 18)],
  years: [
    Y(0, 42, [['tech', 20], ['finance_accounting', 8]]),
    Y(1, 42, [['tech', 22]]),
    Y('now', 42, [['tech', 24], ['finance_accounting', 9]]),
  ],
});

export const river: RiverFile = {
  meta: {
    generated: '2026-10-28', snapshot: '2025-09', k: { field: 5, named: 10 }, min_slice: 30, min_year: 10,
    stages: { s0: 'First destination', y3: 'Year 3', y5: 'Year 5', y10: 'Year 10', y20: 'Year 20', now: 'Today (Sept 2025)' },
    note: '',
  },
  slices: [
    allAlumni,
    recent,
    makeSlice({ level: 'all', program: 'all', cohort: 'all', n: 41489, stages: ['s0', 'now'], totals: { s0: { tech: 3146 }, now: { tech: 3482 } } }),
    makeSlice({ level: 'all', program: 'all', cohort: '1995-1999', n: 6445, stages: ['s0', 'y3', 'y5', 'y10', 'y20', 'now'], totals: { s0: { law: 600 }, y3: { law: 600 }, y5: { law: 600 }, y10: { law: 600 }, y20: { law: 600 }, now: { law: 600 } } }),
    makeSlice({ level: 'undergrad', program: 'all', cohort: 'all', n: 24555, stages: ['s0', 'now'], totals: { s0: { tech: 2000 }, now: { tech: 2100 } } }),
    makeSlice({ level: 'undergrad', program: 'all', cohort: '1995-1999', n: 3914, stages: ['s0', 'y3', 'y5', 'y10', 'y20', 'now'], totals: { s0: { tech: 400 }, y3: { tech: 400 }, y5: { tech: 400 }, y10: { tech: 400 }, y20: { tech: 400 }, now: { tech: 400 } } }),
    makeSlice({ level: 'undergrad', program: 'all', cohort: '2010-2014', n: 9000, totals: { s0: { tech: 900 }, y3: { tech: 900 }, y5: { tech: 900 }, y10: { tech: 900 }, now: { tech: 900 } } }),
    commerce,
    makeSlice({ level: 'undergrad', program: 'Commerce', cohort: 'all', n: 3533, stages: ['s0', 'now'], totals: { s0: { finance_accounting: 1200 }, now: { finance_accounting: 1100 } } }),
    makeSlice({ level: 'undergrad', program: 'Art History', cohort: 'all', n: 183, stages: ['s0', 'now'], totals: { s0: { further_study: 42, operations_management: 27 }, now: { operations_management: 35 } } }),
    makeSlice({ level: 'undergrad', program: 'Art History', cohort: '2010-2014', n: 70, totals: { s0: { smaller_groups: 70 }, y3: { smaller_groups: 70 }, y5: { smaller_groups: 70 }, y10: { smaller_groups: 70 }, now: { smaller_groups: 70 } } }),
    // Has a River as an undergrad program only (the master's program is under 30 people).
    makeSlice({ level: 'undergrad', program: 'Computer Engineering', cohort: 'all', n: 507, stages: ['s0', 'now'], totals: { s0: { engineering: 200, tech: 150 }, now: { engineering: 160, tech: 210 } } }),
    makeSlice({ level: 'undergrad', program: 'Economics', cohort: 'all', n: 1092, stages: ['s0', 'now'], totals: { s0: { finance_accounting: 300 }, now: { finance_accounting: 320 } } }),
    makeSlice({ level: 'undergrad', program: 'Biology', cohort: '2015-2019', n: 120, stages: ['s0', 'y3', 'y5', 'now'], totals: { s0: { research_academia: 40 }, y3: { research_academia: 35 }, y5: { research_academia: 30 }, now: { research_academia: 30 } } }),
    makeSlice({ level: 'graduate', program: 'all', cohort: 'all', n: 9845, stages: ['s0', 'now'], totals: { s0: { research_academia: 2000 }, now: { research_academia: 2000 } } }),
    makeSlice({ level: 'graduate', program: 'Economics', cohort: 'all', n: 406, stages: ['s0', 'now'], totals: { s0: { finance_accounting: 100 }, now: { finance_accounting: 120 } } }),
    smallProgram,
    // A level whose all-programs River exists for all classes only (a link like ?level=medicine).
    makeSlice({ level: 'medicine', program: 'all', cohort: 'all', n: 640, stages: ['s0', 'now'], totals: { s0: { healthcare: 400, further_study: 150 }, now: { healthcare: 560 } } }),
    makeSlice({ level: 'law', program: 'Law', cohort: '2010-2014', n: 837, totals: { s0: { law: 730, no_role_listed: 56, smaller_groups: 51 }, y3: { law: 690 }, y5: { law: 675 }, y10: { law: 662 }, now: { law: 658 } } }),
  ],
};
