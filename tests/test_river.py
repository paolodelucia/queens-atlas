"""07_export_river.py: stage selection, top lists, slice building (folding, link suppression,
the two floors), the year-by-year series and its denominators, cell-key perturbation and link
fitting, the slice grid, the privacy self-check and main() end to end.

Most tests build frames with rkey = 0 for everyone: every cell key is then 0, which the sdc
perturbation table maps to noise 0, so they check the exact structural logic. The
"perturbed" tests use real record keys.

Floors (sdc.py): career-family counts (totals, links, years, suppressed) need K_FIELD = 5
people; employer/title counts (details) need K_NAMED = 10."""

import json
import random

import numpy as np
import pandas as pd
import pytest

import privacy_scan as ps
import sdc
from conftest import load_pipeline

RIVER = load_pipeline("07_export_river")
STAGES = ("s0", "y3", "y5", "y10", "y20", "now")
YEAR_COLS = ["s0_family"] + [f"y{n}_family" for n in range(1, 21)] + ["now_family"]
TEST_SALT = "test-salt-not-the-real-one-0123456789"
KF, KN = RIVER.K_FIELD, RIVER.K_NAMED


def people(n, **cols):
    return [dict(cols) for _ in range(n)]


def frame(*groups):
    """Rows -> DataFrame with family/employer/title columns for every Sankey stage and a family
    column for every year (missing = None), and rkey = 0 (no noise) unless the rows carry their own."""
    rows = [r for g in groups for r in g]
    df = pd.DataFrame(rows)
    for col in [f"{s}_{f}" for s in STAGES for f in ("family", "employer", "title")] + YEAR_COLS:
        if col not in df:
            df[col] = None
    if "rkey" not in df:
        df["rkey"] = 0
    return df


def keyed(df, salt=TEST_SALT):
    """The same frame with real record keys (one person per row)."""
    df = df.copy()
    df["rkey"] = sdc.rkeys([f"person-{i}" for i in range(len(df))], salt)
    return df


def links_of(sl):
    return {(l["from_stage"], l["from"], l["to_stage"], l["to"]): l["n"] for l in sl["links"]}


def years_of(sl):
    return {p["year"]: (p["n"], dict(p["fields"])) for p in sl["years"]}


def violations(sl):
    """Privacy-scan a lone slice (as it sits in river.json, so field/named floors apply by path)."""
    return ps.k_violations({"slices": [sl]}, (KF, KN))


def test_floors():
    assert (KF, KN) == (sdc.K_FIELD, sdc.K_NAMED) == (5, 10)


# ── stages_for ───────────────────────────────────────────────────────────────

@pytest.mark.parametrize("last_year, stages", [
    (1999, ["s0", "y3", "y5", "y10", "y20", "now"]),
    (2004, ["s0", "y3", "y5", "y10", "y20", "now"]),   # 2004 + 20 = 2024
    (2005, ["s0", "y3", "y5", "y10", "y20", "now"]),   # 2005 + 20 = 2025: June 2025 is before the snapshot
    (2009, ["s0", "y3", "y5", "y10", "now"]),
    (2014, ["s0", "y3", "y5", "y10", "now"]),
    (2015, ["s0", "y3", "y5", "y10", "now"]),
    (2016, ["s0", "y3", "y5", "now"]),
    (2019, ["s0", "y3", "y5", "now"]),
    (2020, ["s0", "y3", "y5", "now"]),
    (2022, ["s0", "y3", "now"]),
    (2023, ["s0", "now"]),
    (2024, ["s0", "now"]),
])
def test_stages_for(river, last_year, stages):
    assert river.stages_for(last_year) == stages


@pytest.mark.parametrize("cohort, stages", [
    ("1995-1999", ["s0", "y3", "y5", "y10", "y20", "now"]),
    ("2000-2004", ["s0", "y3", "y5", "y10", "y20", "now"]),
    ("2005-2009", ["s0", "y3", "y5", "y10", "now"]),
    ("2010-2014", ["s0", "y3", "y5", "y10", "now"]),
    ("2015-2019", ["s0", "y3", "y5", "now"]),
    ("2020-2024", ["s0", "now"]),
    ("all", ["s0", "now"]),
])
def test_stages_per_cohort(river, cohort, stages):
    hi = dict((c, h) for c, _, h in river.COHORTS)[cohort]
    assert river.stages_for(hi) == stages


def test_series_columns(river):
    assert river.series_col(0) == "s0_family" and river.series_col("now") == "now_family"
    assert river.series_col(7) == "y7_family"
    assert river.SERIES_YEARS == tuple(range(0, 21))
    assert set(river.SANKEY_YEARS) <= set(load_pipeline("06_paths").DETAIL_YEARS)


# ── top_list ─────────────────────────────────────────────────────────────────

