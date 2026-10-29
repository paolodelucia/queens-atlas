"""
08_export_site.py
-----------------
Builds every published data file except river.json (07_export_river.py):

  site/public/data/meta.json       counts, program list, cohorts
  site/public/data/diaspora.json   where alumni live now; first-job city -> home city moves
  site/public/data/twin.json       "career twin" outcome groups at several levels of detail
  site/public/data/insights.json   leaderboards, headline facts, snapshot & labelling summary

and copies river.json alongside them. The shapes are the contract in site/src/data/types.ts.

Privacy: two floors (sdc.py). Counts of people by career field or state (Twin outcomes and
year series, seniority, pivoted, managerBy, located/abroad/us, group and program sizes,
ranking hits) are published from K_FIELD (5) people up; counts behind a named organisation,
job title or place (employer and title lists, topMetros, everything on the Diaspora map, the
Insights employer lists) from K_NAMED (10) up. Smaller counts are dropped (lists) or published
as null (scalars, never 0); those decisions are made on true counts. Every count that is
published is then perturbed with the cell-key method (sdc.py): each query computes count(*)
together with sum(rkey) over the same people, and sdc.perturb turns the pair into the
published number (never below its floor). The same people always get the same noise, in
every file. Parts are capped at their published totals (published numbers only), and
percentages are computed from published numbers. The script re-scans its own output and
refuses to finish if it finds a count under its floor.

Meta's headline counts (profiles, alumni, roles, paths) are single global totals and stay
exact: no published table splits them into parts, so they can't be differenced.

    .venv/Scripts/python pipeline/08_export_site.py
"""

import json
import re
import shutil
import unicodedata
from datetime import date
from pathlib import Path

import duckdb
import pandas as pd
import sys

import sdc

# DuckDB prints box-drawing tables; a redirected stdout on Windows defaults to cp1252.
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")


K_FIELD = sdc.K_FIELD   # counts of people by career field / state
K_NAMED = sdc.K_NAMED   # counts behind a named employer, title or place
PROC, DERIVED, LABELS = "data/processed", "data/derived", "data/labels"
SITE = Path("site/public/data")
RIVER = Path("data/aggregates/river.json")
SNAPSHOT_YEAR, SNAPSHOT_YM = 2025, 202509

# Size thresholds are about meaningfulness, not privacy (the floors above are): easy to change.
MIN_VIEW = 50        # smallest diaspora filter / program ranking worth publishing
MIN_GROUP = 20       # smallest career-twin group (owner chose 20, Oct 2026)
MIN_YEAR = 10        # a year of a twin group's trajectory is listed once this many members reached it
MIN_RANKING = 100    # programs must have this many grads to enter a leaderboard
TOP_N = 6

LEVEL_GROUPS = ("undergrad", "graduate", "mba", "law", "medicine")
# Five-year graduating classes (the same bands as the River); '*' is all of 1995-2024.
TWIN_COHORTS = [("1995-1999", 1995, 1999), ("2000-2004", 2000, 2004), ("2005-2009", 2005, 2009),
                ("2010-2014", 2010, 2014), ("2015-2019", 2015, 2019), ("2020-2024", 2020, 2024)]
# Diaspora also covers earlier grads (where people live doesn't need early-career data).
# 2025 grads (and anyone without a dated degree) are counted only in "all".
DIASPORA_COHORTS = [("pre-1995", 1900, 1994)] + TWIN_COHORTS
# Points of each twin group's trajectory: 0 = first destination, N = June of grad_year + N
# (06_paths.py), then today. The River has every year; here every year would make twin.json
# ~4.1 MB raw, so it keeps these (~2.5 MB), which include all of the River's Sankey years.
TWIN_YEARS = (0, 1, 2, 3, 5, 7, 10, 15, 20)
SMALL = "smaller_groups"
MANAGER_LEVELS = ("manager", "director", "vp", "executive")
MANAGER_YEARS = (1, 3, 5, 7, 10, 15)
NON_JOB = ("further_study", "no_role_listed")
PROVINCE_ABBR = {"Ontario": "Ont.", "Quebec": "Que.", "Québec": "Que.", "British Columbia": "B.C.",
                 "Alberta": "Alta.", "Manitoba": "Man.", "Saskatchewan": "Sask.", "Nova Scotia": "N.S.",
                 "New Brunswick": "N.B."}


def cohort_case(col, cohorts):
    whens = " ".join(f"WHEN {col} BETWEEN {lo} AND {hi} THEN '{cid}'" for cid, lo, hi in cohorts)
    return f"CASE {whens} END"


def slug(*parts):
    s = "-".join(p for p in parts if p)
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")


def one(con, sql):
    """First row of a query (DuckDB 2 relations have no fetchone)."""
    return con.sql(sql).fetchall()[0]


def ranked(items, key=lambda x: x[1], name=lambda x: x[0]):
    """Largest published count first, ties by name: deterministic whatever the row order."""
    return sorted(items, key=lambda x: (-key(x), str(name(x))))


def named(rows, limit=TOP_N):
    """rows of (name, true n, keysum) -> top `limit` [{name, n}] by published n (true n >= K_NAMED)."""
    pub = [(name, sdc.perturb(n, ks, K_NAMED)) for name, n, ks in rows if n >= K_NAMED]
    return [{"name": name, "n": n} for name, n in ranked(pub)[:limit]]


def series_col(year):
    """paths column holding the family at a point of the trajectory (as in 07_export_river)."""
    return "s0_family" if year == 0 else "now_family" if year == "now" else f"y{year}_family"


def year_point(year, parts, total):
    """One point of a trajectory, from {family: (true n, keysum)} over the members who have
    reached it: {year, n, fields}, or None under MIN_YEAR. Same rule as 07_export_river.year_series."""
    reached = sum(int(n) for n, _ in parts.values())
    if reached < max(MIN_YEAR, K_FIELD):
        return None
    n = sdc.cap(sdc.perturb(reached, sum(int(ks) for _, ks in parts.values()), K_FIELD), total)
    return {"year": year, "n": n,
            "fields": [[fam, sdc.cap(v, n)] for fam, v in sdc.publish_parts(parts, K_FIELD, SMALL)]}


