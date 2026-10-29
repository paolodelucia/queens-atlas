"""
07_export_river.py
------------------
Aggregates paths.parquet into the data behind the River view: for each
(degree level, program, 5-year graduating class) slice,

  stages   the Sankey: first destination -> year 3 -> year 5 -> year 10 -> year 20 -> today,
           keeping only the years EVERY member of the slice has reached (a 2015-2019 slice
           stops at year 5: the class of 2019 reached it in June 2024, not yet year 10).
           Flows between consecutive columns, plus the top employers and titles behind
           each node.
  years    the trajectory: for year 0 (first destination), 1, 2, ... 20 and today, how many
           members have reached that point (`n`, the denominator) and how they split by
           career family. A year is listed once MIN_YEAR members have reached it, so it
           goes further than the Sankey: classes in a 5-year band reach a year at different
           times, and later years are counted over the earlier classes only. Shares are
           family / n of the same year, never of the whole slice.

Privacy: this is the first file meant to leave data/. Two floors (sdc.py): counts of people
by career family (totals, links, years, suppressed) are published from K_FIELD people up;
counts behind a named employer or title (details) from K_NAMED up. Families under K_FIELD in a
column or year are folded into "smaller_groups", links under K_FIELD are dropped (their total
is reported per slice as `suppressed`). Those decisions use true counts; every number that is
published is then perturbed with the cell-key method (sdc.py), so slices can't be subtracted
from each other to recover a hidden cell. Links are then trimmed to fit inside their
published nodes, using published numbers only.

Populations: 'all' slices count each person once (their first credential); a level slice
('graduate', ...) counts everyone with a credential at that level, once (their first one at
that level: the same members as the Career Twin level groups); a program slice counts each
person once per program.

Output: data/aggregates/river.json

    .venv/Scripts/python pipeline/07_export_river.py
"""

import json
from datetime import date
from pathlib import Path

import duckdb
import pandas as pd
import sys

import sdc

# DuckDB prints box-drawing tables; a redirected stdout on Windows defaults to cp1252.
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")


K_FIELD = sdc.K_FIELD  # floor for counts of people by career family (totals, links, years)
K_NAMED = sdc.K_NAMED  # floor for counts behind a named employer or title (details)
# Size thresholds are about meaningfulness, not privacy: easy to change.
MIN_SLICE = 30        # owner chose 30 (Oct 2026): more programs per 5-year class; smaller charts are noisier
MIN_YEAR = 10         # a year of the trajectory is listed once this many members have reached it
TOP_N = 5
SNAPSHOT_YEAR = 2025
PATHS = "data/derived/paths.parquet"
OUT = Path("data/aggregates/river.json")

# Profiles of earlier grads rarely list early-career roles (>40% have none before 1990),
# so the river starts at 1995. Five-year graduating classes; 2025 grads aren't in any.
COHORTS = [
    ("1995-1999", 1995, 1999),
    ("2000-2004", 2000, 2004),
    ("2005-2009", 2005, 2009),
    ("2010-2014", 2010, 2014),
    ("2015-2019", 2015, 2019),
    ("2020-2024", 2020, 2024),
    ("all", 1995, 2024),
]
FIRST_YEAR, LAST_YEAR = 1995, 2024
LEVEL_GROUPS = ("undergrad", "graduate", "mba", "law", "medicine")
SANKEY_YEARS = (3, 5, 10, 20)        # Sankey columns between first destination and today
SERIES_YEARS = tuple(range(0, 21))   # the trajectory: 0 = first destination, N = June of grad_year + N
STAGE_LABELS = {"s0": "First destination", **{f"y{y}": f"Year {y}" for y in SANKEY_YEARS},
                "now": "Today (Sept 2025)"}
SMALL = "smaller_groups"
NO_ROLE = ("further_study", "no_role_listed", SMALL)   # nodes with no employer/title to show


def stages_for(last_grad_year):
    """Sankey columns for a cohort: the years its LAST class has reached by the snapshot."""
    return ["s0"] + [f"y{y}" for y in SANKEY_YEARS if last_grad_year + y <= SNAPSHOT_YEAR] + ["now"]