def test_top_list_threshold_order_and_length(river):
    """Employers and titles are named: the named floor (10) applies, not the field floor."""
    counts = {"Zeta": 10, "Alpha": 10, "Mid": 15, "Big": 40, "Small": 9, "Other": 12, "Tail": 11, "Five": 5}
    df = pd.DataFrame({"x": [name for name, n in counts.items() for _ in range(n)] + [None] * 30})
    df["rkey"] = 0
    out = river.top_list(df, "x")
    assert out == [{"name": "Big", "n": 40}, {"name": "Mid", "n": 15}, {"name": "Other", "n": 12},
                   {"name": "Tail", "n": 11}, {"name": "Alpha", "n": 10}]   # ties by name; Zeta is 6th
    assert all(type(e["n"]) is int for e in out)


def test_top_list_empty(river):
    assert river.top_list(pd.DataFrame({"x": [None] * 20 + ["A"] * 9, "rkey": 0}), "x") == []


def test_top_list_requires_record_keys(river):
    """No rkey column, no export: a count can't be published unperturbed by accident."""
    with pytest.raises(KeyError):
        river.top_list(pd.DataFrame({"x": ["A"] * 20}), "x")


def test_top_lists_match_top_list_per_value(river):
    rng = random.Random(4)
    df = pd.DataFrame({"fam": [rng.choice("abc") for _ in range(600)],
                       "emp": [rng.choice([None] + [f"E{i}" for i in range(12)]) for _ in range(600)]})
    df = keyed(df)
    grouped = river.top_lists(df, "fam", "emp")
    for fam in "abc":
        expected = river.top_list(df[df.fam == fam], "emp")
        assert grouped.get(fam, []) == expected


def test_ranked_breaks_ties_by_name(river):
    assert river.ranked([("b", 2), ("a", 2), ("c", 2), ("d", 1), ("e", 3)]) == [
        ("e", 3), ("a", 2), ("b", 2), ("c", 2), ("d", 1)]


# ── build_slice ──────────────────────────────────────────────────────────────

@pytest.fixture
def mixed():
    """60 people over s0 -> now:
         s0: tech 30, finance 15, further_study 8, law 4, arts 3   (law + arts fold: 7)
        now: tech 40, consulting 8, finance 5, law 4, arts 3      (law + arts fold: 7)"""
    return frame(
        people(12, s0_family="tech", s0_employer="Shopify", s0_title="Software Engineer", now_family="tech"),
        people(11, s0_family="tech", s0_employer="Google", s0_title="Software Engineer", now_family="tech"),
        [dict(s0_family="tech", s0_employer=f"Startup {i}", s0_title="Developer", now_family="tech")
         for i in range(7)],
        people(10, s0_family="finance_accounting", s0_employer="RBC", s0_title="Analyst", now_family="tech"),
        people(5, s0_family="finance_accounting", s0_employer="TD", s0_title="Analyst",
               now_family="finance_accounting"),
        people(4, s0_family="law", now_family="law"),
        people(3, s0_family="arts_media", now_family="arts_media"),
        people(8, s0_family="further_study", now_family="consulting"),
    )


def test_build_slice_totals_fold_small_families(river, mixed):
    sl = river.build_slice(mixed, ["s0", "now"])
    assert sl["n"] == 60
    assert sl["stages"] == ["s0", "now"]
    assert sl["totals"] == {
        "s0": {"tech": 30, "finance_accounting": 15, "further_study": 8, "smaller_groups": 7},
        "now": {"tech": 40, "consulting": 8, "smaller_groups": 7, "finance_accounting": 5}}


def test_build_slice_links_and_suppression(river, mixed):
    sl = river.build_slice(mixed, ["s0", "now"])
    assert links_of(sl) == {("s0", "tech", "now", "tech"): 30,
                            ("s0", "finance_accounting", "now", "tech"): 10,
                            ("s0", "finance_accounting", "now", "finance_accounting"): 5,   # at the field floor
                            ("s0", "further_study", "now", "consulting"): 8,
                            ("s0", "smaller_groups", "now", "smaller_groups"): 7}
    assert sl["suppressed"] is None          # nothing hidden


def test_build_slice_details_use_the_named_floor(river, mixed):
    """Families are shown from 5 people, but employers and titles only from 10."""
    sl = river.build_slice(mixed, ["s0", "now"])
    assert sl["details"] == {
        "s0": {"tech": {"employers": [{"name": "Shopify", "n": 12}, {"name": "Google", "n": 11}],
                        "titles": [{"name": "Software Engineer", "n": 23}]},
               "finance_accounting": {"employers": [{"name": "RBC", "n": 10}],
                                      "titles": [{"name": "Analyst", "n": 15}]}},
        "now": {},   # no employers/titles at 'now' in this data; smaller_groups never gets details
    }


