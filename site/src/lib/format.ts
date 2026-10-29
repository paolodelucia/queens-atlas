const intFmt = new Intl.NumberFormat('en-CA');

/** 12345 -> "12,345" */
export function fmtInt(n: number): string {
  return intFmt.format(Math.round(n));
}

/** 95020 -> "95k", 1350 -> "1.4k", 820 -> "820" */
export function fmtCompact(n: number): string {
  if (Math.abs(n) >= 1_000_000) return `${trim(n / 1_000_000)}M`;
  if (Math.abs(n) >= 10_000) return `${Math.round(n / 1000)}k`;
  if (Math.abs(n) >= 1000) return `${trim(n / 1000)}k`;
  return String(Math.round(n));
}

function trim(x: number): string {
  return x.toFixed(1).replace(/\.0$/, '');
}

/**
 * Share as a percentage string. Shares under 1% but above 0 read "<1%" rather than "0%",
 * and missing data reads "—".
 */
export function fmtPct(part: number | null | undefined, whole: number | null | undefined, digits = 0): string {
  if (part == null || whole == null || whole <= 0) return '—';
  const pct = (100 * part) / whole;
  if (pct > 0 && pct < 1 && digits === 0) return '<1%';
  return `${pct.toFixed(digits)}%`;
}

/** "1 in 5" style ratio for headline copy; null when it would mislead (share <= 0 or > 1). */
export function oneIn(part: number, whole: number): string | null {
  if (part <= 0 || whole <= 0 || part > whole) return null;
  return `1 in ${Math.round(whole / part)}`;
}