def series_col(year):
    """paths.parquet column holding the family at a point of the trajectory."""
    return "s0_family" if year == 0 else "now_family" if year == "now" else f"y{year}_family"


def ranked(pairs):
    """[(name, n)] largest first, ties in name order. Without the name order, ties would follow
    row order, which changes every time paths.parquet is rebuilt, so the export would too."""
    return sorted(pairs, key=lambda p: (-p[1], str(p[0])))


def published_counts(df, col, k):
    """[(value, published n)] for every value of `col` held by >= k people (decided on the
    true count), perturbed from those people's record keys (`rkey`), largest first."""
    agg = df[[col, "rkey"]].dropna(subset=[col]).groupby(col)["rkey"].agg(["size", "sum"])
    return ranked([(name, sdc.perturb(n, ks, k)) for name, n, ks in zip(agg.index, agg["size"], agg["sum"])
                   if n >= k])


def top_list(df, col):
    """Top employers/titles: they name an organisation or a job, so the named floor applies."""
    return [{"name": name, "n": n} for name, n in published_counts(df, col, K_NAMED)[:TOP_N]]


def top_lists(df, by, col):
    """top_list(df[df[by] == v], col) for every value v of `by` at once: {v: [{name, n}]}
    (values with no entry at the named floor are absent)."""
    agg = df[[by, col, "rkey"]].dropna(subset=[col]).groupby([by, col])["rkey"].agg(["size", "sum"])
    found = {}
    for (v, name), n, ks in zip(agg.index, agg["size"], agg["sum"]):
        if n >= K_NAMED:
            found.setdefault(v, []).append((name, sdc.perturb(n, ks, K_NAMED)))
    return {v: [{"name": name, "n": n} for name, n in ranked(rows)[:TOP_N]] for v, rows in found.items()}


def year_series(df, years=SERIES_YEARS, min_year=None, total=None):
    """The trajectory of a group of people: for each year (then 'now') that at least
    `min_year` of them have reached, {year, n: members who reached it, fields: [[family, n]]},
    families under K_FIELD folded into smaller_groups. Each family is capped at its year's n,
    and each n at `total` (the group's published size). Same rule in 08_export_site.py
    (Career Twin), through sdc.publish_parts, so a cell both publish gets the same number."""
    min_year = MIN_YEAR if min_year is None else min_year
    points = (*years, "now")
    cols = [series_col(y) for y in points]
    long = (df[cols + ["rkey"]].melt(id_vars="rkey", var_name="col", value_name="family")
            .dropna(subset=["family"]))
    agg = long.groupby(["col", "family"])["rkey"].agg(["size", "sum"])
    parts = {}
    for (col, fam), cnt, ks in zip(agg.index, agg["size"], agg["sum"]):
        parts.setdefault(col, {})[fam] = (int(cnt), int(ks))
    out = []
    for year, col in zip(points, cols):
        p = parts.get(col, {})
        reached = sum(n for n, _ in p.values())
        if reached < max(min_year, K_FIELD):
            continue
        n = sdc.cap(sdc.perturb(reached, sum(ks for _, ks in p.values()), K_FIELD), total)
        fields = [[fam, sdc.cap(v, n)] for fam, v in sdc.publish_parts(p, K_FIELD, SMALL)]
        out.append({"year": year, "n": n, "fields": fields})
    return out


def fit_links(links, totals):
    """Keep every published link inside its published nodes, looking only at published
    numbers (so it can't reveal anything they don't). Each link is capped at both of its
    nodes; where a node's links still add up to more than the node, its largest links give up
    one person at a time, never going below K_FIELD. If even links at the floor overflow a
    node, the node is raised to their sum. Mutates links/totals; returns (links trimmed,
    nodes raised)."""
    trimmed = raised = 0
    for l in links:
        cap = min(totals[l["from_stage"]][l["from"]], totals[l["to_stage"]][l["to"]])
        if l["n"] > cap:
            l["n"] = cap
            trimmed += 1
    for stage_key, end in (("from_stage", "from"), ("to_stage", "to")):
        by_node = {}
        for l in links:
            by_node.setdefault((l[stage_key], l[end]), []).append(l)
        for (stage, fam), group in by_node.items():
            excess = sum(l["n"] for l in group) - totals[stage][fam]
            touched = set()
            while excess > 0:
                big = [l for l in group if l["n"] > K_FIELD]
                if not big:
                    totals[stage][fam] += excess
                    raised += 1
                    break
                top = min(big, key=lambda l: (-l["n"], l["from"], l["to"]))
                top["n"] -= 1
                touched.add(id(top))
                excess -= 1
            trimmed += len(touched)
    return trimmed, raised


