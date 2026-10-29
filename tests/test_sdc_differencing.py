"""
Regression test for the differencing attacks found by the privacy audit, run against the real
exporters (07 River, 08 Career Twin) on synthetic programs that each hide a one-person cohort.

The attack (ported from the auditor's twin_cohort_diff.py and river_cohort_diff.py): a program's
"all cohorts" number minus its published cohorts' numbers leaves the unpublished cohorts.
With exact counts that recovers the hidden person exactly (here: that one 1995-1999 grad
exists and is a Partner today; 2000-2004 and 2005-2009 are empty, which the attacker can't
tell from hidden). With cell-key perturbation the estimate is the truth plus the sum of
several independent noise draws: it is right only by chance, and the attacker can't tell
when, since every value in a range of several stays possible.

Runs under the hybrid floors (sdc.K_FIELD = 5 for career-field counts, K_NAMED = 10 for
employers/titles/places); test_hybrid_floor_* add attacks on cells that only the lower
field floor publishes.
"""

import duckdb
import pandas as pd
import pytest

import sdc
from conftest import ROLES_SCHEMA, load_pipeline, write_parquet

COHORTS = ["1995-1999", "2000-2004", "2005-2009", "2010-2014", "2015-2019", "2020-2024"]
# One grad in 1997 (the hidden cohort), then three cohorts big enough to publish.
SIZES = {1997: 1, 2010: 192, 2018: 128, 2022: 79}
PROGRAMS = [f"Program {i:02d}" for i in range(16)]
SALT = "differencing-test-salt-0123456789"


def program_rows(program):
    rows = []
    for year, n in SIZES.items():
        for i in range(n):
            partner = n == 1 or i % 4 == 0          # the hidden grad is a Partner; so is 1 in 4 of the rest
            rows.append({
                "person_id": f"{program}/{year}/{i}", "cred_rank": 1, "level_group": "graduate",
                "program": program, "grad_year": year,
                "s0_family": "healthcare", "s0_employer": "Hospital", "s0_title": "Therapist",
                **{f"y{y}_family": "healthcare" if year + y <= 2025 else None for y in range(1, 21)},
                **{f"y{y}_{f}": None for y in (3, 5, 10, 20) for f in ("employer", "title")},
                "now_family": "law" if partner else "healthcare", "now_employer": "Hospital",
                "now_title": "Partner" if partner else "Therapist", "now_seniority": "mid",
            })
    return rows


@pytest.fixture(scope="module")
def world():
    return pd.DataFrame([r for p in PROGRAMS for r in program_rows(p)])


def with_keys(df, salt):
    """rkey = 0 (exact, the export before this change) or the person's record key."""
    df = df.copy()
    df["rkey"] = 0 if salt is None else sdc.rkeys(df["person_id"], salt)
    df["rkey"] = df["rkey"].astype("int64")
    return df


def twin_groups(df, tmp_path_factory):
    """Run 08_export_site.build_twin on the synthetic paths."""
    site = load_pipeline("08_export_site")
    derived = tmp_path_factory.mktemp("derived")
    write_parquet(derived / "roles.parquet", [], ROLES_SCHEMA)       # nobody is a manager
    con = duckdb.connect()
    con.register("paths_df", df)
    con.sql("CREATE TABLE paths AS SELECT * FROM paths_df")
    alumni = pd.DataFrame({"person_id": df.person_id.unique()}).assign(home_country="CA", home_metro="Kingston|CA")
    con.register("alumni_df", alumni)
    con.sql("CREATE TABLE alumni AS SELECT * FROM alumni_df")
    mp = pytest.MonkeyPatch()
    try:
        mp.setattr(site, "DERIVED", derived.as_posix())
        twin = site.build_twin(con, [], {})
    finally:
        mp.undo()
    return {(g["level"], g["program"], g["cohort"], g["s0"]): g for g in twin["groups"]}


def river_slices(df):
    river = load_pipeline("07_export_river")
    return {(s["level"], s["program"], s["cohort"]): s for s in river.build_slices(df)}


# ── The attacks (auditor's logic) ─────────────────────────────────────────────

def twin_attrs(g):
    a = {("n",): g["n"]}
    for p in g["years"]:
        a[("yearN", p["year"])] = p["n"]
        for f, v in p["fields"]:
            a[("outcome", p["year"], f)] = v
    for k in ("employersNow", "titlesNow", "employersFirst"):
        for e in g[k]:
            a[(k, e["name"])] = e["n"]
    return a