def test_build_slice_small_bucket_under_the_floor_is_dropped(river):
    df = frame(people(20, s0_family="tech", now_family="tech"),
               people(2, s0_family="law", now_family="law"), people(2, s0_family="arts_media", now_family="arts_media"))
    sl = river.build_slice(df, ["s0", "now"])
    assert sl["totals"] == {"s0": {"tech": 20}, "now": {"tech": 20}}
    assert links_of(sl) == {("s0", "tech", "now", "tech"): 20}
    assert sl["suppressed"] is None


def test_build_slice_small_bucket_at_the_floor_is_shown(river):
    df = frame(people(20, s0_family="tech", now_family="tech"),
               people(3, s0_family="law", now_family="law"), people(2, s0_family="arts_media", now_family="arts_media"))
    sl = river.build_slice(df, ["s0", "now"])
    assert sl["totals"]["s0"] == {"tech": 20, "smaller_groups": 5}


def test_build_slice_reports_suppressed_once_it_reaches_the_floor(river):
    df = frame(people(14, s0_family="tech", now_family="tech"), people(3, s0_family="tech", now_family="law"),
               people(14, s0_family="law", now_family="law"), people(3, s0_family="law", now_family="tech"))
    sl = river.build_slice(df, ["s0", "now"])
    assert links_of(sl) == {("s0", "tech", "now", "tech"): 14, ("s0", "law", "now", "law"): 14}
    assert sl["suppressed"] == 6
    df = frame(people(14, s0_family="tech", now_family="tech"), people(2, s0_family="tech", now_family="law"),
               people(14, s0_family="law", now_family="law"), people(2, s0_family="law", now_family="tech"))
    assert river.build_slice(df, ["s0", "now"])["suppressed"] is None      # 4 hidden: under the floor


def test_build_slice_links_only_consecutive_stages(river):
    df = frame(people(25, s0_family="tech", y5_family="tech", y10_family="finance_accounting", now_family="tech"),
               people(25, s0_family="law", y5_family="law", y10_family="law", now_family="law"))
    sl = river.build_slice(df, ["s0", "y5", "y10", "now"])
    assert {(a, b) for a, _, b, _ in links_of(sl)} == {("s0", "y5"), ("y5", "y10"), ("y10", "now")}
    assert links_of(sl)[("y5", "tech", "y10", "finance_accounting")] == 25


def test_build_slice_does_not_mutate_input(river, mixed):
    before = mixed.copy()
    river.build_slice(mixed, ["s0", "now"])
    pd.testing.assert_frame_equal(mixed, before)


def test_build_slice_is_json_ready(river, mixed):
    sl = river.build_slice(mixed, ["s0", "now"])
    json.dumps(sl)
    for _, v in ps.walk(sl):
        assert not isinstance(v, np.generic)


def test_build_slice_independent_of_row_order(river):
    """paths.parquet comes back in a different row order on every rebuild; the export must not."""
    df = frame(*[people(10, s0_family="tech", s0_employer=f"Employer {c}", s0_title=f"Title {c}", now_family="tech",
                        y1_family="tech" if c < "D" else "law")
                 for c in "GFEDCBA"],
               people(12, s0_family="law", now_family="law", y1_family="law"))
    expected = json.dumps(river.build_slice(df, ["s0", "now"]))
    for seed in range(5):
        shuffled = df.sample(frac=1, random_state=seed).reset_index(drop=True)
        assert json.dumps(river.build_slice(shuffled, ["s0", "now"])) == expected
    tech = json.loads(expected)["details"]["s0"]["tech"]
    assert [e["name"] for e in tech["employers"]] == [f"Employer {c}" for c in "ABCDE"]


# ── The year-by-year series ──────────────────────────────────────────────────

def cohort_rows(n, grad, fam_by_year, now="tech", s0="tech"):
    """n people of class `grad`: yN set (from fam_by_year(N), default 'tech') up to the June of
    2025, NULL after, as 06_paths writes them."""
    row = {"s0_family": s0, "now_family": now}
    for y in range(1, 21):
        row[f"y{y}_family"] = (fam_by_year(y) or "tech") if grad + y <= 2025 else None
    return people(n, **row)


@pytest.fixture
def band():
    """A 2018-2022 class band: 30 grads of 2022 (reached y1..y3), 20 of 2020 (y1..y5),
    8 of 2018 (y1..y7). Year 4 onwards is counted over the earlier classes only."""
    return frame(
        cohort_rows(30, 2022, lambda y: "further_study" if y == 1 else None),
        cohort_rows(20, 2020, lambda y: "consulting" if y >= 3 else None),
        cohort_rows(8, 2018, lambda y: "law"),
    )