def build_slice(df, stages, years=SERIES_YEARS):
    """One River slice. `df` needs an `rkey` column (sdc record keys): every count published
    from it is perturbed (rkey = 0 everywhere gives cell key 0, i.e. no noise). Every stage in
    `stages` must be reached by every row (stages_for picks them so)."""
    stage_cols = [f"{s}_{f}" for s in stages for f in ("family", "employer", "title")]
    df = df[list(dict.fromkeys(stage_cols + [series_col(y) for y in (*years, "now")] + ["rkey"]))].copy()
    # Fold families too small to publish into one bucket, stage by stage. It is kept apart
    # from the "other" function so a big bucket isn't misread as one kind of job.
    for s in stages:
        col = f"{s}_family"
        counts = df[col].value_counts()
        small = counts[counts < K_FIELD].index
        df.loc[df[col].isin(small), col] = SMALL

    totals, details = {}, {}
    for s in stages:
        col = f"{s}_family"
        totals[s] = dict(published_counts(df, col, K_FIELD))
        employers, titles = top_lists(df, col, f"{s}_employer"), top_lists(df, col, f"{s}_title")
        details[s] = {fam: {"employers": employers.get(fam, []), "titles": titles.get(fam, [])}
                      for fam in totals[s] if fam not in NO_ROLE and (fam in employers or fam in titles)}

    links, hidden, hidden_keys = [], 0, 0
    for a, b in zip(stages, stages[1:]):
        pairs = df.groupby([f"{a}_family", f"{b}_family"])["rkey"].agg(["size", "sum"])
        for (src, dst), n, ks in zip(pairs.index, pairs["size"], pairs["sum"]):
            if n >= K_FIELD:
                links.append({"from_stage": a, "from": src, "to_stage": b, "to": dst,
                              "n": sdc.perturb(n, ks, K_FIELD)})
            else:
                hidden += int(n)
                hidden_keys += int(ks)
    fit_links(links, totals)
    n = sdc.perturb(len(df), int(df["rkey"].sum()), K_FIELD)
    # The residual is itself a count, so it's only shown once it reaches the floor (perturbed too).
    return {"n": n, "stages": stages, "totals": totals, "links": links,
            "suppressed": sdc.perturb_ge_k(hidden, hidden_keys, K_FIELD), "details": details,
            "years": year_series(df, years, total=n)}


def build_slices(paths):
    """paths: the paths.parquet DataFrame plus an `rkey` column (see with_rkeys).
    Returns every published River slice."""
    stage_cols = [f"{s}_{f}" for s in stages_for(FIRST_YEAR) for f in ("family", "employer", "title")]
    keep = ["person_id", "cred_rank", "level_group", "program", "grad_year", "rkey"] + stage_cols
    keep += [series_col(y) for y in (*SERIES_YEARS, "now")]
    paths = paths.loc[paths.grad_year.between(FIRST_YEAR, LAST_YEAR), list(dict.fromkeys(keep))]
    # Plain object columns: pandas' Arrow-backed strings make the many small groupbys ~5x slower.
    paths = paths.astype({c: object for c in paths.columns if c not in ("cred_rank", "grad_year", "rkey")})

    # The whole-school view counts each person once (their first credential). A level view
    # counts everyone with a credential at that level once (their first one there), and a
    # program view each person once per program: the same members as the Career Twin groups,
    # so both views publish the same cells (and, with cell keys, the same numbers).
    first = paths[paths.cred_rank == 1]
    per_level = (paths[paths.level_group.isin(LEVEL_GROUPS)]
                 .sort_values("cred_rank", kind="stable")
                 .drop_duplicates(["person_id", "level_group"]))
    per_program = (paths[paths.program.notna() & paths.level_group.isin(LEVEL_GROUPS)]
                   .sort_values("cred_rank", kind="stable")
                   .drop_duplicates(["person_id", "level_group", "program"]))

    groups = [("all", "all", first)]
    groups += [(lg, "all", per_level[per_level.level_group == lg]) for lg in LEVEL_GROUPS]
    groups += [(lg, prog, g) for (lg, prog), g in per_program.groupby(["level_group", "program"])]

    slices = []
    for level_group, program, g in groups:
        for cohort, lo, hi in COHORTS:
            df = g[g.grad_year.between(lo, hi)]
            if len(df) < MIN_SLICE:
                continue
            slices.append({"level": level_group, "program": program, "cohort": cohort,
                           **build_slice(df, stages_for(hi))})
    return slices