def twin_cohort_attack(groups, program, key):
    """(estimate of the unpublished cohorts' `key`, number of published terms used), or None
    when the parent or a published cohort lacks the cell."""
    parent = groups.get(("graduate", program, "*", "*"))
    kids = [g for c in COHORTS if (g := groups.get(("graduate", program, c, "*"))) is not None]
    if parent is None or key not in twin_attrs(parent) or len(kids) == len(COHORTS):
        return None
    known = [twin_attrs(k)[key] for k in kids if key in twin_attrs(k)]
    if len(known) != len(kids):
        return None
    return twin_attrs(parent)[key] - sum(known), 1 + len(known)


def river_cohort_attack(slices, program):
    parent = slices.get(("graduate", program, "all"))
    kids = [s for c in COHORTS if (s := slices.get(("graduate", program, c))) is not None]
    if parent is None or len(kids) == len(COHORTS):
        return None
    return parent["n"] - sum(k["n"] for k in kids), 1 + len(kids)


# ── Tests ────────────────────────────────────────────────────────────────────

@pytest.fixture(scope="module")
def exact(world, tmp_path_factory):
    df = with_keys(world, None)
    return twin_groups(df, tmp_path_factory), river_slices(df)


@pytest.fixture(scope="module")
def perturbed(world, tmp_path_factory):
    df = with_keys(world, SALT)
    return twin_groups(df, tmp_path_factory), river_slices(df)


ATTACKS = [
    ("twin n", lambda twin, river, p: twin_cohort_attack(twin, p, ("n",))),
    ("twin titlesNow Partner", lambda twin, river, p: twin_cohort_attack(twin, p, ("titlesNow", "Partner"))),
    ("twin outcome now law", lambda twin, river, p: twin_cohort_attack(twin, p, ("outcome", "now", "law"))),
    ("twin year 1 n", lambda twin, river, p: twin_cohort_attack(twin, p, ("yearN", 1))),
    ("river n", lambda twin, river, p: river_cohort_attack(river, p)),
]


@pytest.mark.parametrize("name, attack", ATTACKS, ids=[a[0] for a in ATTACKS])
def test_without_noise_the_attack_recovers_the_hidden_person(exact, name, attack):
    """The baseline the audit found: exact tables give the hidden one-person cohort away."""
    twin, river = exact
    for p in PROGRAMS:
        estimate, _ = attack(twin, river, p)
        assert estimate == 1, (name, p)


@pytest.mark.parametrize("name, attack", ATTACKS, ids=[a[0] for a in ATTACKS])
def test_with_noise_the_attack_no_longer_recovers_it(perturbed, name, attack):
    twin, river = perturbed
    estimates = []
    for p in PROGRAMS:
        result = attack(twin, river, p)
        assert result is not None, "the cohort structure is still published; only the numbers moved"
        estimate, terms = result
        estimates.append(estimate)
        # Each published term is within MAX_NOISE of the truth, so the truth stays inside the
        # attacker's interval ...
        assert abs(estimate - 1) <= sdc.MAX_NOISE * terms
        # ... and that interval never pins down a single value.
        lo, hi = max(0, estimate - sdc.MAX_NOISE * terms), estimate + sdc.MAX_NOISE * terms
        assert hi > lo
    right = sum(e == 1 for e in estimates)
    assert right <= len(PROGRAMS) // 2, f"{name}: {right}/{len(PROGRAMS)} exact recoveries"
    assert len(set(estimates)) >= 3, f"{name}: estimates {estimates} barely vary"


def test_same_people_same_number_across_views(perturbed):
    """River and Twin publish the same cells for the same people: with cell keys they get the
    same noise, so the two copies can't be averaged."""
    twin, river = perturbed
    published = ["2010-2014", "2015-2019", "2020-2024"]
    for p in PROGRAMS:
        assert river[("graduate", p, "all")]["n"] == twin[("graduate", p, "*", "*")]["n"]
        assert river[("graduate", "all", "all")]["n"] == twin[("graduate", "*", "*", "*")]["n"]
        for c in published:
            r, t = river[("graduate", p, c)], twin[("graduate", p, c, "*")]
            assert r["n"] == t["n"]
            ty = {q["year"]: q for q in t["years"]}
            assert r["totals"]["s0"]["healthcare"] == dict(ty[0]["fields"])["healthcare"]
            shared = [q for q in r["years"] if q["year"] in ty]
            assert shared and all(q == ty[q["year"]] for q in shared)