# ── Setup ────────────────────────────────────────────────────────────────────

def connect(salt):
    con = duckdb.connect()
    con.sql("CREATE MACRO norm(x) AS lower(trim(replace(replace(x, chr(9), ' '), chr(10), ' ')))")
    # Every person's secret sdc record key; joined onto each per-person table below.
    ids = [r[0] for r in con.sql(f"SELECT DISTINCT person_id FROM '{PROC}/people.parquet' ORDER BY 1").fetchall()]
    keys = pd.DataFrame({"person_id": ids, "rkey": pd.array(sdc.rkeys(ids, salt), dtype="int64")})
    con.register("rkeys_df", keys)
    con.sql("CREATE TABLE rkeys AS SELECT * FROM rkeys_df")
    con.unregister("rkeys_df")
    # Geocoded place strings (04_label.py places task), keyed the same way the labeller grouped them.
    con.sql(f"""
        CREATE TABLE places AS
        SELECT k, l.level, nullif(l.city, '') AS city, nullif(l.metro, '') AS metro,
               nullif(l.region, '') AS region, nullif(upper(l.country), '') AS country, l.lat, l.lon, it.uses
        FROM (SELECT norm(text) AS k, min(id) AS id, sum(uses) AS uses
              FROM '{LABELS}/places_items.parquet' GROUP BY 1) it
        JOIN '{LABELS}/places.parquet' l ON l.i = it.id""")
    # A metro is a (metro name, country) pair; its region is the most common one among its places.
    con.sql("""
        CREATE TABLE metro_places AS
        SELECT *, metro || '|' || country AS metro_key FROM places
        WHERE level IN ('city', 'metro') AND metro IS NOT NULL AND country IS NOT NULL""")
    con.sql(f"""
        CREATE TABLE credentials AS SELECT * FROM '{DERIVED}/credentials.parquet'""")
    con.sql(f"""
        CREATE TABLE paths AS
        SELECT p.*, k.rkey FROM '{DERIVED}/paths.parquet' p JOIN rkeys k USING (person_id)""")
    # Alumni = profiles with a Queen's education entry. Home = where the profile says they live.
    con.sql(f"""
        CREATE TABLE alumni AS
        WITH first_cred AS (
          SELECT person_id, min(end_year) FILTER (level <> 'certificate') AS grad_year
          FROM credentials GROUP BY 1)
        SELECT p.person_id, f.grad_year, pl.country AS home_country,
               mp.metro_key AS home_metro, k.rkey
        FROM '{PROC}/people.parquet' p
        JOIN first_cred f USING (person_id)
        JOIN rkeys k USING (person_id)
        LEFT JOIN places pl ON pl.k = norm(p.city)
        LEFT JOIN metro_places mp ON mp.k = norm(p.city)""")
    n_paths = one(con, f"SELECT count(*) FROM '{DERIVED}/paths.parquet'")[0]
    assert one(con, "SELECT count(*) FROM paths")[0] == n_paths, "every path needs a record key"
    return con


def build_metros(con):
    rows = con.sql(f"""
        WITH home AS (SELECT home_metro AS metro_key, count(*) AS n, sum(rkey) AS ks FROM alumni
                      WHERE home_metro IS NOT NULL GROUP BY 1 HAVING count(*) >= {K_NAMED}),
        -- a metro's region is the most common one among its places, then the most used, then by
        -- name (mode() broke ties at random, so reruns could differ)
        regions AS (
          SELECT metro_key, first(region ORDER BY c DESC, u DESC, region) AS region
          FROM (SELECT metro_key, region, count(*) AS c, sum(uses) AS u FROM metro_places
                WHERE region IS NOT NULL GROUP BY 1, 2)
          GROUP BY 1),
        coords AS (
          SELECT metro_key, any_value(metro) AS metro, any_value(country) AS country,
                 -- the metro's own city if it was geocoded, else a use-weighted centre
                 coalesce(arg_max(lat, uses) FILTER (lower(city) = lower(metro)),
                          sum(lat * uses) / sum(uses)) AS lat,
                 coalesce(arg_max(lon, uses) FILTER (lower(city) = lower(metro)),
                          sum(lon * uses) / sum(uses)) AS lon
          FROM metro_places GROUP BY 1)
        SELECT c.metro_key, c.metro, coalesce(r.region, '') AS region, c.country, c.lat, c.lon, h.n, h.ks
        FROM home h JOIN coords c USING (metro_key) LEFT JOIN regions r USING (metro_key)""").fetchall()
    rows = [(*r[:6], sdc.perturb(r[6], r[7], K_NAMED)) for r in rows]
    metros, ids = [], {}
    for key, name, region, country, lat, lon, n in ranked(rows, key=lambda r: r[6]):
        mid = slug(name, region, country)
        while mid in ids.values():           # same name+region+country but different key: keep ids unique
            mid += "-2"
        ids[key] = mid
        metros.append({"id": mid, "name": name, "region": region, "country": country,
                       "lat": round(lat, 4), "lon": round(lon, 4), "n": n})
    return metros, ids


# ── Diaspora ─────────────────────────────────────────────────────────────────

COUNTRY_SHORT = {"GB": "UK", "US": "US", "AE": "UAE"}


def metro_labels(metros, metro_ids):
    """metro_key -> display name. Names that exist twice ("London", "Hamilton") get a qualifier:
    the province for Canadian metros ("London, Ont."), the country otherwise ("London, UK")."""
    by_id = {m["id"]: m for m in metros}
    names = [m["name"] for m in metros]
    out = {}
    for key, mid in metro_ids.items():
        m = by_id[mid]
        if names.count(m["name"]) == 1:
            out[key] = m["name"]
        elif m["country"] == "CA":
            out[key] = f"{m['name']}, {PROVINCE_ABBR.get(m['region'], m['region'])}"
        else:
            out[key] = f"{m['name']}, {COUNTRY_SHORT.get(m['country'], m['country'])}"
    return out