def with_rkeys(paths, salt):
    """paths plus each person's sdc record key (`rkey`)."""
    paths = paths.copy()
    paths["rkey"] = pd.array(sdc.rkeys(paths["person_id"], salt), dtype="int64")
    return paths


def published_numbers(slices):
    """(field counts, named counts): every published people count, by the floor it answers to."""
    field = [s["n"] for s in slices]
    field += [l["n"] for s in slices for l in s["links"]]
    field += [n for s in slices for t in s["totals"].values() for n in t.values()]
    field += [s["suppressed"] for s in slices if s["suppressed"] is not None]
    field += [p["n"] for s in slices for p in s["years"]]
    field += [n for s in slices for p in s["years"] for _, n in p["fields"]]
    named = [e["n"] for s in slices for st in s["details"].values() for d in st.values()
             for e in d["employers"] + d["titles"]]
    return field, named


def self_check(slices):
    """Privacy self-check: no published count under its floor. Returns every published count."""
    field, named = published_numbers(slices)
    assert min(field) >= K_FIELD, "a published family/flow count is under the field floor"
    assert not named or min(named) >= K_NAMED, "a published employer/title count is under the named floor"
    # Slices are chosen on their true size; the published n may sit up to MAX_NOISE below.
    assert all(s["n"] >= MIN_SLICE - sdc.MAX_NOISE for s in slices)
    for s in slices:
        assert all(MIN_YEAR - sdc.MAX_NOISE <= p["n"] <= s["n"] for p in s["years"])
        assert all(n <= p["n"] for p in s["years"] for _, n in p["fields"])
    return field + named


def main(paths=PATHS, out=OUT, salt=None):
    """paths: paths.parquet from 06_paths, out: the River JSON, salt: the cell-key salt
    (default: data/secret/cellkey_salt.txt, created on first run). Tests pass temp paths
    and a test salt."""
    out = Path(out)
    salt = sdc.load_salt(create=True) if salt is None else salt
    df = duckdb.sql(f"SELECT * FROM '{Path(paths).as_posix()}'").df()
    slices = build_slices(with_rkeys(df, salt))

    out.parent.mkdir(parents=True, exist_ok=True)
    meta = {
        "generated": date.today().isoformat(),
        "snapshot": "2025-09",
        "k": {"field": K_FIELD, "named": K_NAMED},
        "min_slice": MIN_SLICE,
        "min_year": MIN_YEAR,
        "stages": STAGE_LABELS,
        "note": f"Counts are LinkedIn profiles of Queen's alumni. Career families under {K_FIELD} people in a "
                f"column or year are folded into 'smaller_groups', and links under {K_FIELD} are dropped "
                "(`suppressed` gives their total once it reaches that floor); employers and titles are named "
                f"only when at least {K_NAMED} people share them. Every published count carries a small "
                "deterministic perturbation (cell-key method, at most 2 people either way), so parts need not "
                "add up exactly to their totals. Sankey stages are the years every member of the slice has "
                "reached; `years` goes further, and each year's shares are of that year's `n` (the members who "
                "have reached it: in a 5-year class, later years cover the earlier classes only).",
    }
    out.write_text(json.dumps({"meta": meta, "slices": slices}, separators=(",", ":")))

    numbers = self_check(slices)

    programs = {(s["level"], s["program"]) for s in slices if s["program"] != "all"}
    print(f"{len(slices)} slices, {len(programs)} programs, {len(numbers)} published counts "
          f"(min {min(numbers)}), {out.stat().st_size / 1e6:.2f} MB -> {out}")


if __name__ == "__main__":
    main()
