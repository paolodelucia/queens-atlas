"""
sdc.py
------
Statistical disclosure control for every published count of people: the cell-key method
(the "ABS method" used by the Australian Bureau of Statistics for its census tables).

Two suppression floors (the hybrid rule):

  K_FIELD = 5    counts of people by career field or state: River stage totals, links, the
                 year-by-year series and their denominators, Twin outcomes, seniority, pivoted,
                 managerBy, located/abroad/us, program and group sizes, ranking hits.
  K_NAMED = 10   counts behind anything that names an organisation, a job title or a place:
                 employer and title lists (River details, Twin employers/titles/topMetros),
                 everything on the Diaspora map (metros, countries, metro profiles, moves,
                 Kingston), the Insights employer lists and the facts built on them.

A field count says "5 of these 60 Commerce grads were in consulting in year 3"; a named count
says "5 of them were at one firm", which is far closer to pointing at people, so it keeps the
higher floor. Both floors apply to TRUE counts (what gets published at all) and to published
values (perturbed values are clamped at the floor). `perturb()` defaults to the stricter
K_NAMED, so a call site that forgets to choose fails safe: it raises on a 5-9 count instead of
publishing it.

Why noise as well: every published count is >= its floor, but the tables are additive. A
program's "all cohorts" group minus its published cohorts gives the hidden one exactly, and
that can be a single person. Thresholds alone can't stop this; a little noise on every
published cell can.

How
  1. Record keys. Each person gets a fixed, secret record key `rkey`: the first 4 bytes of
     sha256(salt + person_id), an integer in [0, 2^32). rkey / 2^32 is the person's key in
     [0, 1). The salt lives in data/secret/cellkey_salt.txt (gitignored, like all of data/);
     neither the salt nor any rkey is ever published.
  2. Cell keys. The key of a published count is the fractional part of the SUM of its
     contributors' record keys: (sum of rkeys mod 2^32) / 2^32. Exporters therefore compute
     count(*) and sum(rkey) side by side, over each person once per cell. The same set of
     people always gets the same cell key, so the same cell gets the same noise in every file
     and every rerun: publishing a cell twice gives nothing to average away.
  3. Perturbation table. The cell key picks a noise value; the table is zero-mean:

         cell key in   [0.0, 0.4)  [0.4, 0.6)  [0.6, 0.8)  [0.8, 0.9)  [0.9, 1.0)
         noise              0          +1          -1          +2          -2
         probability       40%         20%         20%         10%         10%

     (variance 1.2). Published = max(floor, true + noise), floor = K_FIELD or K_NAMED.
  4. Suppression decisions (the floors, MIN_SLICE, MIN_GROUP, MIN_VIEW, MIN_RANKING) are made
     on TRUE counts, so the rules keep their meaning; only the numbers that get published are
     perturbed. After that, exporters may tidy published numbers using published numbers
     only (e.g. a River link is capped at the published size of its two nodes); a function
     of published values can't reveal more than the values themselves.

What it buys: a differencing attack (total minus published parts) now lands on the hidden
cell plus the sum of 2-6 independent noise draws (sd ~ 1.1 per cell, up to +-2 each). It can
no longer tell 1 person from 0 or 4, and it can't average the noise out by finding the
same cell elsewhere. Integer keys make the modulo exact, so reruns are byte-identical
regardless of summation order.

Changing the salt changes every published number: an attacker holding both versions could
average them. Create it once and keep it.
"""

import hashlib
import secrets
from pathlib import Path

K_FIELD = 5                                # floor for counts of people by career field/state
K_NAMED = 10                               # floor for counts behind a named employer, title or place
K = K_NAMED                                # the strict floor: perturb()'s default, so it fails safe
assert K_FIELD <= K_NAMED
SALT_PATH = Path("data/secret/cellkey_salt.txt")
RKEY_BITS = 32
KEY_MOD = 1 << RKEY_BITS                   # record keys are integers in [0, KEY_MOD)

# (noise, probability in tenths), in the order the bands sit on [0, 1).
# Noise 0 comes first, so a cell whose keys sum to 0 (e.g. test data with rkey = 0) is exact.
PTABLE = ((0, 4), (+1, 2), (-1, 2), (+2, 1), (-2, 1))
MAX_NOISE = max(abs(v) for v, _ in PTABLE)
assert sum(p for _, p in PTABLE) == 10
assert sum(v * p for v, p in PTABLE) == 0, "the perturbation table must be zero-mean"