def test_year_series_denominators_are_members_who_reached_the_year(river, band):
    years = years_of(river.build_slice(band, ["s0", "now"]))
    assert {y: n for y, (n, _) in years.items()} == {0: 58, 1: 58, 2: 58, 3: 58, 4: 28, 5: 28, "now": 58}
    # years 6 and 7: only the 8 grads of 2018 reached them, under MIN_YEAR (10): not listed
    assert river.MIN_YEAR == 10 and 6 not in years and 7 not in years


def test_year_series_order(river, band):
    assert [p["year"] for p in river.build_slice(band, ["s0", "now"])["years"]] == [0, 1, 2, 3, 4, 5, "now"]


def test_year_series_fields_fold_small_families_per_year(river, band):
    years = years_of(river.build_slice(band, ["s0", "now"]))
    assert years[1][1] == {"further_study": 30, "tech": 20, "law": 8}
    assert years[3][1] == {"tech": 30, "consulting": 20, "law": 8}
    assert years[4][1] == {"consulting": 20, "law": 8}
    small = frame(cohort_rows(40, 2015, lambda y: None), cohort_rows(3, 2015, lambda y: "law"),
                  cohort_rows(3, 2015, lambda y: "arts_media"), cohort_rows(4, 2015, lambda y: "founder"))
    years = years_of(river.build_slice(small, ["s0", "now"]))
    assert years[5] == (50, {"tech": 40, "smaller_groups": 10})        # 3 + 3 + 4, each under 5
    assert [p["fields"] for p in river.build_slice(small, ["s0", "now"])["years"] if p["year"] == 5] == \
        [[["tech", 40], ["smaller_groups", 10]]]                         # largest first


def test_year_series_matches_sankey_totals(river):
    """A Sankey stage every member has reached is the same cells as that year of the series."""
    rng = random.Random(8)
    fams = ["tech", "law", "consulting", "further_study", "no_role_listed", "founder"]
    rows = []
    for i in range(140):
        row = {"s0_family": rng.choice(fams), "now_family": rng.choice(fams)}
        row.update({f"y{y}_family": rng.choice(fams) for y in range(1, 21)})
        rows.append(row)
    stages = ["s0", "y3", "y5", "y10", "y20", "now"]
    pairs = (("s0", 0), ("y3", 3), ("y5", 5), ("y10", 10), ("y20", 20), ("now", "now"))
    exact = river.build_slice(frame(rows), stages)
    for stage, year in pairs:
        assert years_of(exact)[year] == (exact["n"], exact["totals"][stage]), stage
    # Perturbed: the same cells get the same noise, except where fit_links raised a node.
    sl = river.build_slice(keyed(frame(rows)), stages)
    years = years_of(sl)
    for stage, year in pairs:
        assert years[year][0] == sl["n"]
        assert set(years[year][1]) == set(sl["totals"][stage])
        assert all(v == sl["totals"][stage][f] or v < sl["totals"][stage][f] for f, v in years[year][1].items())


def test_year_series_perturbed_and_capped(river, band):
    df = keyed(band)
    sl = river.build_slice(df, ["s0", "now"])
    reached4 = df[df.y4_family.notna()]
    p4 = next(p for p in sl["years"] if p["year"] == 4)
    assert p4["n"] == sdc.cap(sdc.perturb(len(reached4), reached4.rkey.sum(), KF), sl["n"])
    law = reached4[reached4.y4_family == "law"]
    assert dict(p4["fields"])["law"] == sdc.cap(sdc.perturb(len(law), law.rkey.sum(), KF), p4["n"])
    for p in sl["years"]:
        assert p["n"] <= sl["n"] and all(n <= p["n"] for _, n in p["fields"])


def test_year_series_never_lists_a_year_under_the_floor(river, monkeypatch):
    """MIN_YEAR is about meaningfulness; even at 0, a year needs K_FIELD members."""
    monkeypatch.setattr(river, "MIN_YEAR", 0)
    df = frame(cohort_rows(60, 2023, lambda y: None), cohort_rows(4, 2021, lambda y: None))
    years = years_of(river.build_slice(df, ["s0", "now"]))
    assert 2 in years and 3 not in years and 4 not in years   # year 3+: only the 4 grads of 2021


# ── Fuzzing ──────────────────────────────────────────────────────────────────

FAMILIES = ["tech", "engineering", "finance_accounting", "consulting", "law", "healthcare", "teaching",
            "further_study", "no_role_listed", "arts_media", "founder", "other"]


def random_slice(rng, stages):
    """Rows over the given Sankey stages and a random reach per person (at least the last Sankey
    year), with years after the reach NULL."""
    n = rng.randint(50, 250)
    weights = [rng.random() ** 3 for _ in FAMILIES]   # skewed: many small families
    last = max([int(s[1:]) for s in stages if s.startswith("y")], default=1)
    rows = []
    for _ in range(n):
        reach = rng.randint(last, 20)
        row = {f"y{y}_family": (rng.choices(FAMILIES, weights)[0] if y <= reach else None) for y in range(1, 21)}
        for s in ("s0", "now"):
            row[f"{s}_family"] = rng.choices(FAMILIES, weights)[0]
        for s in stages:
            row[f"{s}_employer"] = f"Employer {min(int(rng.expovariate(0.3)), 30)}"
            row[f"{s}_title"] = rng.choice([None, "Analyst", "Manager", f"Title {rng.randint(0, 20)}"])
        rows.append(row)
    return frame(rows)


