"""
Privacy checks for exported JSON (the files under site/public/data/).

Schema-aware k-check: every number that counts people must be >= its floor. Two floors (see
pipeline/sdc.py): K_FIELD (5) for counts of people by career field or state, K_NAMED (10) for
counts behind a named organisation, job title or place. Both rules are deny-by-default:

  - any integer is treated as a people count unless its key is known (from site/src/data/types.ts)
    to hold something else: years, percentages, coordinates, thresholds, or counts of things that
    aren't people. If a new field is not a people count, add its key to NON_COUNT_KEYS (or its
    path to NON_COUNT_PATHS) with a comment.
  - every people count must meet the NAMED floor unless its path is listed in FIELD_COUNT_PATHS.
    A new count field therefore gets the strict floor until someone decides otherwise.

Nothing in here returns or prints the offending strings themselves (they might be personal
data): string checks report JSON paths, and the name/id checks report only how many matched.
"""

import json
import re
from pathlib import Path

import duckdb

from sdc import MAX_NOISE

K_FIELD_FLOOR = 5    # project-wide minimum for field counts; a file may raise its floors, never lower them
K_NAMED_FLOOR = 10   # project-wide minimum for anything naming an employer, title or place
K_FLOOR = K_NAMED_FLOOR

# Keys whose numbers are not people counts (see types.ts).
NON_COUNT_KEYS = {
    "k", "min_slice", "min_group", "min_year",   # thresholds
    "year",                                 # RiverSlice/TwinGroup .years[].year (0..20)
    "lat", "lon",                           # Metro coordinates
    "pct",                                  # ProgramRanking rows, snapshot evidence
    "years",                                # TwinGroup.managerBy[].years (5, 10, ...)
    "from", "to",                           # Meta.cohorts[] year bounds (flows use strings)
    "firstYear", "lastYear",                # Meta.counts
    "costUsd",                              # InsightsFile.labelling
}
# Paths (suffixes, "*" = any key) whose numbers count things other than people.
NON_COUNT_PATHS = [
    ("k", "*"),                             # {field, named} floors (meta.json, river.json meta)
    ("counts", "employers"),                # Meta.counts: distinct employers / countries / metros
    ("counts", "countries"),
    ("counts", "metros"),
    ("labelling", "*"),                     # InsightsFile.labelling: labelled strings, $ cost
]
# People counts published at the FIELD floor: key paths from the file root (string keys only,
# list indices skipped, "*" = any key). Every other people count must meet the NAMED floor.
FIELD_COUNT_PATHS = [
    # river.json
    ("slices", "n"), ("slices", "totals", "*", "*"), ("slices", "links", "n"), ("slices", "suppressed"),
    ("slices", "years", "n"), ("slices", "years", "fields"),
    # twin.json
    ("groups", "n"), ("groups", "years", "n"), ("groups", "years", "fields"), ("groups", "seniorityNow"),
    ("groups", "pivoted", "n"), ("groups", "pivoted", "of"), ("groups", "managerBy", "n"),
    ("groups", "managerBy", "of"), ("groups", "located"), ("groups", "abroad"), ("groups", "us"),
    # diaspora.json: filter sizes and the abroad/US shares (no metro or city is named there)
    ("views", "n"), ("abroad", "byCohort", "*"), ("abroad", "byProgram", "*"),
    # meta.json
    ("programs", "n"), ("counts", "*"),
    # insights.json
    ("rankings", "rows", "n"), ("rankings", "rows", "hits"),
]

# Keys that are people counts even when the value is a float.
COUNT_KEYS = {"n", "suppressed", "abroad", "us", "pivoted", "located", "of", "hits",
              "firstJobInKingston", "stillInKingston", "profiles", "alumni", "paths", "roles"}

FORBIDDEN_KEY_RE = re.compile(r"""^(
      (first|last|full|given|family|person|user|member|profile|display)_?name | name_?(full|first|last)
    | surname
    | person(_?ids?)? | people_?ids? | profile(_?(id|ids|url|link|slug))? | public_?identifier
    | \w*linkedin\w* | li_?id | member_?id | user_?id | urn
    | \w*_url | urls? | href
    | (\w*_)?e_?mails? | (\w*_)?phone\w* | (\w*_)?avatar\w* | (\w*_)?photo\w* | picture | image\w*
    | headline | about | birth\w* | address | street
)$""", re.X)
URL_RE = re.compile(r"https?://|www\.", re.I)
LINKEDIN_RE = re.compile(r"linkedin\.com/(in|pub)/", re.I)
EMAIL_RE = re.compile(r"[\w.+-]+@[\w-]+(\.[\w-]+)+")
LONG_NUMBER_RE = re.compile(r"^\d{7,}$")                       # looks like linkedin_num_id
PROFILE_SLUG_RE = re.compile(r"^[a-z0-9]+(-[a-z0-9]+)*-(?=[a-f0-9]*\d)[a-f0-9]{6,}$", re.I)  # jane-doe-4a2b3c19