def build_diaspora(con, metros, metro_ids):
    con.sql(f"""
        CREATE TEMP TABLE pop AS
        -- one row per (person, filter group) they belong to
        WITH base AS (
          SELECT a.*, {cohort_case('a.grad_year', DIASPORA_COHORTS)} AS cohort FROM alumni a),
        programs AS (
          SELECT DISTINCT c.person_id, {sql_level_group('c.level')} AS level, c.program
          FROM credentials c WHERE c.program IS NOT NULL AND c.level <> 'certificate')
        SELECT b.*, 'all' AS level, 'all' AS program FROM base b
        UNION ALL
        SELECT DISTINCT ON (b.person_id, p.level) b.*, p.level, 'all' FROM base b
          JOIN programs p USING (person_id) WHERE p.level IS NOT NULL
        UNION ALL
        SELECT b.*, p.level, p.program FROM base b
          JOIN programs p USING (person_id) WHERE p.level IS NOT NULL""")

    groups = con.sql(f"""
        SELECT level, program, coalesce(cohort, 'all') AS cohort, count(*) AS n, sum(rkey) AS ks
        FROM pop WHERE home_country IS NOT NULL
        GROUP BY GROUPING SETS ((level, program, cohort), (level, program))
        HAVING count(*) >= {MIN_VIEW} AND (cohort IS NOT NULL OR GROUPING(cohort) = 1)""").fetchall()
    groups = [(lv, pr, co, n, sdc.perturb(n, ks, K_FIELD)) for lv, pr, co, n, ks in groups]

    def counts(col):
        out = {}
        for level, program, cohort, key, n, ks in con.sql(f"""
                SELECT level, program, coalesce(cohort, 'all'), {col}, count(*) AS n, sum(rkey) AS ks FROM pop
                WHERE {col} IS NOT NULL
                GROUP BY GROUPING SETS ((level, program, cohort, {col}), (level, program, {col}))
                HAVING count(*) >= {K_NAMED} AND (cohort IS NOT NULL OR GROUPING(cohort) = 1)""").fetchall():
            out.setdefault((level, program, cohort), []).append((key, sdc.perturb(n, ks, K_NAMED)))
        return {k: ranked(v) for k, v in out.items()}

    by_metro, by_country = counts("home_metro"), counts("home_country")
    views = []
    for level, program, cohort, _, n in sorted(groups, key=lambda g: (g[0] != "all", g[1] != "all", -g[4],
                                                                        g[0], g[1], g[2])):
        key = (level, program, cohort)
        views.append({
            "level": level, "program": program, "cohort": cohort, "n": n,
            "metros": [[metro_ids[m], sdc.cap(c, n)] for m, c in by_metro.get(key, []) if m in metro_ids],
            "countries": [[c, sdc.cap(cnt, n)] for c, cnt in by_country.get(key, [])],
        })

    # Per-metro profile of everyone living there (first credential's path for job info).
    detail = {mid: {"families": [], "employers": [], "programs": [], "cohorts": []} for mid in metro_ids.values()}

    def per_metro(sql):
        """{metro id: [(*labels, published n)]} for rows (metro_key, *labels, n, keysum) with
        n >= K_NAMED: everything here is tied to a named place."""
        out = {}
        for key, *rest in con.sql(sql).fetchall():
            *labels, n, ks = rest
            if key in metro_ids and n >= K_NAMED:
                out.setdefault(metro_ids[key], []).append((*labels, sdc.perturb(n, ks, K_NAMED)))
        return out

    lived = """
        FROM alumni a JOIN paths p ON p.person_id = a.person_id AND p.cred_rank = 1
        WHERE a.home_metro IS NOT NULL"""
    for mid, rows in per_metro(f"""
            SELECT a.home_metro, p.now_family, count(*) n, sum(a.rkey) {lived} AND p.now_family NOT IN {NON_JOB}
            GROUP BY 1, 2 HAVING n >= {K_NAMED}""").items():
        detail[mid]["families"] = [[fam, n] for fam, n in ranked(rows)]
    for mid, rows in per_metro(f"""
            SELECT a.home_metro, p.now_employer, count(*) n, sum(a.rkey) {lived} AND p.now_employer IS NOT NULL
            GROUP BY 1, 2 HAVING n >= {K_NAMED}""").items():
        detail[mid]["employers"] = [{"name": emp, "n": n} for emp, n in ranked(rows)[:TOP_N]]
    for mid, rows in per_metro(f"""
            SELECT home_metro, level, program, count(*) n, sum(rkey) FROM pop
            WHERE home_metro IS NOT NULL AND program <> 'all'
            GROUP BY 1, 2, 3 HAVING n >= {K_NAMED}""").items():
        top = ranked(rows, key=lambda r: r[2], name=lambda r: f"{r[0]}|{r[1]}")[:TOP_N]
        detail[mid]["programs"] = [{"level": lv, "program": pr, "n": n} for lv, pr, n in top]
    order = [c for c, _, _ in DIASPORA_COHORTS]
    for mid, rows in per_metro(f"""
            SELECT home_metro, cohort, count(*) n, sum(rkey) FROM pop
            WHERE level = 'all' AND home_metro IS NOT NULL AND cohort IS NOT NULL
            GROUP BY 1, 2 HAVING n >= {K_NAMED}""").items():
        detail[mid]["cohorts"] = sorted(([c, n] for c, n in rows), key=lambda c: order.index(c[0]))

    # First-job metro -> home metro, for people whose first destination was a located job.
    flows = [{"from": metro_ids[a], "to": metro_ids[b], "n": sdc.perturb(n, ks, K_NAMED)} for a, b, n, ks in con.sql(f"""
        SELECT fm.metro_key, a.home_metro, count(*) n, sum(a.rkey)
        FROM paths p JOIN alumni a USING (person_id)
        JOIN metro_places fm ON fm.k = norm(p.s0_location)
        WHERE p.cred_rank = 1 AND a.home_metro IS NOT NULL AND fm.metro_key <> a.home_metro
        GROUP BY 1, 2 HAVING n >= {K_NAMED}""").fetchall()
        if a in metro_ids and b in metro_ids]
    flows.sort(key=lambda f: (-f["n"], f["from"], f["to"]))

    def abroad_rows(where, group_cols):
        """Rows of (*group values, n, abroad, us), published: abroad/us null under K_FIELD (they
        count people by where they live, at country level, like Twin's) and capped at their
        published totals."""
        out = []
        for *grp, n, ks, ab, ks_ab, us, ks_us in con.sql(f"""
                SELECT {group_cols}, count(*) n, sum(rkey),
                       count(*) FILTER (home_country <> 'CA') abroad, sum(rkey) FILTER (home_country <> 'CA'),
                       count(*) FILTER (home_country = 'US') us, sum(rkey) FILTER (home_country = 'US')
                FROM pop WHERE home_country IS NOT NULL AND {where}
                GROUP BY {group_cols} HAVING n >= {MIN_VIEW}""").fetchall():
            n = sdc.perturb(n, ks, K_FIELD)
            ab = sdc.cap(sdc.perturb_ge_k(ab, ks_ab, K_FIELD), n)
            out.append((*grp, n, ab, sdc.cap(sdc.perturb_ge_k(us, ks_us, K_FIELD), ab)))
        return out

    by_cohort = [{"cohort": c, "n": n, "abroad": ab, "us": us}
                 for c, n, ab, us in abroad_rows("level = 'all' AND cohort IS NOT NULL", "cohort")]
    by_cohort.sort(key=lambda r: order.index(r["cohort"]))
    _, n, ab, us = abroad_rows("level = 'all'", "level")[0]
    by_cohort.append({"cohort": "all", "n": n, "abroad": ab, "us": us})
    by_program = [{"level": lv, "program": pr, "n": n, "abroad": ab, "us": us}
                  for lv, pr, n, ab, us in abroad_rows("program <> 'all'", "level, program")]
    by_program.sort(key=lambda r: (-r["n"], r["level"], r["program"]))

    # Of alumni whose first job was in Kingston (and whose home metro is known): where now.
    # Under-k totals are null, not 0 (0 would read as "nobody").
    kingston_key = next((k for k, v in metro_ids.items() if v.startswith("kingston-ontario")), None)
    first_k = con.sql(f"""
        SELECT a.home_metro, count(*) n, sum(a.rkey) ks
        FROM paths p JOIN alumni a USING (person_id) JOIN metro_places fm ON fm.k = norm(p.s0_location)
        WHERE p.cred_rank = 1 AND a.home_metro IS NOT NULL AND fm.metro_key = '{kingston_key}'
        GROUP BY 1""").fetchall()
    first_job = sdc.perturb_ge_k(sum(n for _, n, _ in first_k), sum(ks for _, _, ks in first_k), K_NAMED)
    stayed = next(((n, ks) for key, n, ks in first_k if key == kingston_key), (0, 0))
    label = metro_labels(metros, metro_ids)
    elsewhere = [(label[key], sdc.cap(sdc.perturb(n, ks, K_NAMED), first_job)) for key, n, ks in first_k
                 if key != kingston_key and key in metro_ids and n >= K_NAMED]
    kingston = {
        "firstJobInKingston": first_job,
        "stillInKingston": sdc.cap(sdc.perturb_ge_k(*stayed, K_NAMED), first_job),
        "nowElsewhere": [{"name": name, "n": n} for name, n in ranked(elsewhere)[:TOP_N]],
    }
    return {"metros": metros, "views": views, "metroDetail": detail, "flows": flows,
            "abroad": {"byCohort": by_cohort, "byProgram": by_program}, "kingston": kingston}