STAGE_CHOICES = [["s0", "now"], ["s0", "y3", "now"], ["s0", "y3", "y5", "now"], ["s0", "y3", "y5", "y10", "now"],
                 ["s0", "y3", "y5", "y10", "y20", "now"]]


def test_build_slice_privacy_invariants_fuzz(river):
    rng = random.Random(20250930)
    for _ in range(60):
        stages = rng.choice(STAGE_CHOICES)
        df = random_slice(rng, stages)
        sl = river.build_slice(df, stages)
        n = len(df)
        assert violations(sl) == []
        for s in stages:
            hidden = n - sum(sl["totals"][s].values())
            assert 0 <= hidden < KF                  # only a folded bucket under the floor may be left out
            assert all(f in sl["totals"][s] for f in sl["details"][s])
            assert not set(sl["details"][s]) & set(river.NO_ROLE)
            for d in sl["details"][s].values():
                assert all(e["n"] >= KN for e in d["employers"] + d["titles"])
        published = sum(sl["links"][i]["n"] for i in range(len(sl["links"])))
        hidden_links = n * (len(stages) - 1) - published
        assert sl["suppressed"] == (hidden_links if hidden_links >= KF else None)
        # Years: exact denominators, families partition them up to one folded bucket under the floor.
        for p in sl["years"]:
            col = river.series_col(p["year"])
            assert p["n"] == df[col].notna().sum() >= river.MIN_YEAR
            assert 0 <= p["n"] - sum(v for _, v in p["fields"]) < KF
        reached = [y for y in river.SERIES_YEARS if df[river.series_col(y)].notna().sum() >= river.MIN_YEAR]
        assert [p["year"] for p in sl["years"]] == reached + ["now"]


# ── Perturbed slices and link fitting ────────────────────────────────────────

def test_build_slice_perturbed_counts_follow_the_cell_keys(river, mixed):
    """Every published count is sdc.perturb(true count, sum of its people's record keys, floor)."""
    df = keyed(mixed)
    sl = river.build_slice(df, ["s0", "now"])
    folded = df.copy()
    folded.loc[folded.s0_family.isin(["law", "arts_media"]), "s0_family"] = river.SMALL
    assert sl["n"] == sdc.perturb(len(df), df.rkey.sum(), KF)
    tech = folded[folded.s0_family == "tech"]
    assert sl["totals"]["s0"]["tech"] == sdc.perturb(len(tech), tech.rkey.sum(), KF)
    shopify = tech[tech.s0_employer == "Shopify"]
    assert {"name": "Shopify", "n": sdc.perturb(len(shopify), shopify.rkey.sum(), KN)} in \
        sl["details"]["s0"]["tech"]["employers"]
    assert set(sl["totals"]["s0"]) == {"tech", "finance_accounting", "further_study", "smaller_groups"}


def test_perturbed_counts_never_go_below_their_floor(river):
    """A 5-person family can be published as 5..7, never 3 or 4; a 10-person employer as 10..12."""
    rng = random.Random(6)
    seen_field, seen_named = set(), set()
    for i in range(80):
        df = keyed(frame(people(40, s0_family="tech", s0_employer="Big", now_family="tech"),
                         people(5, s0_family="law", s0_employer="Firm", now_family="law"),
                         people(10, s0_family="consulting", s0_employer="McK", now_family="consulting")),
                   salt=f"floor-salt-{rng.random()}")
        sl = river.build_slice(df, ["s0", "now"])
        seen_field.add(sl["totals"]["s0"]["law"])
        seen_named.update(e["n"] for e in sl["details"]["s0"]["consulting"]["employers"])
    assert min(seen_field) == KF and seen_field <= {5, 6, 7}
    assert min(seen_named) == KN and seen_named <= {10, 11, 12}


def test_fit_links_caps_each_link_at_its_nodes(river):
    totals = {"s0": {"tech": 20, "law": 30}, "now": {"tech": 12}}
    links = [{"from_stage": "s0", "from": "tech", "to_stage": "now", "to": "tech", "n": 14}]
    river.fit_links(links, totals)
    assert links[0]["n"] == 12


