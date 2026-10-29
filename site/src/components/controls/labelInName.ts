/**
 * WCAG 2.5.3 (label in name) helpers. Speech-input users say what they see ("click ’95–’04"), so
 * a control's accessible name must contain its visible text. These follow axe-core's
 * label-content-name-mismatch check: words are compared in order, ignoring case, punctuation,
 * accents and anything in parentheses.
 */

/** Removes "(…)" groups, innermost first, as axe-core does. */
function dropParentheticals(s: string): string {
  let prev: string;
  let out = s;
  do {
    prev = out;
    out = out.replace(/\([^()]*\)/g, '');
  } while (out !== prev);
  return out;
}

function words(s: string): string[] {
  return dropParentheticals(s.normalize('NFKD'))
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .split(' ')
    .filter(Boolean);
}

/**
 * True when `name` contains the words of `visible`, in order and adjacent ("Class of 2005–2015"
 * contains "2005–2015"; "Classes of 1995–2004" doesn't contain "’95–’04", and "Law (JD)" doesn't
 * contain "JD" because parentheses are ignored). Visible text with no words (a symbol such as "%")
 * is contained in any name.
 */
export function labelInName(visible: string, name: string): boolean {
  const v = words(visible);
  if (!v.length) return true;
  const n = words(name);
  for (let i = 0; i + v.length <= n.length; i++) {
    if (v.every((w, j) => n[i + j] === w)) return true;
  }
  return false;
}

/**
 * Accessible name and description for a control whose visible text is `visible` and whose fuller
 * form (if any) is `full`. The fuller form is the name only when it contains the visible text;
 * otherwise the visible text is the name and the fuller form becomes the description, so what
 * the screen shows is always what the name says.
 */
export function nameAndDescription(visible: string, full?: string): { name: string; description?: string } {
  if (!full || full === visible) return { name: visible };
  return labelInName(visible, full) ? { name: full } : { name: visible, description: full };
}
