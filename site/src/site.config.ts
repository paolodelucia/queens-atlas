/**
 * Site-wide settings the owner may want to change without touching components.
 *
 * The site is called "Atlas". "Queen’s" is the university's trademark, so it appears only
 * descriptively (who the data is about: "Queen’s grads"), never as part of the site's name.
 *
 * The footer and Method page show a credit line only when `author.name` is set (empty fields
 * are simply left out). The footer's "Remove my profile" and "Contact" links appear only when
 * `contactEmail` is set.
 */
export const SITE = {
  name: 'Atlas',
  /** Descriptive one-liner (uses "Queen’s" descriptively, not as a brand). */
  tagline: 'Where Queen’s grads actually end up',
  author: {
    name: 'Paolo De Lucia',
    url: 'https://paolodelucia.com',  // the name links here
    x: '',               // X handle without @
    github: '',          // e.g. 'https://github.com/…' (repo is private today)
  },
  /** Where removal requests and questions go (footer mailto: links). Empty hides those links. */
  contactEmail: 'paolo.delucia@queensu.ca',
  /**
   * One line used wherever the privacy model is summarised. The model: groups under 5 people are
   * hidden (under 10 for anything naming an employer, job title or place) and every count is
   * lightly perturbed.
   */
  privacyLine: 'Groups only: small groups are hidden and every number is nudged slightly, so no one can be picked out.',
} as const;