def test_fit_links_shrinks_the_largest_links_to_fit_a_node(river):
    totals = {"s0": {"tech": 40}, "now": {"tech": 30, "law": 30, "finance_accounting": 30}}
    links = [{"from_stage": "s0", "from": "tech", "to_stage": "now", "to": t, "n": n}
             for t, n in (("tech", 20), ("law", 12), ("finance_accounting", 11))]   # 43 > 40
    assert river.fit_links(links, totals) == (1, 0)
    assert [l["n"] for l in links] == [17, 12, 11]
    assert totals["s0"]["tech"] == 40


def test_fit_links_never_goes_below_the_floor_and_raises_the_node_instead(river):
    totals = {"s0": {"tech": 9}, "now": {"tech": 30, "law": 30}}
    links = [{"from_stage": "s0", "from": "tech", "to_stage": "now", "to": t, "n": KF} for t in ("tech", "law")]
    assert river.fit_links(links, totals) == (0, 1)
    assert [l["n"] for l in links] == [KF, KF] and totals["s0"]["tech"] == 10


def test_build_slice_perturbed_invariants_fuzz(river):
    """With real record keys: nothing under its floor, every published count within the noise
    bound of the true one (links may be trimmed further to fit), and links always fit inside
    their nodes."""
    rng = random.Random(1859)
    for _ in range(40):
        stages = rng.choice(STAGE_CHOICES)
        df = keyed(random_slice(rng, stages), salt=f"fuzz-salt-{rng.random()}")
        exact = river.build_slice(df.assign(rkey=0), stages)
        sl = river.build_slice(df, stages)
        assert violations(sl) == []
        assert abs(sl["n"] - exact["n"]) <= sdc.MAX_NOISE
        for s in stages:
            assert set(sl["totals"][s]) == set(exact["totals"][s])
            for fam, v in sl["totals"][s].items():
                assert abs(v - exact["totals"][s][fam]) <= sdc.MAX_NOISE or v > exact["totals"][s][fam]
        assert {(l["from_stage"], l["from"], l["to"]) for l in sl["links"]} == \
               {(l["from_stage"], l["from"], l["to"]) for l in exact["links"]}
        exact_links = links_of(exact)
        for key, v in links_of(sl).items():
            assert v <= exact_links[key] + sdc.MAX_NOISE
        out, inn = {}, {}
        for l in sl["links"]:
            assert l["n"] <= min(sl["totals"][l["from_stage"]][l["from"]], sl["totals"][l["to_stage"]][l["to"]])
            out[(l["from_stage"], l["from"])] = out.get((l["from_stage"], l["from"]), 0) + l["n"]
            inn[(l["to_stage"], l["to"])] = inn.get((l["to_stage"], l["to"]), 0) + l["n"]
        for (st, fam), total in list(out.items()) + list(inn.items()):
            assert total <= sl["totals"][st][fam]
        ex_years = years_of(exact)
        assert [p["year"] for p in sl["years"]] == [p["year"] for p in exact["years"]]
        for p in sl["years"]:
            n, fields = ex_years[p["year"]]
            assert abs(p["n"] - n) <= sdc.MAX_NOISE and p["n"] <= sl["n"]
            assert {f for f, _ in p["fields"]} == set(fields)
            for f, v in p["fields"]:
                assert v <= p["n"] and (abs(v - fields[f]) <= sdc.MAX_NOISE or v == p["n"])


# ── Slice grid (build_slices) and main() ─────────────────────────────────────

def paths_frame():
    """A synthetic paths.parquet: who is in which slice is known exactly. Every year is set up
    to the June of 2025 and NULL after, as 06_paths writes them."""
    rows = []

    def add(n, prefix, level_group, program, grad_year, cred_rank=1, start=0, **stages):
        years = {f"y{y}_family": ("tech" if grad_year + y <= 2025 else None) for y in range(1, 21)}
        for i in range(start, start + n):
            rows.append({"cred_id": f"{prefix}{i}:{cred_rank}", "person_id": f"{prefix}{i}",
                         "cred_rank": cred_rank, "level_group": level_group, "program": program,
                         "grad_year": grad_year, "s0_family": "tech", **years,
                         "now_family": "tech", "s0_employer": "Shopify", "s0_title": "Developer", **stages})

    add(60, "eco", "undergrad", "Economics", 2017)
    add(10, "eco", "undergrad", "Economics", 2018, cred_rank=2)                    # same people, 2nd entry
    add(12, "eco", "mba", "MBA", 2012, cred_rank=3, start=20)                      # 12 of them also did an MBA
    add(55, "mba", "mba", "MBA", 2010)
    add(30, "unk", "undergrad_or_unknown", "History", 2019)
    add(40, "hist", "graduate", "History", 2012)                                    # under MIN_SLICE
    add(20, "noprog", "undergrad", None, 2017)
    add(5, "old", "undergrad", "Economics", 1994)                                   # before the river
    add(5, "new", "undergrad", "Economics", 2025)                                   # after it
    return frame(rows)