def sql_level_group(col):
    return (f"CASE {col} WHEN 'bachelor' THEN 'undergrad' WHEN 'master' THEN 'graduate' "
            f"WHEN 'phd' THEN 'graduate' WHEN 'mba' THEN 'mba' WHEN 'jd' THEN 'law' "
            f"WHEN 'md' THEN 'medicine' END")


# ── Career twin ──────────────────────────────────────────────────────────────

def build_twin(con, metros, metro_ids):
    # Manager-or-above roles (non-side, non-student). For a bachelor's, the clock starts in final
    # year like the first-job rule in 06_paths.py, so a "Manager" summer job doesn't count;
    # grad/professional students may already have been managers.
    con.sql(f"""
        CREATE TEMP TABLE mgr_roles AS
        SELECT person_id, start_ym FROM '{DERIVED}/roles.parquet'
        WHERE lvl IN {MANAGER_LEVELS} AND NOT side AND NOT coalesce(stu, false) AND start_ym IS NOT NULL""")
    con.sql(f"""
        CREATE TEMP TABLE twin_base AS
        SELECT p.*, {cohort_case('p.grad_year', TWIN_COHORTS)} AS cohort,
               p.s0_family AS y0_family,   -- year 0 of the trajectory, groupable apart from the s0 key
               a.home_country, a.home_metro,
               (SELECT min(r.start_ym) FROM mgr_roles r
                WHERE r.person_id = p.person_id
                  AND (r.start_ym >= (p.grad_year - 1) * 100 + 9
                       OR p.level_group NOT IN ('undergrad', 'undergrad_or_unknown'))) AS mgr_ym
        FROM paths p LEFT JOIN alumni a USING (person_id)
        WHERE p.grad_year BETWEEN 1995 AND 2024""")
    # Members: everyone (first credential), per level (everyone with a credential at that level,
    # their first one there) and per program (each person once per program). River uses the
    # same three definitions, so a cell published in both files is the same set of people.
    con.sql(f"""
        CREATE TEMP TABLE members AS
        SELECT * REPLACE ('*' AS level_group), '*' AS program_key FROM twin_base WHERE cred_rank = 1
        UNION ALL
        SELECT * EXCLUDE (rk), '*' FROM (
          SELECT *, row_number() OVER (PARTITION BY person_id, level_group ORDER BY cred_rank) rk
          FROM twin_base WHERE level_group IN {LEVEL_GROUPS}) WHERE rk = 1
        UNION ALL
        SELECT * EXCLUDE (rk), program FROM (
          SELECT *, row_number() OVER (PARTITION BY person_id, level_group, program ORDER BY cred_rank) rk
          FROM twin_base WHERE level_group IN {LEVEL_GROUPS} AND program IS NOT NULL) WHERE rk = 1""")
    # Every group is a program (or '*') with or without a cohort and/or a first destination.
    sets = [("cohort", "s0_family"), ("s0_family",), ("cohort",), ()]
    key_cols = "level_group, program_key, coalesce(cohort, '*') AS cohort, coalesce(s0_family, '*') AS s0"
    keep = "(cohort IS NOT NULL OR GROUPING(cohort) = 1) AND (s0_family IS NOT NULL OR GROUPING(s0_family) = 1)"

    def grouped(select, where="true", extra_group=(), having=f"count(*) >= {K_FIELD}"):
        grouping = ", ".join("(" + ", ".join(("level_group", "program_key") + s + tuple(extra_group)) + ")"
                             for s in sets)
        sql = f"""
            SELECT {key_cols}{', ' + select if select else ''}
            FROM members WHERE {where}
            GROUP BY GROUPING SETS ({grouping})
            HAVING {keep} AND {having}"""
        return con.sql(sql).fetchall()

    groups = {}
    for lv, pr, co, s0, n, ks in grouped("count(*), sum(rkey)", having=f"count(*) >= {MIN_GROUP}"):
        groups[(lv, pr, co, s0)] = {
            "level": lv, "program": pr, "cohort": co, "s0": s0, "n": sdc.perturb(n, ks, K_FIELD), "years": [],
            "seniorityNow": [], "employersNow": [], "titlesNow": [], "employersFirst": [],
            "pivoted": None, "managerBy": [], "located": None, "abroad": None, "us": None,
            "topMetros": [],
        }

    def add_counts(col, target, where="true", limit=None, as_named=False, total=lambda g: g["n"], k=K_FIELD):
        """Per group: [value, published n] (or {name, n} when as_named) for values held by >= k
        members, largest published first, each capped at the group's published `total`."""
        found = {}
        for lv, pr, co, s0, v, n, ks in grouped(f"{col} AS v, count(*) AS n, sum(rkey) AS ks",
                                                 where=f"{col} IS NOT NULL AND {where}", extra_group=(col,),
                                                 having=f"count(*) >= {k}"):
            g = groups.get((lv, pr, co, s0))
            if g is not None:
                found.setdefault((lv, pr, co, s0), []).append((v, sdc.perturb(n, ks, k)))
        for key, rows in found.items():
            g = groups[key]
            rows = ranked(rows)[:limit]
            target(g).extend({"name": v, "n": sdc.cap(n, total(g))} if as_named else [v, sdc.cap(n, total(g))]
                             for v, n in rows)

    # The trajectory, year by year: the same rule (and, for the same people, the same numbers)
    # as the River's `years`. Families are listed for every member, folded under K_FIELD.
    for year in (*TWIN_YEARS, "now"):
        col = "y0_family" if year == 0 else series_col(year)
        parts = {}
        for lv, pr, co, s0, fam, n, ks in grouped(f"{col} AS v, count(*), sum(rkey)", where=f"{col} IS NOT NULL",
                                                   extra_group=(col,), having="true"):
            if (lv, pr, co, s0) in groups:
                parts.setdefault((lv, pr, co, s0), {})[fam] = (n, ks)
        for key, fams in parts.items():
            point = year_point(year, fams, groups[key]["n"])
            if point is not None:
                groups[key]["years"].append(point)
    add_counts("now_seniority", lambda g: g["seniorityNow"], where="now_seniority <> 'unknown'")
    # Employers, titles and places are named: K_NAMED.
    add_counts("now_employer", lambda g: g["employersNow"], limit=TOP_N, as_named=True, k=K_NAMED)
    add_counts("now_title", lambda g: g["titlesNow"], limit=TOP_N, as_named=True, k=K_NAMED)
    add_counts("s0_employer", lambda g: g["employersFirst"], limit=TOP_N, as_named=True, k=K_NAMED)

    jobs = ", ".join(f"'{f}'" for f in NON_JOB)
    for lv, pr, co, s0, of, ks_of, n, ks_n in grouped(
            "count(*) AS of_, sum(rkey), count(*) FILTER (now_family <> s0_family) AS piv, "
            "sum(rkey) FILTER (now_family <> s0_family)",
            where=f"s0_family NOT IN ({jobs}) AND now_family NOT IN ({jobs})", having="true"):
        g = groups.get((lv, pr, co, s0))
        if g is not None and of >= K_FIELD:
            of = sdc.cap(sdc.perturb(of, ks_of, K_FIELD), g["n"])
            g["pivoted"] = {"n": sdc.cap(sdc.perturb_ge_k(n, ks_n, K_FIELD), of), "of": of}

    for years in MANAGER_YEARS:
        hit = f"mgr_ym // 100 - grad_year <= {years}"
        for lv, pr, co, s0, of, ks_of, n, ks_n in grouped(
                f"count(*) AS of_, sum(rkey), count(*) FILTER ({hit}) AS hit, sum(rkey) FILTER ({hit})",
                where=f"grad_year + {years} <= {SNAPSHOT_YEAR}", having="true"):
            g = groups.get((lv, pr, co, s0))
            if g is not None and of >= K_FIELD:
                of = sdc.cap(sdc.perturb(of, ks_of, K_FIELD), g["n"])
                g["managerBy"].append({"years": years, "n": sdc.cap(sdc.perturb_ge_k(n, ks_n, K_FIELD), of),
                                       "of": of})

    for lv, pr, co, s0, n, ks, ab, ks_ab, us, ks_us in grouped(
            "count(*) AS n_, sum(rkey), count(*) FILTER (home_country <> 'CA') ab, "
            "sum(rkey) FILTER (home_country <> 'CA'), count(*) FILTER (home_country = 'US') us, "
            "sum(rkey) FILTER (home_country = 'US')",
            where="home_country IS NOT NULL", having="true"):
        g = groups.get((lv, pr, co, s0))
        if g is not None:
            located = sdc.cap(sdc.perturb_ge_k(n, ks, K_FIELD), g["n"])     # null (not 0) under the floor
            abroad = sdc.cap(sdc.perturb_ge_k(ab, ks_ab, K_FIELD), located)
            g.update(located=located, abroad=abroad, us=sdc.cap(sdc.perturb_ge_k(us, ks_us, K_FIELD), abroad))
    id_to_name = metro_labels(metros, metro_ids)
    add_counts("home_metro", lambda g: g["topMetros"], limit=TOP_N, as_named=True, k=K_NAMED,
               total=lambda g: g["located"] if g["located"] is not None else g["n"])
    for g in groups.values():
        g["topMetros"] = [{"name": id_to_name.get(m["name"], m["name"]), "n": m["n"]}
                          for m in g["topMetros"] if m["name"] in id_to_name]

    out = sorted(groups.values(), key=lambda g: (g["level"] != "*", g["program"] != "*", g["cohort"] != "*",
                                                 g["s0"] != "*", g["level"], g["program"], g["cohort"], g["s0"]))
    return {"min_group": MIN_GROUP, "min_year": MIN_YEAR, "groups": out}


