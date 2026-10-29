"""
01_ingest.py
------------
Streams data/raw/queensdata.json (one big JSON array) and writes normalized
Parquet tables to data/processed/:

    people.parquet      one row per profile
    education.parquet   one row per education entry
    positions.parquet   one row per role (grouped LinkedIn roles are flattened)
    activity.parquet    likes/posts with timestamps decoded from LinkedIn IDs

The file is never fully loaded: ijson yields one profile at a time, and rows are
flushed to Parquet in chunks, so memory stays flat regardless of file size.

    .venv/Scripts/python pipeline/01_ingest.py
"""

import re
import sys
import time
from pathlib import Path

import ijson
import pyarrow as pa
import pyarrow.parquet as pq

RAW = Path("data/raw/queensdata.json")
OUT = Path("data/processed")
CHUNK = 5_000  # profiles per Parquet row group

MONTHS = {m: i for i, m in enumerate(
    ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"], 1)}
QUEENS_RE = re.compile(r"queen'?s univ|smith school of business|queen'?s school of business"
                       r"|queen'?s (faculty of )?law\b", re.I)
# Other universities whose names also match.
NOT_QUEENS_RE = re.compile(r"belfast|charlotte", re.I)
YEARS_RE = re.compile(r"(\d+)\s*(?:yrs?|years?)\b", re.I)
MONTHS_RE = re.compile(r"(\d+)\s*(?:mos?|months?)\b", re.I)


def is_queens_school(school):
    """Queen's University (Kingston), allowing curly apostrophes and faculty names."""
    if not school or not isinstance(school, str):
        return False
    s = school.replace("’", "'").replace("`", "'")
    return bool(QUEENS_RE.search(s)) and not NOT_QUEENS_RE.search(s)


# ── Parsing helpers ──────────────────────────────────────────────────────────

def parse_ym(s):
    """'Nov 2023' -> 202311, '2019' -> 201901 (month unknown), 'Present'/None -> None."""
    if not s or not isinstance(s, str):
        return None
    s = s.strip()
    parts = s.split()
    if len(parts) == 2 and parts[0][:3].lower() in MONTHS and parts[1].isdigit():
        return int(parts[1]) * 100 + MONTHS[parts[0][:3].lower()]
    if s.isdigit() and len(s) == 4:
        return int(s) * 100 + 1
    return None


def month_known(s):
    return bool(s) and isinstance(s, str) and len(s.split()) == 2


def parse_duration_months(s):
    """'1 year 9 months' -> 21, also inside longer text ('Jul 2023 - Present 1 year 7 months').
    Returns None when there is nothing to parse."""
    if not s or not isinstance(s, str):
        return None
    y, m = YEARS_RE.search(s), MONTHS_RE.search(s)
    if not y and not m:
        return None
    return int(y.group(1) if y else 0) * 12 + int(m.group(1) if m else 0)


def duration_from_meta(meta):
    """Grouped roles carry 'Jan 2025 - Present 9 months' in `meta`."""
    if not meta:
        return None
    tail = re.sub(r"^.*?(Present|\d{4})\s*", "", meta.split(" - ", 1)[-1])
    return parse_duration_months(tail)


def linkedin_id_to_ts_ms(activity_id):
    """LinkedIn activity/post IDs are snowflake-style: top 41 bits = ms since epoch."""
    try:
        return int(activity_id) >> 22
    except (TypeError, ValueError):
        return None


def to_int(x):
    try:
        return int(x)
    except (TypeError, ValueError):
        return None


# ── Row builders ─────────────────────────────────────────────────────────────

def person_row(p):
    cc = p.get("current_company") or {}
    return {
        "person_id": p.get("id"),
        "linkedin_num_id": p.get("linkedin_num_id"),
        "name": p.get("name"),
        "headline": p.get("position"),
        "about": p.get("about"),
        "city": p.get("city"),
        "location": p.get("location"),
        "country_code": p.get("country_code"),
        "connections": to_int(p.get("connections")),
        "followers": to_int(p.get("followers")),
        "current_company": p.get("current_company_name") or cc.get("name"),
        "current_company_id": p.get("current_company_company_id") or cc.get("company_id"),
        "current_title": cc.get("title"),
        "default_avatar": p.get("default_avatar"),
        "memorialized": p.get("memorialized_account"),
        "recommendations_count": to_int(p.get("recommendations_count")),
        "educations_details": p.get("educations_details"),
        "n_experience": len(p.get("experience") or []),
        "n_education": len(p.get("education") or []),
        "n_certifications": len(p.get("certifications") or []),
        "n_languages": len(p.get("languages") or []),
        "languages": [l.get("title") for l in (p.get("languages") or []) if isinstance(l, dict)],
    }


def education_rows(p):
    for i, e in enumerate(p.get("education") or []):
        if not isinstance(e, dict):
            continue
        school = e.get("title")
        yield {
            "person_id": p.get("id"),
            "idx": i,
            "school": school,
            "is_queens": is_queens_school(school),
            "degree": e.get("degree"),
            "field": e.get("field"),
            "start_year": to_int(e.get("start_year")),
            "end_year": to_int(e.get("end_year")),
            "description": e.get("description"),
        }


def position_rows(p):
    """Flatten experience. A grouped entry (several roles at one company) has
    `positions`; otherwise the experience entry itself is the role."""
    pid = p.get("id")
    for i, e in enumerate(p.get("experience") or []):
        if not isinstance(e, dict):
            continue
        company = e.get("company")
        company_id = e.get("company_id")
        roles = e.get("positions") or [e]
        grouped = bool(e.get("positions"))
        for j, r in enumerate(roles):
            if not isinstance(r, dict):
                continue
            start_raw, end_raw = r.get("start_date"), r.get("end_date")
            # Single roles carry "Jul 2023 - Present 1 year 7 months" in `duration` and the clean
            # "1 year 7 months" in `duration_short`.
            dur = (duration_from_meta(r.get("meta")) if grouped
                   else parse_duration_months(r.get("duration_short") or r.get("duration")))
            yield {
                "person_id": pid,
                "exp_idx": i,
                "pos_idx": j,
                "grouped": grouped,
                "company": company,
                "company_id": company_id,
                "title": r.get("title"),
                "location": r.get("location") or e.get("location"),
                "description": r.get("description"),
                "start_raw": start_raw,
                "end_raw": end_raw,
                "start_ym": parse_ym(start_raw),
                "end_ym": parse_ym(end_raw),
                "start_month_known": month_known(start_raw),
                "is_current": isinstance(end_raw, str) and end_raw.strip().lower() == "present",
                "duration_months": dur,
            }


def activity_rows(p):
    pid = p.get("id")
    for kind in ("activity", "posts"):
        for a in p.get(kind) or []:
            if not isinstance(a, dict):
                continue
            aid = a.get("id")
            # posts[].id is a short slug; the real ID lives in the link
            if kind == "posts" or not (aid and str(aid).isdigit()):
                m = re.search(r"activity-(\d{15,})", a.get("link") or "")
                aid = m.group(1) if m else None
            yield {
                "person_id": pid,
                "kind": kind,
                "activity_id": aid,
                "ts_ms": linkedin_id_to_ts_ms(aid),
                "interaction": a.get("interaction") or a.get("attribution"),
            }



# Explicit schemas so an all-null column in the first chunk can't lock in a bad type.
S, I, B = pa.string(), pa.int64(), pa.bool_()
SCHEMAS = {
    "people": pa.schema([
        ("person_id", S), ("linkedin_num_id", S), ("name", S), ("headline", S), ("about", S),
        ("city", S), ("location", S), ("country_code", S), ("connections", I), ("followers", I),
        ("current_company", S), ("current_company_id", S), ("current_title", S),
        ("default_avatar", B), ("memorialized", B), ("recommendations_count", I),
        ("educations_details", S), ("n_experience", I), ("n_education", I),
        ("n_certifications", I), ("n_languages", I), ("languages", pa.list_(S))]),
    "education": pa.schema([
        ("person_id", S), ("idx", I), ("school", S), ("is_queens", B), ("degree", S),
        ("field", S), ("start_year", I), ("end_year", I), ("description", S)]),
    "positions": pa.schema([
        ("person_id", S), ("exp_idx", I), ("pos_idx", I), ("grouped", B), ("company", S),
        ("company_id", S), ("title", S), ("location", S), ("description", S),
        ("start_raw", S), ("end_raw", S), ("start_ym", I), ("end_ym", I),
        ("start_month_known", B), ("is_current", B), ("duration_months", I)]),
    "activity": pa.schema([
        ("person_id", S), ("kind", S), ("activity_id", S), ("ts_ms", I), ("interaction", S)]),
}

# ── Writer ───────────────────────────────────────────────────────────────────

class ChunkedWriter:
    def __init__(self, path, schema):
        self.path, self.schema, self.rows = path, schema, []
        self.writer = pq.ParquetWriter(path, schema, compression="zstd")

    def add(self, rows):
        self.rows.extend(rows)

    def flush(self):
        if self.rows:
            self.writer.write_table(pa.Table.from_pylist(self.rows, schema=self.schema))
            self.rows = []

    def close(self):
        self.flush()
        self.writer.close()


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    writers = {name: ChunkedWriter(OUT / f"{name}.parquet", schema) for name, schema in SCHEMAS.items()}
    builders = {"people": lambda p: [person_row(p)], "education": education_rows,
                "positions": position_rows, "activity": activity_rows}

    t0, n, bad = time.time(), 0, 0
    with RAW.open("rb") as f:
        for p in ijson.items(f, "item", use_float=True):
            if not isinstance(p, dict) or not p.get("id"):
                bad += 1
                continue
            for name, build in builders.items():
                writers[name].add(build(p))
            n += 1
            if n % CHUNK == 0:
                for w in writers.values():
                    w.flush()
                print(f"\r{n:,} profiles  {time.time() - t0:5.0f}s", end="", file=sys.stderr)
    for w in writers.values():
        w.close()
    print(f"\nDone: {n:,} profiles ({bad} skipped) in {time.time() - t0:.0f}s", file=sys.stderr)


if __name__ == "__main__":
    main()