def test_published_numbers_stay_close_to_the_truth(exact, perturbed):
    """Utility: every published Twin number is within MAX_NOISE of the exact one (and >= k)."""
    for key, g in exact[0].items():
        ex, pt = twin_attrs(g), twin_attrs(perturbed[0][key])
        assert set(ex) == set(pt)                      # the same cells are published
        for attr, v in ex.items():
            assert abs(pt[attr] - v) <= sdc.MAX_NOISE and pt[attr] >= sdc.K


# ── Hybrid floor: cells of 5-9 people are published (career-field counts only) ──────────────
# Each program: a hidden 1995-1999 cohort of 2 people, both in law today, and three published
# cohorts whose law cells hold 6, 7 and 5 people. With a floor of 10 those cohort cells were
# hidden, so the attack had nothing to subtract; at the field floor of 5 they are published,
# and parent (20) minus the three cohort cells (18) would give the hidden cell (2) exactly
# without noise.

HYBRID_SIZES = {1997: (2, 2), 2010: (60, 6), 2018: (50, 7), 2022: (45, 5)}   # year: (people, in law now)
HYBRID_PROGRAMS = [f"Hybrid {i:03d}" for i in range(48)]


def hybrid_world():
    rows = []
    for program in HYBRID_PROGRAMS:
        for year, (n, law) in HYBRID_SIZES.items():
            for i in range(n):
                rows.append({
                    "person_id": f"{program}/{year}/{i}", "cred_rank": 1, "level_group": "graduate",
                    "program": program, "grad_year": year,
                    "s0_family": "healthcare", "s0_employer": None, "s0_title": None,
                    **{f"y{y}_family": "healthcare" if year + y <= 2025 else None for y in range(1, 21)},
                    **{f"y{y}_{f}": None for y in (3, 5, 10, 20) for f in ("employer", "title")},
                    "now_family": "law" if i < law else "healthcare", "now_employer": None,
                    "now_title": None, "now_seniority": "mid",
                })
    return pd.DataFrame(rows)


LAW_NOW = ("outcome", "now", "law")


def test_hybrid_floor_without_noise_publishes_the_small_cells(tmp_path_factory):
    """Baseline: at the field floor the 5-7 cells are published, so exact tables would give the
    hidden 2-person cell away."""
    twin = twin_groups(with_keys(hybrid_world(), None), tmp_path_factory)
    for p in HYBRID_PROGRAMS:
        assert twin_cohort_attack(twin, p, LAW_NOW) == (2, 4)


def test_hybrid_floor_old_floor_published_nothing_to_subtract(tmp_path_factory):
    """With a floor of 10 everywhere (the previous rule) the cohort law cells were suppressed."""
    site = load_pipeline("08_export_site")
    mp = pytest.MonkeyPatch()
    try:
        mp.setattr(site, "K_FIELD", 10)
        twin = twin_groups(with_keys(hybrid_world(), None), tmp_path_factory)
    finally:
        mp.undo()
    assert all(twin_cohort_attack(twin, p, LAW_NOW) is None for p in HYBRID_PROGRAMS)


def test_hybrid_floor_with_noise_the_small_cells_dont_give_it_away(tmp_path_factory):
    twin = twin_groups(with_keys(hybrid_world(), SALT), tmp_path_factory)
    estimates = []
    for p in HYBRID_PROGRAMS:
        result = twin_cohort_attack(twin, p, LAW_NOW)
        assert result is not None
        estimate, terms = result
        estimates.append(estimate)
        assert abs(estimate - 2) <= sdc.MAX_NOISE * terms
        for c, (n, law) in zip(COHORTS[3:], list(HYBRID_SIZES.values())[1:]):
            published = dict(next(q for q in twin[("graduate", p, c, "*")]["years"] if q["year"] == "now")["fields"])
            assert sdc.K_FIELD <= published["law"] <= law + sdc.MAX_NOISE      # never under the floor
    right = sum(e == 2 for e in estimates)
    # Four noisy terms, three of them near the floor: about 1 in 5 estimates lands on the truth by
    # chance, and the attacker can't tell which.
    assert right <= len(HYBRID_PROGRAMS) // 3, f"{right}/{len(HYBRID_PROGRAMS)} exact recoveries"
    assert len(set(estimates)) >= 4, f"estimates {sorted(estimates)} barely vary"