# ── Insights ─────────────────────────────────────────────────────────────────

def build_insights(con, diaspora):
    first_emp = named(con.sql(f"""
        SELECT s0_employer, count(*) n, sum(rkey) FROM paths
        WHERE cred_rank = 1 AND grad_year BETWEEN 2015 AND 2024 AND s0_employer IS NOT NULL
        GROUP BY 1 ORDER BY n DESC, 1 LIMIT 40""").fetchall(), 15)
    # Distinct alumni who ever worked there: each person's key counts once per employer.
    top_emp = named(con.sql(f"""
        SELECT d.parent, count(*) n, sum(k.rkey) FROM (
            SELECT DISTINCT r.parent, r.person_id FROM '{DERIVED}/roles.parquet' r
            WHERE r.parent IS NOT NULL AND NOT r.side AND r.person_id IN (SELECT person_id FROM alumni)) d
        JOIN rkeys k USING (person_id)
        GROUP BY 1 ORDER BY n DESC, 1 LIMIT 40""").fetchall(), 20)

    # Program leaderboards over first-credential-per-program grads 1995-2024 (same members as Twin).
    # Who qualifies is decided on true counts; the published n, hits and pct (and so the order)
    # come from perturbed counts.
    metrics = [
        ("tech_now", "Working in tech today", "now_family = 'tech'"),
        ("finance_now", "In finance & accounting today", "now_family = 'finance_accounting'"),
        ("consulting_now", "In consulting today", "now_family = 'consulting'"),
        ("founder_now", "Running their own venture today", "now_family = 'founder'"),
        ("study_first", "Went straight on to more study", "s0_family = 'further_study'"),
        ("abroad_now", "Living outside Canada", "home_country IS NOT NULL AND home_country <> 'CA'"),
        ("us_now", "Living in the United States", "home_country = 'US'"),
    ]
    rankings = []
    for mid, label, cond in metrics:
        denom = "home_country IS NOT NULL" if "home_country" in cond else "true"
        rows = []
        for lv, pr, n, ks, h, ks_h in con.sql(f"""
                SELECT level_group, program_key, count(*) n, sum(rkey),
                       count(*) FILTER ({cond}) hits, sum(rkey) FILTER ({cond})
                FROM members WHERE program_key <> '*' AND {denom}
                GROUP BY 1, 2 HAVING n >= {MIN_RANKING} AND hits >= {K_FIELD}""").fetchall():
            n = sdc.perturb(n, ks, K_FIELD)
            h = sdc.cap(sdc.perturb(h, ks_h, K_FIELD), n)
            rows.append({"level": lv, "program": pr, "n": n, "hits": h, "pct": round(100 * h / n, 1)})
        rows.sort(key=lambda r: (-r["hits"] / r["n"], -r["n"], r["level"], r["program"]))
        rankings.append({"id": mid, "label": label, "rows": rows[:10]})

    facts = []

    def share(where_members, cond, denom_cond="true"):
        """Published (n, hits) over members, or (None, None) when the true n < MIN_VIEW or
        true hits < K_FIELD (facts count people by career field)."""
        n, ks, h, ks_h = one(con, f"""
            SELECT count(*), sum(rkey), count(*) FILTER ({cond}), sum(rkey) FILTER ({cond}) FROM members
            WHERE {where_members} AND {denom_cond}""")
        if n < MIN_VIEW or h < K_FIELD:
            return None, None
        n = sdc.perturb(n, ks, K_FIELD)
        return n, sdc.cap(sdc.perturb(h, ks_h, K_FIELD), n)

    def add_fact(fid, n, h, text, detail, link, style="pct"):
        """n, h: published counts (None: not publishable). `detail` is a template on n and h."""
        if n is None or h is None or n < MIN_VIEW:
            return
        value = f"{round(100 * h / n)}%" if style == "pct" else f"1 in {round(n / h)}"
        facts.append({"id": fid, "value": value, "text": text, "detail": detail.format(n=n, h=h), "link": link})

    everyone = next(r for r in diaspora["abroad"]["byCohort"] if r["cohort"] == "all")
    add_fact("abroad", everyone["n"], everyone["abroad"], "of Queen’s alumni now live outside Canada.",
             "{h:,} of {n:,} alumni with a known location.", "/diaspora", "pct")
    n, h = share("level_group = 'undergrad' AND program_key = 'Commerce' AND cohort = '2010-2014'",
                 "s0_family = 'finance_accounting'")
    add_fact("commerce_finance", n, h, "of Commerce grads from the classes of 2010–2014 started their careers in "
             "finance or accounting.", "{h:,} of {n:,} grads.",
             "/river?level=undergrad&program=Commerce&cohort=2010-2014", "pct")
    n, h = share("level_group = 'law' AND program_key = 'Law' AND y10_family IS NOT NULL", "y10_family = 'law'")
    add_fact("law_stays", n, h, "of Queen’s Law grads still work in law ten years after graduating.",
             "{h:,} of {n:,} JD grads who are 10+ years out.", "/river?level=law&program=Law", "pct")
    n, h = share("level_group = '*' AND s0_family = 'consulting' AND y10_family IS NOT NULL",
                 "y10_family NOT IN ('consulting', 'no_role_listed')")
    add_fact("consulting_exit", n, h, "of grads who started in consulting had moved into another field by year 10.",
             "{h:,} of {n:,} who started in consulting and are 10+ years out.",
             "/twin?level=undergrad&program=Commerce&year=2010&first=consulting", "pct")
    n, h = share("level_group = 'undergrad' AND program_key = 'Life Sciences'", "s0_family = 'further_study'")
    add_fact("lifesci_study", n, h, "of Life Sciences grads went straight on to another degree.",
             "{h:,} of {n:,} grads.", "/river?level=undergrad&program=Life+Sciences&cohort=all", "pct")
    # Classes 10+ years out: the four bands of 1995-2014.
    eng = ("level_group = 'undergrad' AND program_key LIKE '%Engineering%' "
           "AND cohort IN ('1995-1999', '2000-2004', '2005-2009', '2010-2014')")
    n, h = share(eng, "now_family = 'tech'")
    add_fact("eng_to_tech", n, h, "of engineering grads from the classes of 1995–2014 work in tech today.",
             "{h:,} of {n:,} engineering grads.", "/river?level=undergrad&program=Mechanical+Engineering", "pct")
    n, h = share("level_group = '*'", "now_family = 'founder'", f"now_family NOT IN ({', '.join(repr(f) for f in NON_JOB)})")
    add_fact("founders", n, h, "Queen’s grads with a job today runs a company they founded or own.",
             "{h:,} of {n:,} alumni with a current role.", "/river?level=mba&program=MBA", "ratio")
    if first_emp:
        top = first_emp[0]["name"]
        n, ks, h, ks_h = one(con, f"""
            SELECT count(*), sum(rkey), count(*) FILTER (s0_fn IN ('research_science', 'academia')),
                   sum(rkey) FILTER (s0_fn IN ('research_science', 'academia'))
            FROM paths WHERE cred_rank = 1 AND grad_year BETWEEN 2015 AND 2024 AND s0_employer = $${top}$$""")
        what = ""
        if n >= MIN_VIEW and h >= K_NAMED:     # a share of one named employer's grads: named floor
            n, h = sdc.perturb(n, ks, K_NAMED), sdc.perturb(h, ks_h, K_NAMED)   # n: the same people as first_emp[0]
            h = sdc.cap(h, n)
            if h / n >= 0.5:
                what = f", mostly in research and teaching roles ({round(100 * h / n)}%)"
        facts.append({"id": "top_first_employer", "value": top,
                      "text": "is the most common first employer for the classes of 2015–2024.",
                      "detail": f"{first_emp[0]['n']:,} grads started there{what}.", "link": "/river"})
    # Geography: the biggest hub, and the biggest hub outside Canada next to Canadian cities it outranks.
    metros = diaspora["metros"]
    located = everyone["n"]
    if metros and located >= MIN_VIEW:
        hub = metros[0]
        facts.append({"id": "top_metro", "value": f"1 in {round(located / hub['n'])}",
                      "text": f"Queen’s alumni live in the {hub['name']} area.",
                      "detail": f"{hub['n']:,} of {located:,} alumni with a known location.", "link": "/diaspora"})
    foreign = next((m for m in metros if m["country"] != "CA"), None)
    if foreign:
        names = [m["name"] for m in metros]
        # "London" alone is ambiguous next to London, England: add the province when a name repeats.
        label = lambda m: (f"{m['name']}, {PROVINCE_ABBR.get(m['region'], m['region'])}"
                           if names.count(m["name"]) > 1 else m["name"])
        smaller = [label(m) for m in metros if m["country"] == "CA" and m["n"] < foreign["n"]][:2]
        if smaller:
            facts.append({"id": "top_foreign_metro", "value": foreign["name"],
                          # "London, Ont." already ends the sentence
                          "text": f"has more Queen’s alumni ({foreign['n']:,}) than {' or '.join(smaller)}".rstrip(".") + ".",
                          "detail": f"{foreign['n']:,} alumni: the largest community outside Canada.",
                          "link": "/diaspora"})
    k = diaspora["kingston"]
    if k["firstJobInKingston"] is not None and k["firstJobInKingston"] >= MIN_VIEW and k["stillInKingston"] is not None:
        facts.append({"id": "kingston", "value": f"{round(100 * k['stillInKingston'] / k['firstJobInKingston'])}%",
                      "text": "of grads whose first job was in Kingston still live there.",
                      "detail": f"{k['stillInKingston']:,} of {k['firstJobInKingston']:,}.", "link": "/diaspora"})

    present = con.sql(f"""
        WITH r AS (SELECT (start_ym // 100) * 12 + (start_ym % 100 - 1) + duration_months - 1 AS m
                   FROM '{PROC}/positions.parquet'
                   WHERE is_current AND start_month_known AND duration_months IS NOT NULL)
        SELECT printf('%d-%02d', m // 12, m % 12 + 1) AS month, round(100.0 * count(*) / sum(count(*)) OVER (), 1)
        FROM r GROUP BY m ORDER BY count(*) DESC LIMIT 4""").fetchall()
    present_n = one(con, f"""
        SELECT count(*) FROM '{PROC}/positions.parquet'
        WHERE is_current AND start_month_known AND duration_months IS NOT NULL""")[0]
    newest = one(con, f"""
        SELECT strftime(make_timestamp(max(ts_ms) * 1000), '%Y-%m-%dT%H:%MZ')
        FROM '{PROC}/activity.parquet' WHERE ts_ms IS NOT NULL""")[0]

    batches = json.loads(Path(LABELS, "batches.json").read_text())
    places_cost = 5.34   # synchronous run, see data/labels/places.log
    pilot_cost = 0.91
    counts = {t: one(con, f"SELECT count(*) FROM '{LABELS}/{t}.parquet'")[0]
              for t in ("titles", "companies", "fields", "places")}
    return {
        "firstEmployers": first_emp,
        "topEmployers": top_emp,
        "rankings": rankings,
        "facts": facts,
        "snapshot": {
            "currentRolesImplying": [{"month": m, "pct": float(p)} for m, p in present],
            "currentRolesSample": int(present_n),
            "newestActivity": newest,
            # base36 ms timestamp in the export's file name ("mg5xrzjc..."), see README
            "exportFileTimestamp": "2025-09-30T02:26Z",
            "asOf": "2025-09-30",
        },
        "labelling": {"titles": counts["titles"], "employers": counts["companies"], "fields": counts["fields"],
                      "places": counts["places"], "model": "Claude Sonnet 5.5",
                      "costUsd": round(sum(b.get("cost") or 0 for b in batches) + places_cost + pilot_cost, 2)},
    }


