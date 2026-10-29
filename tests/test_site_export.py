"""08_export_site.py: the Career Twin year series (denominators, horizons, the same numbers as
the River), year_point, and the two-floor privacy self-check (check_counts)."""

import duckdb
import pandas as pd
import pytest

import sdc
from conftest import ROLES_SCHEMA, load_pipeline, write_parquet

SITE = load_pipeline("08_export_site")
RIVER = load_pipeline("07_export_river")
SALT = "site-export-test-salt-0123456789"
# year: (people, family they hold every year)
CLASSES = {1996: (12, "law"), 2010: (40, "tech"), 2012: (25, "consulting"), 2018: (35, "tech"),
           2022: (33, "further_study"), 2025: (20, "tech")}


def world():
    rows = []
    for year, (n, fam) in CLASSES.items():
        for i in range(n):
            rows.append({
                "person_id": f"{year}/{i}", "cred_rank": 1, "level_group": "graduate", "program": "Program",
                "grad_year": year, "s0_family": fam, "s0_employer": None, "s0_title": None,
                **{f"y{y}_family": (fam if year + y <= 2025 else None) for y in range(1, 21)},
                **{f"y{y}_{f}": None for y in (3, 5, 10, 20) for f in ("employer", "title")},
                "now_family": fam, "now_employer": None, "now_title": None, "now_seniority": "mid",
            })
    df = pd.DataFrame(rows)
    df["rkey"] = pd.array(sdc.rkeys(df.person_id, SALT), dtype="int64")
    return df


@pytest.fixture(scope="module")
def twin(tmp_path_factory):
    df = world()
    derived = tmp_path_factory.mktemp("derived")
    write_parquet(derived / "roles.parquet", [], ROLES_SCHEMA)
    con = duckdb.connect()
    con.register("paths_df", df)
    con.sql("CREATE TABLE paths AS SELECT * FROM paths_df")
    con.register("alumni_df", pd.DataFrame({"person_id": df.person_id.unique()}).assign(
        home_country="CA", home_metro="Kingston|CA"))
    con.sql("CREATE TABLE alumni AS SELECT * FROM alumni_df")
    mp = pytest.MonkeyPatch()
    try:
        mp.setattr(SITE, "DERIVED", derived.as_posix())
        out = SITE.build_twin(con, [], {})
    finally:
        mp.undo()
    return {(g["level"], g["program"], g["cohort"], g["s0"]): g for g in out["groups"]}, df


def years_of(g):
    return {p["year"]: (p["n"], dict(p["fields"])) for p in g["years"]}


def test_twin_group_shape(twin):
    groups, _ = twin
    g = groups[("graduate", "Program", "*", "*")]
    assert "stageN" not in g and "outcomes" not in g and "first" not in g
    assert [p["year"] for p in g["years"]] == [y for y in SITE.TWIN_YEARS if y in years_of(g)] + ["now"]
    for p in g["years"]:
        assert set(p) == {"year", "n", "fields"} and p["n"] <= g["n"]
        assert all(v <= p["n"] and v >= sdc.K_FIELD for _, v in p["fields"])


def test_twin_years_follow_each_class_horizon(twin):
    """A group spans classes 1996-2022 (2025 grads are outside 1995-2024): a year counts the
    classes that reached its June, and needs MIN_YEAR of them."""
    groups, df = twin
    g = groups[("graduate", "Program", "*", "*")]
    members = df[df.grad_year.between(1995, 2024)]
    for year in (*SITE.TWIN_YEARS, "now"):
        col = SITE.series_col(year)
        reached = members[members[col].notna()]
        if len(reached) < SITE.MIN_YEAR:
            assert year not in years_of(g)
            continue
        n = sdc.cap(sdc.perturb(len(reached), int(reached.rkey.sum()), sdc.K_FIELD), g["n"])
        assert years_of(g)[year][0] == n, year
    # 20 years out: only the 12 grads of 1996 (2010 + 20 = 2030), all in law.
    assert years_of(g)[20][1].keys() == {"law"}
    assert years_of(groups[("graduate", "Program", "2020-2024", "*")]).keys() == {0, 1, 2, 3, "now"}
    assert years_of(groups[("graduate", "Program", "2015-2019", "*")]).keys() == {0, 1, 2, 3, 5, 7, "now"}