# The synthetic groups below are sized around a 50-person minimum slice; the real constant is the
# owner's choice and can change, so these grid tests pin it.
GRID_MIN_SLICE = 50


@pytest.fixture(scope="module")
def grid(river):
    saved, river.MIN_SLICE = river.MIN_SLICE, GRID_MIN_SLICE
    try:
        return {(s["level"], s["program"], s["cohort"]): s for s in river.build_slices(paths_frame())}
    finally:
        river.MIN_SLICE = saved


def test_slice_grid_keys(grid):
    assert set(grid) == {
        ("all", "all", "2015-2019"), ("all", "all", "2010-2014"), ("all", "all", "all"),
        ("undergrad", "all", "2015-2019"), ("undergrad", "all", "all"),
        ("undergrad", "Economics", "2015-2019"), ("undergrad", "Economics", "all"),
        ("mba", "all", "2010-2014"), ("mba", "all", "all"), ("mba", "MBA", "2010-2014"), ("mba", "MBA", "all"),
    }


@pytest.mark.parametrize("key, n", [
    (("all", "all", "all"), 60 + 55 + 30 + 40 + 20),           # each person once (first credential), 1995-2024
    (("all", "all", "2015-2019"), 60 + 30 + 20),
    (("all", "all", "2010-2014"), 55 + 40),                     # the Economics grads' MBAs aren't first credentials
    (("undergrad", "all", "2015-2019"), 60 + 20),               # each person once per level
    (("undergrad", "Economics", "2015-2019"), 60),              # second Economics entries deduplicated
    (("mba", "all", "2010-2014"), 55 + 12),                     # everyone with an MBA, even as a later degree
    (("mba", "MBA", "all"), 55 + 12),
], ids=str)
def test_slice_sizes(grid, key, n):
    assert grid[key]["n"] == n


def test_slice_stages_follow_cohort(grid):
    assert grid[("all", "all", "2015-2019")]["stages"] == ["s0", "y3", "y5", "now"]
    assert grid[("all", "all", "2010-2014")]["stages"] == ["s0", "y3", "y5", "y10", "now"]
    assert grid[("all", "all", "all")]["stages"] == ["s0", "now"]


def test_slice_years_go_past_the_sankey(grid):
    """2015-2019 (grads of 2017 and 2019): Sankey stops at year 5, the series reaches year 8,
    the 2017 grads' last June; years 7-8 count only the 2017 grads."""
    years = years_of(grid[("all", "all", "2015-2019")])
    assert {y: n for y, (n, _) in years.items()} == {**{y: 110 for y in range(0, 7)}, 7: 80, 8: 80, "now": 110}
    years = years_of(grid[("all", "all", "all")])
    assert years[13] == (95, {"tech": 95}) and years[15] == (55, {"tech": 55}) and 16 not in years


@pytest.mark.parametrize("year, cohort", [
    (1994, None), (1995, "1995-1999"), (1999, "1995-1999"), (2000, "2000-2004"),
    (2024, "2020-2024"), (2025, None),
])
def test_cohort_band_boundaries(river, year, cohort):
    df = frame([dict(cred_id=f"p{i}:1", person_id=f"p{i}", cred_rank=1, level_group="undergrad",
                     program="Economics", grad_year=year, s0_family="tech", now_family="tech",
                     **{f"y{y}_family": ("tech" if year + y <= 2025 else None) for y in range(1, 21)})
                for i in range(60)])
    found = {s["cohort"] for s in river.build_slices(df) if s["level"] == "all"}
    assert found == (set() if cohort is None else {cohort, "all"})


def test_no_slice_for_unknown_level_group(grid):
    assert not [k for k in grid if k[0] == "undergrad_or_unknown"]


def test_level_slice_matches_twin_level_members(river):
    """A level slice holds everyone with a credential at that level, each once with their first
    credential there: the same people as the Career Twin level group (08_export_site members),
    so the two views publish the same cells."""
    df = paths_frame()
    df = df[df.grad_year.between(1995, 2024) & (df.level_group == "mba")]
    members = df.sort_values("cred_rank").drop_duplicates("person_id")
    grid = {(s["level"], s["program"], s["cohort"]): s for s in river.build_slices(paths_frame())}
    assert grid[("mba", "all", "all")]["n"] == len(members) == grid[("mba", "MBA", "all")]["n"]