# ── Meta ─────────────────────────────────────────────────────────────────────

def build_meta(con, diaspora):
    # Single global totals: exact (see the module docstring).
    profiles = one(con, f"SELECT count(*) FROM '{PROC}/people.parquet'")[0]
    alumni = one(con, "SELECT count(*) FROM alumni")[0]
    roles = one(con, f"SELECT count(*) FROM '{PROC}/positions.parquet'")[0]
    employers = one(con, f"""
        SELECT count(*) FROM (SELECT parent FROM '{DERIVED}/roles.parquet'
                              WHERE parent IS NOT NULL AND NOT side
                              GROUP BY 1 HAVING count(DISTINCT person_id) >= {K_NAMED})""")[0]
    countries = next(v["countries"] for v in diaspora["views"]
                     if (v["level"], v["program"], v["cohort"]) == ("all", "all", "all"))
    paths = one(con, "SELECT count(*) FROM paths WHERE grad_year BETWEEN 1995 AND 2024")[0]
    # Program sizes are the Twin (program, any cohort) groups: the same people, so the same numbers.
    programs = [{"level": lv, "program": pr, "discipline": disc or "other", "n": sdc.perturb(n, ks, K_FIELD)}
                for lv, pr, disc, n, ks in con.sql(f"""
                    -- most common discipline, ties by name (mode() breaks ties at random)
                    SELECT level_group, program_key, first(disc ORDER BY dn DESC, disc) FILTER (disc IS NOT NULL),
                           count(*) n, sum(rkey)
                    FROM (SELECT *, count(*) OVER (PARTITION BY level_group, program_key, disc) AS dn FROM members)
                    WHERE program_key <> '*' GROUP BY 1, 2 HAVING n >= {MIN_GROUP}""").fetchall()]
    programs.sort(key=lambda p: (-p["n"], p["level"], p["program"]))
    # Whether the River has any slice for the program (it needs 50+ people; Twin needs 30+).
    river = json.loads(Path("data/aggregates/river.json").read_text(encoding="utf-8"))
    in_river = {(s["level"], s["program"]) for s in river["slices"]}
    for prog in programs:
        prog["river"] = (prog["level"], prog["program"]) in in_river
    return {
        "generated": date.today().isoformat(), "snapshot": "2025-09", "k": {"field": K_FIELD, "named": K_NAMED},
        "counts": {"profiles": int(profiles), "alumni": int(alumni), "roles": int(roles),
                   "employers": int(employers), "countries": len(countries),
                   "metros": len(diaspora["metros"]), "paths": int(paths), "firstYear": 1995, "lastYear": 2024},
        "programs": programs,
        "cohorts": [{"id": c, "label": f"Class of {lo}–{hi}", "from": lo, "to": hi} for c, lo, hi in TWIN_COHORTS]
                   + [{"id": "all", "label": "Classes of 1995–2024", "from": 1995, "to": 2024}],
    }


