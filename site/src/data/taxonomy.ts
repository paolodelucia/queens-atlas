/**
 * Display names and colours for the pipeline's ids. One place, so every view says
 * "Finance & accounting" and paints it the same colour.
 *
 * Colour: 17 families is far past the 8 hues a categorical palette can keep apart, so families
 * roll up into 8 sectors and the sector carries the colour (CSS vars --sector-1..8, the
 * validated categorical palette, light and dark steps). Families are always direct-labelled,
 * so colour is never the only way to tell them apart. Non-job states use neutral greys.
 */
import type { CohortId, DiasporaCohortId, FamilyId, LevelId, SeniorityId, StageId } from './types';

export type SectorId =
  | 'tech' | 'finance' | 'health' | 'education' | 'creative' | 'public' | 'management' | 'engineering'
  | 'neutral';

export interface SectorInfo { id: SectorId; label: string; color: string }

/** Fixed order = palette slot order (the order is part of the CVD-safety check). */
export const SECTORS: SectorInfo[] = [
  { id: 'tech', label: 'Tech', color: 'var(--sector-1)' },
  { id: 'finance', label: 'Finance & consulting', color: 'var(--sector-2)' },
  { id: 'health', label: 'Health & research', color: 'var(--sector-3)' },
  { id: 'education', label: 'Teaching & study', color: 'var(--sector-4)' },
  { id: 'creative', label: 'Media & marketing', color: 'var(--sector-5)' },
  { id: 'public', label: 'Law & public service', color: 'var(--sector-6)' },
  { id: 'management', label: 'Management & ventures', color: 'var(--sector-7)' },
  { id: 'engineering', label: 'Engineering & trades', color: 'var(--sector-8)' },
  { id: 'neutral', label: 'Other / unknown', color: 'var(--sector-neutral)' },
];

export interface FamilyInfo {
  id: FamilyId;
  label: string;        // "Finance & accounting"
  short: string;        // fits a 90px node label: "Finance"
  sector: SectorId;
  description: string;  // tooltip / legend help
  isJob: boolean;       // false for further study / no role listed / smaller groups
}

export const FAMILIES: FamilyInfo[] = [
  { id: 'tech', label: 'Tech', short: 'Tech', sector: 'tech', isJob: true,
    description: 'Software, data & AI, IT, product and design' },
  { id: 'finance_accounting', label: 'Finance & accounting', short: 'Finance', sector: 'finance', isJob: true,
    description: 'Banking, investing, corporate finance, audit and tax' },
  { id: 'consulting', label: 'Consulting & strategy', short: 'Consulting', sector: 'finance', isJob: true,
    description: 'Management consulting and strategy roles' },
  { id: 'healthcare', label: 'Healthcare', short: 'Healthcare', sector: 'health', isJob: true,
    description: 'Physicians, nurses, therapists, pharmacists and other clinicians' },
  { id: 'research_academia', label: 'Research & academia', short: 'Research', sector: 'health', isJob: true,
    description: 'Scientists, researchers, professors and postdocs' },
  { id: 'teaching', label: 'Teaching', short: 'Teaching', sector: 'education', isJob: true,
    description: 'K-12 teachers, early-childhood educators and principals' },
  { id: 'further_study', label: 'Further study', short: 'Study', sector: 'education', isJob: false,
    description: 'Started another degree (law school, medicine, a master’s, …)' },
  { id: 'sales_marketing', label: 'Sales & marketing', short: 'Sales/Mktg', sector: 'creative', isJob: true,
    description: 'Sales, business development, marketing and communications' },
  { id: 'arts_media', label: 'Arts & media', short: 'Arts/Media', sector: 'creative', isJob: true,
    description: 'Writers, journalists, artists, musicians and film' },
  { id: 'law', label: 'Law', short: 'Law', sector: 'public', isJob: true,
    description: 'Lawyers, articling students, legal counsel' },
  { id: 'government_policy', label: 'Government & policy', short: 'Government', sector: 'public', isJob: true,
    description: 'Public servants, policy analysts, politicians, military and police' },
  { id: 'nonprofit_community', label: 'Nonprofit & community', short: 'Nonprofit', sector: 'public', isJob: true,
    description: 'Social work, counselling and nonprofit programs' },
  { id: 'operations_management', label: 'Operations & management', short: 'Ops/Mgmt', sector: 'management', isJob: true,
    description: 'Operations, project management, HR, admin and general management' },
  { id: 'founder', label: 'Founders', short: 'Founder', sector: 'management', isJob: true,
    description: 'Founder, co-founder or owner of their own venture' },
  { id: 'engineering', label: 'Engineering', short: 'Engineering', sector: 'engineering', isJob: true,
    description: 'Mechanical, civil, electrical, chemical, mining … engineering practice' },
  { id: 'service_trades', label: 'Service, trades & sport', short: 'Service', sector: 'engineering', isJob: true,
    description: 'Retail, hospitality, trades, athletics' },
  { id: 'other', label: 'Other roles', short: 'Other', sector: 'neutral', isJob: true,
    description: 'Roles that fit no family above' },
  { id: 'smaller_groups', label: 'Smaller groups', short: 'Small fields', sector: 'neutral', isJob: false,
    description: 'Fields with fewer than 5 people at this point, combined to protect privacy' },
  { id: 'no_role_listed', label: 'No role listed', short: 'No role', sector: 'neutral', isJob: false,
    description: 'Nothing on their profile for this point in time' },
];