# ── Walking ──────────────────────────────────────────────────────────────────

def walk(obj, path=()):
    """Yield (path, leaf) for every leaf value. Paths hold dict keys (str) and list indices (int)."""
    if isinstance(obj, dict):
        for k, v in obj.items():
            yield from walk(v, path + (k,))
    elif isinstance(obj, list):
        for i, v in enumerate(obj):
            yield from walk(v, path + (i,))
    else:
        yield path, obj


def walk_keys(obj, path=()):
    """Yield (path, key) for every dict key."""
    if isinstance(obj, dict):
        for k, v in obj.items():
            yield path + (k,), k
            yield from walk_keys(v, path + (k,))
    elif isinstance(obj, list):
        for i, v in enumerate(obj):
            yield from walk_keys(v, path + (i,))


def path_str(path):
    out = ""
    for p in path:
        out += "[]" if isinstance(p, int) else (("." if out else "") + p)
    return out


def last_key(path):
    return next((p for p in reversed(path) if isinstance(p, str)), None)


def snake(key):
    return re.sub(r"(?<=[a-z0-9])(?=[A-Z])", "_", key).lower()


# ── Counts ───────────────────────────────────────────────────────────────────

def _matches_suffix(path, pattern):
    keys = [p for p in path if isinstance(p, str)]
    return len(keys) >= len(pattern) and all(
        want == "*" or want == got for want, got in zip(pattern, keys[-len(pattern):]))


def is_count(path, value):
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return False
    key = last_key(path)
    if key in NON_COUNT_KEYS or any(_matches_suffix(path, p) for p in NON_COUNT_PATHS):
        return False
    if isinstance(value, float):
        return key in COUNT_KEYS
    return True


def count_paths(data):
    """Every (path, value) the k-check treats as a people count."""
    return [(path, v) for path, v in walk(data) if is_count(path, v)]


def _floors(k):
    """(field, named) from a file's k: {field, named}, a single number (both), or None."""
    if isinstance(k, dict):
        return k.get("field", K_FIELD_FLOOR), k.get("named", K_NAMED_FLOOR)
    if isinstance(k, (tuple, list)):
        return tuple(k)
    if isinstance(k, int) and not isinstance(k, bool):
        return k, k
    return K_FIELD_FLOOR, K_NAMED_FLOOR


def file_k(data):
    """(field floor, named floor) for a file: meta.k (river.json) or top-level k (meta.json),
    else the project floors."""
    k = None
    if isinstance(data, dict):
        meta = data.get("meta")
        k = meta.get("k") if isinstance(meta, dict) else None
        if k is None and "k" in data:
            k = data["k"]
    return _floors(k)


def is_field_count(path):
    keys = tuple(p for p in path if isinstance(p, str))
    return any(len(keys) == len(pat) and all(w == "*" or w == g for w, g in zip(pat, keys))
               for pat in FIELD_COUNT_PATHS)


def floor_for(path, k=None):
    """The floor a people count at `path` must meet, for floors k (as in k_violations)."""
    field, named = _floors(k)
    return field if is_field_count(path) else named


def k_violations(data, k=None):
    """[(path, value)] for people counts under their floor. k: (field, named), a single number
    for both, or None for the file's own. Counts are aggregates, so they may be shown."""
    k = file_k(data) if k is None else _floors(k)
    return [(path_str(p), v) for p, v in count_paths(data) if v < floor_for(p, k)]


def structural_violations(data):
    """Contract rules beyond the floors (types.ts): slice/group/year minimum sizes. Slices,
    groups and years are chosen on their true size; the published (perturbed, sdc.py) n may
    sit up to MAX_NOISE below the threshold."""
    out = []

    def years(items, name, min_year):
        for i, it in enumerate(items):
            for j, p in enumerate(it.get("years") or []):
                if isinstance(p, dict) and p.get("n", 0) < min_year - MAX_NOISE:
                    out.append(f"{name}[{i}].years[{j}].n < min_year")

    if isinstance(data, dict) and isinstance(data.get("slices"), list):
        meta = data.get("meta") or {}
        min_slice = meta.get("min_slice", K_FLOOR)
        out += [f"slices[{i}].n < min_slice" for i, s in enumerate(data["slices"])
                if s.get("n", 0) < min_slice - MAX_NOISE]
        years(data["slices"], "slices", meta.get("min_year", K_FIELD_FLOOR))
    if isinstance(data, dict) and isinstance(data.get("groups"), list) and "min_group" in data:
        out += [f"groups[{i}].n < min_group" for i, g in enumerate(data["groups"])
                if g.get("n", 0) < data["min_group"] - MAX_NOISE]
        years(data["groups"], "groups", data.get("min_year", K_FIELD_FLOOR))
    return out