# ── Privacy self-check ───────────────────────────────────────────────────────

COUNT_KEYS = {"n", "hits", "abroad", "us", "located", "of", "firstJobInKingston", "stillInKingston",
              "suppressed"}
# Sections that name an organisation, a job title or a place: every count in them answers to
# K_NAMED. Everything else answers to K_FIELD.
NAMED_KEYS = {"employersNow", "titlesNow", "employersFirst", "topMetros",                  # twin
              "metros", "countries", "metroDetail", "flows", "kingston",                   # diaspora
              "firstEmployers", "topEmployers",                                            # insights
              "details", "employers", "titles"}                                            # river
EVERY_INT_UNDER = {"totals"}     # River totals: {stage: {family: n}}


def check_counts(obj, path="$", floor=None, every_int=False):
    """Every integer stored under a count key (or anywhere under River `totals`), or as the
    count in a [label, count] pair, must be >= its floor (or null): K_NAMED inside a named
    section, K_FIELD elsewhere. Returns a list of offending paths."""
    floor = K_FIELD if floor is None else floor
    bad = []
    if isinstance(obj, dict):
        for k, v in obj.items():
            f = K_NAMED if k in NAMED_KEYS else floor
            if (k in COUNT_KEYS or every_int) and isinstance(v, int) and not isinstance(v, bool) and v < f:
                bad.append(f"{path}.{k}={v}")
            bad += check_counts(v, f"{path}.{k}", f, every_int or k in EVERY_INT_UNDER)
    elif isinstance(obj, list):
        if len(obj) == 2 and isinstance(obj[0], str) and isinstance(obj[1], int) and obj[1] < floor:
            bad.append(f"{path}={obj}")
        for i, v in enumerate(obj):
            bad += check_counts(v, f"{path}[{i}]", floor, every_int)
    return bad


