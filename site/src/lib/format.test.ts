import { fmtCompact, fmtInt, fmtPct, oneIn } from './format';

describe('fmtInt', () => {
  it.each([
    [0, '0'], [7, '7'], [1234, '1,234'], [95020, '95,020'], [1234.6, '1,235'], [-1500, '-1,500'],
  ])('%s -> %s', (n, out) => expect(fmtInt(n)).toBe(out));
});

describe('fmtCompact', () => {
  it.each([
    [0, '0'], [820, '820'], [999, '999'], [1000, '1k'], [1350, '1.4k'], [9999, '10k'],
    [10_000, '10k'], [95_020, '95k'], [1_000_000, '1M'], [1_350_000, '1.4M'],
  ])('%s -> %s', (n, out) => expect(fmtCompact(n)).toBe(out));
});

describe('fmtPct', () => {
  it('formats a share', () => expect(fmtPct(39, 100)).toBe('39%'));
  it('rounds', () => expect(fmtPct(410, 1060)).toBe('39%'));
  it('shows <1% rather than 0% for a real but tiny share', () => expect(fmtPct(3, 1000)).toBe('<1%'));
  it('shows 0% for zero', () => expect(fmtPct(0, 10)).toBe('0%'));
  it('supports decimals', () => expect(fmtPct(1, 3, 1)).toBe('33.3%'));
  it.each([[null, 10], [5, null], [5, 0], [undefined, 10], [5, -1]])('missing data (%s/%s) -> em dash', (p, w) =>
    expect(fmtPct(p as number | null, w as number | null)).toBe('—'));
});

describe('oneIn', () => {
  it('rounds to a friendly ratio', () => expect(oneIn(1216, 41489)).toBe('1 in 34'));
  it('handles everyone', () => expect(oneIn(10, 10)).toBe('1 in 1'));
  it.each([[0, 10], [10, 0], [11, 10], [-1, 10]])('refuses misleading input %s/%s', (p, w) => expect(oneIn(p, w)).toBeNull());
});