# Upper edge (exclusive) of each band, in record-key units.
_EDGES = []
_cum = 0
for _v, _p in PTABLE:
    _cum += _p
    _EDGES.append((KEY_MOD * _cum // 10, _v))
del _cum, _v, _p


# ── Salt and record keys ─────────────────────────────────────────────────────

def load_salt(path=SALT_PATH, create=False):
    """The secret salt. With create=True a missing salt file is created (64 hex chars from
    `secrets`); otherwise a missing or empty file raises, so nothing is ever exported
    without one."""
    path = Path(path)
    if not path.exists():
        if not create:
            raise FileNotFoundError(f"cell-key salt not found at {path}; the exporters create it on first run")
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(secrets.token_hex(32) + "\n", encoding="ascii")
        print(f"sdc: created a new cell-key salt at {path} (keep it: a new salt changes every published number)")
    salt = path.read_text(encoding="ascii").strip()
    _check_salt(salt)
    return salt


def _check_salt(salt):
    if not isinstance(salt, str) or len(salt) < 16:
        raise ValueError("a secret salt of at least 16 characters is required")


def rkey(person_id, salt):
    """A person's record key: an integer in [0, KEY_MOD), fixed for (salt, person_id)."""
    _check_salt(salt)
    digest = hashlib.sha256((salt + str(person_id)).encode("utf-8")).digest()
    return int.from_bytes(digest[:RKEY_BITS // 8], "big")


def rkeys(person_ids, salt):
    """Record keys for many people (same order). Computed once per distinct id."""
    _check_salt(salt)
    cache = {}
    out = []
    for pid in person_ids:
        key = cache.get(pid)
        if key is None:
            key = cache[pid] = rkey(pid, salt)
        out.append(key)
    return out


# ── Cell keys and noise ──────────────────────────────────────────────────────

def cell_key(keysum):
    """The cell key in [0, 1) for a cell whose contributors' rkeys sum to `keysum`."""
    return (int(keysum or 0) % KEY_MOD) / KEY_MOD


def noise(keysum):
    """The perturbation for a cell, from the table above."""
    key = int(keysum or 0) % KEY_MOD
    for edge, value in _EDGES:
        if key < edge:
            return value
    raise AssertionError("unreachable: the bands cover [0, KEY_MOD)")


def perturb(n, keysum, k=K):
    """Published value of a true count `n` (>= k) whose contributors' rkeys sum to `keysum`.
    k is the floor that applies to the cell (K_FIELD or K_NAMED; default the stricter K_NAMED).
    Raises on a count under k: whether to publish is decided on the true count, before this."""
    n = int(n)
    if n < k:
        raise ValueError(f"count {n} is under k={k} and must not be published")
    return max(k, n + noise(keysum))


def perturb_ge_k(n, keysum, k=K):
    """perturb() for a scalar that is published only when it reaches k (else None)."""
    if n is None or int(n) < k:
        return None
    return perturb(n, keysum, k)


def publish_parts(parts, k, small=None):
    """Publish a breakdown of one set of people into disjoint parts (e.g. the career families
    of a class in year 5). parts: {label: (true n, keysum)}. Parts under k (true count) are
    folded into one `small` bucket when `small` is given, else dropped; the bucket is published
    only if it reaches k itself. Returns [(label, published n)], largest first, ties by label.
    The River and Career Twin exporters both use this, so a cell they share (same people,
    same parts) is published identically in both files."""
    kept, small_n, small_ks = [], 0, 0
    for label, (n, ks) in parts.items():
        n, ks = int(n), int(ks or 0)
        if n >= k:
            kept.append((label, n, ks))
        else:
            small_n += n
            small_ks += ks
    if small is not None and small_n >= k:
        kept.append((small, small_n, small_ks))
    return sorted(((label, perturb(n, ks, k)) for label, n, ks in kept), key=lambda p: (-p[1], str(p[0])))


def cap(value, *limits):
    """min(value, *limits), ignoring None limits; None stays None. Used to keep published
    parts within their published totals (it only ever looks at published numbers)."""
    if value is None:
        return None
    for lim in limits:
        if lim is not None and lim < value:
            value = lim
    return value