def test_main_writes_checked_json(river, tmp_path, capsys, monkeypatch):
    monkeypatch.setattr(river, "MIN_SLICE", GRID_MIN_SLICE)
    paths_parquet = tmp_path / "paths.parquet"
    paths_frame().to_parquet(paths_parquet)
    out = tmp_path / "agg" / "river.json"
    river.main(paths=paths_parquet, out=out, salt=TEST_SALT)
    data = json.loads(out.read_text())
    assert set(data) == {"meta", "slices"}
    assert data["meta"]["k"] == {"field": KF, "named": KN}
    assert data["meta"]["min_slice"] == river.MIN_SLICE and data["meta"]["min_year"] == river.MIN_YEAR
    assert list(data["meta"]["stages"]) == list(STAGES)
    assert len(data["slices"]) == 11
    assert ps.file_k(data) == (KF, KN)
    assert ps.k_violations(data) == [] and ps.structural_violations(data) == []
    assert ps.forbidden_keys(data) == [] and ps.string_violations(data) == {}
    assert "11 slices" in capsys.readouterr().out


def test_main_is_reproducible(river, tmp_path):
    df = paths_frame()
    df.to_parquet(tmp_path / "a.parquet")
    df.sample(frac=1, random_state=1).to_parquet(tmp_path / "b.parquet")
    river.main(paths=tmp_path / "a.parquet", out=tmp_path / "a.json", salt=TEST_SALT)
    river.main(paths=tmp_path / "b.parquet", out=tmp_path / "b.json", salt=TEST_SALT)
    assert (tmp_path / "a.json").read_text() == (tmp_path / "b.json").read_text()


def test_main_perturbs_with_the_salt(river, tmp_path):
    """Same salt: same numbers (above). Another salt: other noise, so the salt must stay secret.
    Either way every published size is within the noise bound of the truth."""
    df = paths_frame()
    df.to_parquet(tmp_path / "p.parquet")
    river.main(paths=tmp_path / "p.parquet", out=tmp_path / "a.json", salt=TEST_SALT)
    river.main(paths=tmp_path / "p.parquet", out=tmp_path / "b.json", salt=TEST_SALT[::-1])
    a, b = (json.loads((tmp_path / f).read_text())["slices"] for f in ("a.json", "b.json"))
    assert [s["n"] for s in a] != [s["n"] for s in b]
    exact = {(s["level"], s["program"], s["cohort"]): s["n"] for s in river.build_slices(df)}
    for s in a + b:
        assert abs(s["n"] - exact[(s["level"], s["program"], s["cohort"])]) <= sdc.MAX_NOISE


def test_main_uses_the_salt_file(river, tmp_path, monkeypatch):
    """Without an explicit salt, main() reads data/secret/cellkey_salt.txt (creating it once)."""
    paths_frame().to_parquet(tmp_path / "p.parquet")
    monkeypatch.chdir(tmp_path)
    river.main(paths=tmp_path / "p.parquet", out=tmp_path / "a.json")
    salt = (tmp_path / sdc.SALT_PATH).read_text().strip()
    river.main(paths=tmp_path / "p.parquet", out=tmp_path / "b.json")
    river.main(paths=tmp_path / "p.parquet", out=tmp_path / "c.json", salt=salt)
    texts = {(tmp_path / f).read_text() for f in ("a.json", "b.json", "c.json")}
    assert len(texts) == 1


# ── self_check ───────────────────────────────────────────────────────────────

def good_slice():
    return {"n": 60, "links": [{"n": 5}], "totals": {"s0": {"tech": 60, "law": 5}}, "suppressed": None,
            "details": {"s0": {"tech": {"employers": [{"name": "X", "n": 10}], "titles": []}}},
            "years": [{"year": 0, "n": 60, "fields": [["tech", 55], ["law", 5]]},
                      {"year": 4, "n": 12, "fields": [["tech", 12]]}]}


def test_self_check_passes_and_returns_counts(river):
    assert sorted(river.self_check([good_slice()])) == [5, 5, 5, 10, 12, 12, 55, 60, 60, 60]


@pytest.mark.parametrize("mutate", [
    lambda s: s["links"][0].update(n=4),
    lambda s: s["totals"]["s0"].update(tech=3),
    lambda s: s.update(suppressed=4),
    lambda s: s["details"]["s0"]["tech"]["employers"][0].update(n=9),       # 9: fine for a family, not a name
    lambda s: s["details"]["s0"]["tech"]["titles"].append({"name": "Y", "n": 5}),
    lambda s: s["years"][1].update(n=4),
    lambda s: s["years"][0]["fields"].append(["founder", 4]),
    lambda s: s["years"][1].update(n=7),                                    # MIN_YEAR - MAX_NOISE - 1
    lambda s: s["years"][1]["fields"][0].__setitem__(1, 13),                # a part over its year's n
    lambda s: s["years"][1].update(n=61),                                   # a year over the slice
    lambda s: s.update(n=47),                                               # MIN_SLICE - sdc.MAX_NOISE - 1
], ids=["link", "total", "suppressed", "employer", "title", "year-n", "year-field", "year-min", "year-part",
        "year-over-slice", "slice-size"])
def test_self_check_rejects_small_counts(river, mutate):
    s = good_slice()
    mutate(s)
    with pytest.raises(AssertionError):
        river.self_check([s])