def write(name, obj):
    bad = check_counts(obj)
    assert not bad, f"{name}: counts under their floor: {bad[:5]}"
    path = SITE / f"{name}.json"
    path.write_text(json.dumps(obj, separators=(",", ":"), ensure_ascii=False), encoding="utf-8")
    print(f"{path}: {path.stat().st_size / 1e6:.2f} MB")


def main(salt=None):
    """salt: the cell-key salt (default: data/secret/cellkey_salt.txt, created on first run)."""
    SITE.mkdir(parents=True, exist_ok=True)
    salt = sdc.load_salt(create=True) if salt is None else salt
    con = connect(salt)
    metros, metro_ids = build_metros(con)
    diaspora = build_diaspora(con, metros, metro_ids)
    twin = build_twin(con, metros, metro_ids)
    insights = build_insights(con, diaspora)
    meta = build_meta(con, diaspora)
    for name, obj in (("diaspora", diaspora), ("twin", twin), ("insights", insights), ("meta", meta)):
        write(name, obj)
    shutil.copy(RIVER, SITE / "river.json")
    river = json.loads((SITE / "river.json").read_text(encoding="utf-8"))
    assert not check_counts(river), "river.json: counts under their floor"
    print(f"{len(metros)} metros, {len(diaspora['views'])} diaspora views, {len(diaspora['flows'])} flows, "
          f"{len(twin['groups'])} twin groups, {len(insights['facts'])} facts, {len(meta['programs'])} programs")


if __name__ == "__main__":
    main()
