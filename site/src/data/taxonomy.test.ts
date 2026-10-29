import { COHORTS, FAMILIES, FAMILY, FAMILY_ORDER, LEVELS, SECTOR, SECTORS, SENIORITY, SENIORITY_ORDER, countryName, familyColor } from './taxonomy';

describe('taxonomy', () => {
  it('has unique family ids, each in a known sector', () => {
    expect(new Set(FAMILIES.map((f) => f.id)).size).toBe(FAMILIES.length);
    for (const f of FAMILIES) expect(SECTOR[f.sector], f.id).toBeDefined();
  });

  it('keeps short labels short enough for a node label', () => {
    for (const f of FAMILIES) expect(f.short.length, f.id).toBeLessThanOrEqual(12);
  });

  it('uses at most 8 colour sectors plus neutral (the validated palette size)', () => {
    expect(SECTORS.filter((s) => s.id !== 'neutral')).toHaveLength(8);
    expect(new Set(SECTORS.map((s) => s.color)).size).toBe(SECTORS.length);
  });

  it('marks only real jobs as jobs', () => {
    expect(FAMILY.further_study.isJob).toBe(false);
    expect(FAMILY.no_role_listed.isJob).toBe(false);
    expect(FAMILY.smaller_groups.isJob).toBe(false);
    expect(FAMILY.tech.isJob).toBe(true);
  });

  it('colours unknown ids neutrally instead of crashing', () => {
    expect(familyColor('tech')).toBe('var(--sector-1)');
    expect(familyColor('not_a_family' as never)).toBe('var(--sector-neutral)');
  });

  it('has a family order covering every family once', () => {
    expect([...FAMILY_ORDER].sort()).toEqual(FAMILIES.map((f) => f.id).sort());
  });

  it('covers every seniority level in order', () => {
    expect([...SENIORITY_ORDER].sort()).toEqual(Object.keys(SENIORITY).sort());
  });

  it('starts levels with "all" and cohorts with the full range', () => {
    expect(LEVELS[0].id).toBe('all');
    expect(COHORTS[0].id).toBe('all');
  });

  it('names countries and tolerates junk', () => {
    expect(countryName('CA')).toBe('Canada');
    expect(countryName('us')).toBe('United States');
    expect(countryName('')).toBe('Unknown');
    expect(countryName('ZZZZ')).toBe('ZZZZ');
  });
});
