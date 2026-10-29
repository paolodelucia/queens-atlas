"""Cross-module consistency: the label taxonomy (label_spec), the clean-up rules (05), the
career-path vocabulary (06), the River export (07) and the site's data contract (types.ts)."""

import re

import pytest

import label_spec
from conftest import ROOT

TYPES_TS = ROOT / "site" / "src" / "data" / "types.ts"


def test_industry_overrides_use_known_values(join):
    for ind, fn in {**join.INDUSTRY_FN, **join.INDUSTRY_FN_NARROW}.items():
        assert ind in label_spec.INDUSTRIES, ind
        assert fn in label_spec.FUNCTIONS, fn
    assert set(join.GENERIC_FNS) <= set(label_spec.FUNCTIONS)
    assert set(join.INDUSTRY_FN).isdisjoint(join.INDUSTRY_FN_NARROW)
    assert {ind for ind, _ in join.NAME_INDUSTRY} <= set(label_spec.INDUSTRIES)
    assert "student_organization" in label_spec.INDUSTRIES   # 05 flags these roles as side roles


def test_disciplines_are_known(join):
    discs = {d for _, _, d in join.DEGREE_PROGRAM} | {d for _, d in join.LEVEL_PROGRAM.values()}
    assert discs <= set(label_spec.DISCIPLINES)


def test_level_program_levels_exist(join):
    assert set(join.LEVEL_PROGRAM) <= {name for name, _ in join.LEVELS}


def test_every_function_has_a_family(paths_mod):
    assert set(paths_mod.FAMILY) == set(label_spec.FUNCTIONS)


def test_level_tables_cover_every_degree_level(join, paths_mod):
    levels = {name for name, _ in join.LEVELS} - {"certificate"} | {"unknown"}
    assert set(paths_mod.LEVEL_RANK) == levels
    assert set(paths_mod.LEVEL_GROUP) == levels
    assert set(paths_mod.GRAD_LEVELS) <= levels
    assert "bachelor" not in paths_mod.GRAD_LEVELS and "unknown" not in paths_mod.GRAD_LEVELS
    ranks = list(paths_mod.LEVEL_RANK.values())
    assert len(ranks) == len(set(ranks))


def test_river_level_groups_exist(paths_mod, river):
    assert set(river.LEVEL_GROUPS) <= set(paths_mod.LEVEL_GROUP.values())


def test_river_cohorts(river):
    for cohort, lo, hi in river.COHORTS:
        assert lo <= hi and hi < river.SNAPSHOT_YEAR
        if cohort != "all":
            assert cohort == f"{lo}-{hi}"
    spans = sorted((lo, hi) for c, lo, hi in river.COHORTS if c != "all")
    assert all(a[1] + 1 == b[0] for a, b in zip(spans, spans[1:])), "cohorts must not overlap or leave gaps"
    assert dict((c, (lo, hi)) for c, lo, hi in river.COHORTS)["all"] == (spans[0][0], spans[-1][1])


def test_snapshot_constants_agree(paths_mod, river):
    assert paths_mod.SNAPSHOT_YM // 100 == river.SNAPSHOT_YEAR


# ── site/src/data/types.ts ───────────────────────────────────────────────────

def ts_union(name):
    if not TYPES_TS.exists():
        pytest.skip("site/src/data/types.ts not found")
    src = TYPES_TS.read_text(encoding="utf-8")
    m = re.search(rf"export type {name}\s*=(.*?);", src, re.S)
    assert m, f"type {name} not found in types.ts"
    body = re.sub(r"/\*.*?\*/|//[^\n]*", "", m.group(1), flags=re.S)
    return set(re.findall(r"'([^']+)'", body))


def test_families_match_site_contract(paths_mod, river):
    families = set(paths_mod.FAMILY.values()) | {"further_study", "no_role_listed", river.SMALL}
    assert families == ts_union("FamilyId")


def test_levels_match_site_contract(river):
    assert set(river.LEVEL_GROUPS) | {"all"} == ts_union("LevelId")


def test_cohorts_match_site_contract(river):
    assert {c for c, _, _ in river.COHORTS} == ts_union("CohortId")


def test_stages_match_site_contract(river):
    stages = {"s0", "now"} | {f"y{y}" for y in river.SANKEY_YEARS}
    assert stages == ts_union("StageId") == set(river.STAGE_LABELS)
    assert list(river.STAGE_LABELS) == river.stages_for(1995)        # labels in column order


def test_diaspora_cohorts_match_site_contract(site):
    assert {c for c, _, _ in site.DIASPORA_COHORTS} | {"all"} == ts_union("DiasporaCohortId")


def test_twin_cohorts_are_the_river_bands(river, site):
    assert site.TWIN_COHORTS == [c for c in river.COHORTS if c[0] != "all"]
    assert site.DIASPORA_COHORTS == [("pre-1995", 1900, 1994)] + site.TWIN_COHORTS


@pytest.mark.parametrize("year, river_band, diaspora_band", [
    (1990, None, "pre-1995"), (1994, None, "pre-1995"), (1995, "1995-1999", "1995-1999"),
    (1999, "1995-1999", "1995-1999"), (2000, "2000-2004", "2000-2004"), (2014, "2010-2014", "2010-2014"),
    (2015, "2015-2019", "2015-2019"), (2024, "2020-2024", "2020-2024"), (2025, None, None),
])
def test_cohort_band_boundaries(river, site, year, river_band, diaspora_band):
    """Five-year bands, no gaps or overlaps; 2025 grads are in no band (only in 'all' on the
    Diaspora, nowhere on the River/Twin), and pre-1995 grads only on the Diaspora."""
    band = lambda cohorts: next((c for c, lo, hi in cohorts if c != "all" and lo <= year <= hi), None)
    assert band(river.COHORTS) == band(site.TWIN_COHORTS) == river_band
    assert band(site.DIASPORA_COHORTS) == diaspora_band
    import duckdb
    case = site.cohort_case(str(year), site.DIASPORA_COHORTS)
    assert duckdb.sql(f"SELECT {case}").fetchall()[0][0] == diaspora_band


def test_cohort_bands_are_five_years(river):
    for c, lo, hi in river.COHORTS:
        if c != "all":
            assert hi - lo == 4 and lo % 5 == 0


def test_river_and_twin_share_series_rules(river, site, paths_mod):
    """Same people, same numbers: the two exporters must agree on the floors and on which
    points of the trajectory exist."""
    import sdc
    assert (river.K_FIELD, river.K_NAMED) == (site.K_FIELD, site.K_NAMED) == (sdc.K_FIELD, sdc.K_NAMED)
    assert river.MIN_YEAR == site.MIN_YEAR and river.SMALL == site.SMALL
    assert set(site.TWIN_YEARS) <= set(river.SERIES_YEARS)
    assert {0, *river.SANKEY_YEARS} <= set(site.TWIN_YEARS)
    assert set(river.SERIES_YEARS) - {0} == set(paths_mod.YEARS)
    for y in (*site.TWIN_YEARS, "now"):
        assert site.series_col(y) == river.series_col(y)


def test_seniority_matches_site_contract():
    assert set(label_spec.SENIORITY) == ts_union("SeniorityId")