export const FAMILY = Object.fromEntries(FAMILIES.map((f) => [f.id, f])) as Record<FamilyId, FamilyInfo>;
export const SECTOR = Object.fromEntries(SECTORS.map((s) => [s.id, s])) as Record<SectorId, SectorInfo>;

/** Stable display order for families (sector order, then as listed). */
export const FAMILY_ORDER: FamilyId[] = FAMILIES.map((f) => f.id);

export function familyColor(id: FamilyId): string {
  return SECTOR[FAMILY[id]?.sector ?? 'neutral'].color;
}

export const LEVELS: { id: LevelId; label: string; short: string }[] = [
  { id: 'all', label: 'All alumni', short: 'All' },
  { id: 'undergrad', label: 'Undergraduate', short: 'Undergrad' },
  { id: 'graduate', label: 'Master’s & PhD', short: 'Grad' },
  { id: 'mba', label: 'MBA', short: 'MBA' },
  { id: 'law', label: 'Law (JD)', short: 'Law' },
  { id: 'medicine', label: 'Medicine (MD)', short: 'MD' },
];
export const LEVEL = Object.fromEntries(LEVELS.map((l) => [l.id, l])) as Record<LevelId, (typeof LEVELS)[number]>;

/** River/Twin cohorts: 'all' first, then the five-year bands oldest first. */
export const COHORTS: { id: CohortId; label: string }[] = [
  { id: 'all', label: 'Classes of 1995–2024' },
  { id: '1995-1999', label: 'Class of 1995–1999' },
  { id: '2000-2004', label: 'Class of 2000–2004' },
  { id: '2005-2009', label: 'Class of 2005–2009' },
  { id: '2010-2014', label: 'Class of 2010–2014' },
  { id: '2015-2019', label: 'Class of 2015–2019' },
  { id: '2020-2024', label: 'Class of 2020–2024' },
];

/** Diaspora cohorts: as COHORTS plus everyone before 1995. 'all' also includes 2025 grads. */
export const DIASPORA_COHORTS: { id: DiasporaCohortId; label: string }[] = [
  { id: 'all', label: 'All classes' },
  { id: 'pre-1995', label: 'Before 1995' },
  { id: '1995-1999', label: '1995–1999' },
  { id: '2000-2004', label: '2000–2004' },
  { id: '2005-2009', label: '2005–2009' },
  { id: '2010-2014', label: '2010–2014' },
  { id: '2015-2019', label: '2015–2019' },
  { id: '2020-2024', label: '2020–2024' },
];

/** Sankey columns, in order. */
export const STAGES: Record<StageId, { label: string; short: string }> = {
  s0: { label: 'First destination', short: 'First' },
  y3: { label: 'Year 3', short: 'Yr 3' },
  y5: { label: 'Year 5', short: 'Yr 5' },
  y10: { label: 'Year 10', short: 'Yr 10' },
  y20: { label: 'Year 20', short: 'Yr 20' },
  now: { label: 'Today', short: 'Today' },
};
export const STAGE_ORDER: StageId[] = ['s0', 'y3', 'y5', 'y10', 'y20', 'now'];

/** Label for a point of a trajectory (YearPoint.year): 0 -> "First destination", 7 -> "Year 7". */
export function yearLabel(year: number | 'now', short = false): string {
  if (year === 'now') return 'Today';
  if (year === 0) return short ? 'First' : 'First destination';
  return short ? `Yr ${year}` : `Year ${year}`;
}

export const SENIORITY: Record<SeniorityId, string> = {
  intern: 'Intern / student', entry: 'Entry level', mid: 'Mid level', senior: 'Senior IC',
  manager: 'Manager', director: 'Director', vp: 'VP', executive: 'Executive / partner', unknown: 'Unknown',
};
export const SENIORITY_ORDER: SeniorityId[] =
  ['intern', 'entry', 'mid', 'senior', 'manager', 'director', 'vp', 'executive', 'unknown'];

export const DISCIPLINES: Record<string, string> = {
  engineering: 'Engineering', computing: 'Computing', business_commerce: 'Business',
  economics: 'Economics', law: 'Law', health_medicine_nursing: 'Health & medicine',
  life_sciences: 'Life sciences', physical_sciences_math: 'Physical sciences & math',
  social_sciences: 'Social sciences', humanities: 'Humanities', education: 'Education',
  fine_performing_arts: 'Fine & performing arts', public_policy_admin: 'Public policy', other: 'Other',
};

/** Country names for the ISO2 codes that show up; falls back to Intl.DisplayNames. */
const regionNames = typeof Intl !== 'undefined' && 'DisplayNames' in Intl
  ? new Intl.DisplayNames(['en'], { type: 'region' }) : null;
export function countryName(iso2: string): string {
  if (!iso2) return 'Unknown';
  try { return regionNames?.of(iso2.toUpperCase()) ?? iso2; } catch { return iso2; }
}