# ── Keys and strings ─────────────────────────────────────────────────────────

def forbidden_keys(data):
    """Paths of keys that suggest per-person data."""
    return sorted({path_str(p) for p, k in walk_keys(data) if FORBIDDEN_KEY_RE.match(snake(str(k)))})


def string_violations(data):
    """{rule: [paths]} for strings that look like URLs, emails or profile ids. Values not returned."""
    found = {}

    def flag(rule, path):
        found.setdefault(rule, []).append(path_str(path))

    for path, v in walk(data):
        if not isinstance(v, str):
            continue
        if LINKEDIN_RE.search(v):
            flag("linkedin profile url", path)
        if URL_RE.search(v):
            flag("http url", path)
        if EMAIL_RE.search(v):
            flag("email address", path)
        if LONG_NUMBER_RE.match(v.strip()):
            flag("long numeric id", path)
        key = last_key(path) or ""
        if (key == "id" or snake(key).endswith("_id")) and PROFILE_SLUG_RE.match(v.strip()):
            flag("profile-id-like id", path)
    for path, k in walk_keys(data):
        if EMAIL_RE.search(k) or URL_RE.search(k) or LONG_NUMBER_RE.match(k) or PROFILE_SLUG_RE.match(k):
            flag("suspicious key", path)
    return found


def exported_strings(data):
    """Every string value and dict key in a file."""
    out = {v for _, v in walk(data) if isinstance(v, str)}
    out |= {k for _, k in walk_keys(data) if isinstance(k, str)}
    return out


# ── Matching against local per-person data (counts only) ─────────────────────

_NORM = "lower(trim(regexp_replace({x}, '\\s+', ' ', 'g')))"


def _exported_table(con, strings):
    con.execute("CREATE TEMP TABLE exported (s VARCHAR)")
    if strings:
        con.executemany("INSERT INTO exported VALUES (?)", [[s] for s in strings])


def _match_count(strings, people_parquet, select_sql):
    con = duckdb.connect()
    _exported_table(con, strings)
    people = Path(people_parquet).as_posix()
    n = con.execute(f"""
        SELECT count(DISTINCT {_NORM.format(x='e.s')}) FROM exported e
        JOIN ({select_sql.format(people=people)}) p ON {_NORM.format(x='e.s')} = p.v""").fetchone()[0]
    con.close()
    return int(n)


def count_full_name_matches(strings, people_parquet, roles_parquet=None, k=K_FLOOR):
    """(unexplained, explained): how many distinct exported strings equal (case-insensitive,
    whitespace-normalised) the full `name` of a profile whose name has at least two tokens.

    A match is "explained" when the string is also a job title or employer (raw or canonical)
    of at least k distinct people in roles_parquet: then it is an aggregate in its own right
    (e.g. a profile whose name field holds a common job title, or a firm named after a person).
    Only the counts leave DuckDB, never the names."""
    con = duckdb.connect()
    _exported_table(con, strings)
    people = Path(people_parquet).as_posix()
    if roles_parquet is not None and Path(roles_parquet).exists():
        roles = Path(roles_parquet).as_posix()
        common = f"""
            SELECT v FROM (
                SELECT {_NORM.format(x='x')} AS v, person_id FROM (
                    SELECT std AS x, person_id FROM '{roles}' UNION ALL SELECT parent, person_id FROM '{roles}'
                    UNION ALL SELECT title, person_id FROM '{roles}' UNION ALL SELECT company, person_id FROM '{roles}')
                WHERE x IS NOT NULL)
            GROUP BY v HAVING count(DISTINCT person_id) >= {int(k)}"""
    else:
        common = "SELECT NULL::VARCHAR AS v WHERE false"
    unexplained, explained = con.execute(f"""
        WITH e AS (SELECT DISTINCT {_NORM.format(x='s')} AS s FROM exported),
             names AS (SELECT DISTINCT {_NORM.format(x='name')} AS v FROM '{people}'
                       WHERE len(regexp_split_to_array(trim(name), '\\s+')) >= 2),
             common AS ({common})
        SELECT count(*) FILTER (c.v IS NULL), count(*) FILTER (c.v IS NOT NULL)
        FROM e JOIN names n ON n.v = e.s LEFT JOIN common c ON c.v = e.s""").fetchone()
    con.close()
    return int(unexplained), int(explained)


def count_profile_id_matches(strings, people_parquet, min_len=5):
    """How many exported strings equal a profile's person_id or linkedin_num_id."""
    return _match_count(strings, people_parquet, f"""
        SELECT DISTINCT {_NORM.format(x='v0')} AS v FROM (
            SELECT person_id AS v0 FROM '{{people}}' UNION ALL SELECT linkedin_num_id FROM '{{people}}')
        WHERE length(trim(v0)) >= {min_len}""")


def load(path):
    return json.loads(Path(path).read_text(encoding="utf-8"))