def test_twin_year_zero_is_the_first_destination(twin):
    groups, df = twin
    g = groups[("graduate", "Program", "2010-2014", "*")]
    band = df[df.grad_year.between(2010, 2014)]
    expected = {fam: sdc.cap(sdc.perturb(len(sub), int(sub.rkey.sum()), sdc.K_FIELD), g["n"])
                for fam, sub in band.groupby("s0_family")}
    assert years_of(g)[0] == (g["n"], expected) and set(expected) == {"tech", "consulting"}
    fixed = groups[("graduate", "Program", "2010-2014", "tech")]
    assert years_of(fixed)[0] == (fixed["n"], {"tech": fixed["n"]})


def test_twin_years_equal_the_river_for_the_same_people(twin):
    groups, df = twin
    slices = {(s["level"], s["program"], s["cohort"]): s for s in RIVER.build_slices(df)}
    compared = 0
    for (lv, pr, co), s in slices.items():
        g = groups.get(("*" if lv == "all" else lv, "*" if pr == "all" else pr, "*" if co == "all" else co, "*"))
        if g is None:
            continue
        assert g["n"] == s["n"]
        ty = {p["year"]: p for p in g["years"]}
        for p in s["years"]:
            if p["year"] in ty:
                assert ty[p["year"]] == p
                compared += 1
    assert compared >= 20


def test_year_point_rules():
    assert SITE.year_point(3, {"tech": (6, 0), "law": (3, 0)}, 50) is None            # 9 < MIN_YEAR
    p = SITE.year_point(3, {"tech": (8, 0), "law": (3, 0), "arts_media": (2, 0)}, 50)
    assert p == {"year": 3, "n": 13, "fields": [["tech", 8], ["smaller_groups", 5]]}
    p = SITE.year_point("now", {"tech": (60, 0)}, 55)                                  # capped at the group
    assert p == {"year": "now", "n": 55, "fields": [["tech", 55]]}


@pytest.mark.parametrize("obj, bad", [
    ({"groups": [{"n": 5, "years": [{"year": 1, "n": 5, "fields": [["tech", 5]]}]}]}, False),
    ({"groups": [{"n": 4}]}, True),
    ({"groups": [{"years": [{"year": 1, "n": 9, "fields": [["tech", 4]]}]}]}, True),
    ({"groups": [{"employersNow": [{"name": "X", "n": 9}]}]}, True),            # named: 10
    ({"groups": [{"topMetros": [{"name": "X", "n": 10}]}]}, False),
    ({"metros": [{"id": "x", "n": 9}]}, True),
    ({"metroDetail": {"x": {"families": [["tech", 9]]}}}, True),
    ({"abroad": {"byProgram": [{"n": 60, "abroad": 5, "us": None}]}}, False),
    ({"kingston": {"firstJobInKingston": 9}}, True),
    ({"slices": [{"totals": {"s0": {"tech": 4}}}]}, True),                      # River totals are counts
    ({"slices": [{"totals": {"s0": {"tech": 5}}, "details": {"s0": {"tech": {"titles": [{"name": "T", "n": 9}]}}}}]}, True),
    ({"firstEmployers": [{"name": "X", "n": 9}]}, True),
    ({"rankings": [{"rows": [{"n": 100, "hits": 5}]}]}, False),
    ({"k": {"field": 5, "named": 10}, "counts": {"metros": 3}}, False),         # not people counts
])
def test_check_counts_uses_the_right_floor(obj, bad):
    assert bool(SITE.check_counts(obj)) is bad
