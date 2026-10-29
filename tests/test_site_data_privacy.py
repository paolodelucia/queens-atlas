"""
Privacy gate for everything the site publishes (site/public/data/*.json), plus the export
staging area (data/aggregates/*.json) when it exists locally.

1. no keys that suggest per-person data (names, urls, profile ids, emails, avatars, ...)
2. no strings that are linkedin profile urls, http urls, emails or profile-id-like values
3. schema-aware k-check: every people count >= its floor: 5 for counts by career field or
   state, 10 for anything naming an employer, title or place (file's own floors if present,
   never below those)
4. with the local people.parquet: no exported string equals a person's full name or profile id
   (failures report how many matched, never which)

The first half tests the scanner itself on samples shaped like every file in
site/src/data/types.ts, so files that don't exist yet (diaspora, twin, insights, meta) are
covered as soon as they appear.
"""

import copy
import json

import pytest

import privacy_scan as ps
from conftest import ROLES_SCHEMA, ROOT, write_parquet

SITE_DATA = ROOT / "site" / "public" / "data"
STAGING = ROOT / "data" / "aggregates"
PEOPLE = ROOT / "data" / "processed" / "people.parquet"
ROLES = ROOT / "data" / "derived" / "roles.parquet"

# ── Samples of every file in types.ts ────────────────────────────────────────
# Counts are >= 10; non-count numbers are deliberately small or negative (years: 5, pct: 2,
# lon: -79, counts of employers: 3, year: 0) so a misclassified field shows up as a violation.

SAMPLES = {
    "meta.json": {
        "generated": "2026-10-27", "snapshot": "2025-09", "k": {"field": 5, "named": 10},
        "counts": {"profiles": 95020, "alumni": 92910, "roles": 437091, "employers": 3, "countries": 4,
                   "metros": 5, "paths": 61648, "firstYear": 1995, "lastYear": 2024},
        "programs": [{"level": "undergrad", "program": "Commerce", "discipline": "business_commerce", "n": 4000}],
        "cohorts": [{"id": "1995-1999", "label": "Class of 1995–1999", "from": 1995, "to": 1999}],
    },
    "river.json": {
        "meta": {"generated": "2026-10-27", "snapshot": "2025-09", "k": {"field": 5, "named": 10},
                 "min_slice": 50, "min_year": 10,
                 "stages": {"s0": "First destination", "y3": "Year 3", "now": "Today"}, "note": "..."},
        "slices": [{
            "level": "all", "program": "all", "cohort": "all", "n": 120, "stages": ["s0", "now"],
            "totals": {"s0": {"tech": 70, "smaller_groups": 50}, "now": {"tech": 120}},
            "links": [{"from_stage": "s0", "from": "tech", "to_stage": "now", "to": "tech", "n": 70}],
            "suppressed": 12,
            "details": {"s0": {"tech": {"employers": [{"name": "Shopify", "n": 11}],
                                        "titles": [{"name": "Software Engineer", "n": 15}]}}},
            "years": [{"year": 0, "n": 120, "fields": [["tech", 70], ["smaller_groups", 50]]},
                      {"year": "now", "n": 120, "fields": [["tech", 120]]}],
        }],
    },
    "diaspora.json": {
        "metros": [{"id": "toronto-on-ca", "name": "Toronto", "region": "Ontario", "country": "CA",
                    "lat": 44, "lon": -79, "n": 20000}],
        "views": [{"level": "all", "program": "all", "cohort": "all", "n": 50000,
                   "metros": [["toronto-on-ca", 20000]], "countries": [["CA", 45000], ["US", 3000]]}],
        "metroDetail": {"toronto-on-ca": {
            "families": [["tech", 3000]], "employers": [{"name": "RBC", "n": 900}],
            "programs": [{"level": "undergrad", "program": "Commerce", "n": 2000}], "cohorts": [["2005-2009", 7000]]}},
        "flows": [{"from": "kingston-on-ca", "to": "toronto-on-ca", "n": 1500}],
        "abroad": {"byCohort": [{"cohort": "all", "n": 50000, "abroad": 6000, "us": 3000}],
                   "byProgram": [{"level": "undergrad", "program": "Commerce", "n": 4000, "abroad": None, "us": 12}]},
        "kingston": {"firstJobInKingston": 5000, "stillInKingston": 1200, "nowElsewhere": [{"name": "Toronto", "n": 1800}]},
    },
    "twin.json": {
        "min_group": 30, "min_year": 10,
        "groups": [{
            "level": "undergrad", "program": "Commerce", "cohort": "2010-2014", "s0": "*", "n": 300,
            "years": [{"year": 0, "n": 300, "fields": [["finance_accounting", 150]]},
                      {"year": 5, "n": 300, "fields": [["finance_accounting", 120]]},
                      {"year": 10, "n": 250, "fields": [["finance_accounting", 100]]},
                      {"year": "now", "n": 300, "fields": [["finance_accounting", 90]]}],
            "seniorityNow": [["manager", 80]],
            "employersNow": [{"name": "RBC", "n": 25}], "titlesNow": [{"name": "Director", "n": 12}],
            "employersFirst": [{"name": "RBC", "n": 40}], "pivoted": {"n": None, "of": 200},
            "managerBy": [{"years": 5, "n": None, "of": 300}, {"years": 10, "n": 60, "of": 280}],
            "located": 280, "abroad": 30, "us": None, "topMetros": [{"name": "Toronto", "n": 200}],
        }],
    },
    "insights.json": {
        "firstEmployers": [{"name": "Deloitte", "n": 400}], "topEmployers": [{"name": "RBC", "n": 2000}],
        "rankings": [{"id": "tech_now", "label": "Working in tech today", "rows": [
            {"level": "undergrad", "program": "Computing", "n": 500, "hits": 200, "pct": 4.0},
            {"level": "undergrad", "program": "History", "n": 300, "hits": 10, "pct": 3}]}],
        "facts": [{"id": "law-2015", "value": "38%", "text": "38% of law grads ...", "detail": "of 1,234",
                   "link": "/river?level=law&program=Law"}],
        "snapshot": {"currentRolesImplying": [{"month": "2025-09", "pct": 85.1}, {"month": "2025-08", "pct": 2}],
                     "newestActivity": "2025-09-29T20:52:00Z", "exportFileTimestamp": "2025-09-30T02:26:00Z",
                     "asOf": "2025-09-30"},
        "labelling": {"titles": 189821, "employers": 20350, "fields": 12046, "places": 5, "costUsd": 59.0,
                      "model": "claude-sonnet-5-5"},
    },
}

# Exactly which fields the k-check treats as people counts, per types.ts.
EXPECTED_COUNTS = {
    "meta.json": {"counts.profiles", "counts.alumni", "counts.roles", "counts.paths", "programs[].n"},
    "river.json": {"slices[].n", "slices[].totals.s0.tech", "slices[].totals.s0.smaller_groups",
                   "slices[].totals.now.tech", "slices[].links[].n", "slices[].suppressed",
                   "slices[].details.s0.tech.employers[].n", "slices[].details.s0.tech.titles[].n",
                   "slices[].years[].n", "slices[].years[].fields[][]"},
    "diaspora.json": {"metros[].n", "views[].n", "views[].metros[][]", "views[].countries[][]",
                      "metroDetail.toronto-on-ca.families[][]", "metroDetail.toronto-on-ca.employers[].n",
                      "metroDetail.toronto-on-ca.programs[].n", "metroDetail.toronto-on-ca.cohorts[][]",
                      "flows[].n", "abroad.byCohort[].n", "abroad.byCohort[].abroad", "abroad.byCohort[].us",
                      "abroad.byProgram[].n", "abroad.byProgram[].us", "kingston.firstJobInKingston",
                      "kingston.stillInKingston", "kingston.nowElsewhere[].n"},
    "twin.json": {"groups[].n", "groups[].years[].n", "groups[].years[].fields[][]", "groups[].seniorityNow[][]",
                  "groups[].employersNow[].n", "groups[].titlesNow[].n", "groups[].employersFirst[].n",
                  "groups[].pivoted.of", "groups[].managerBy[].n", "groups[].managerBy[].of", "groups[].located",
                  "groups[].abroad", "groups[].topMetros[].n"},
    "insights.json": {"firstEmployers[].n", "topEmployers[].n", "rankings[].rows[].n", "rankings[].rows[].hits"},
}


# Of those, the ones that only need the field floor (5); every other count needs the named floor (10).
EXPECTED_FIELD = {
    "meta.json": {"counts.profiles", "counts.alumni", "counts.roles", "counts.paths", "programs[].n"},
    "river.json": {"slices[].n", "slices[].totals.s0.tech", "slices[].totals.s0.smaller_groups",
                   "slices[].totals.now.tech", "slices[].links[].n", "slices[].suppressed",
                   "slices[].years[].n", "slices[].years[].fields[][]"},
    "diaspora.json": {"views[].n", "abroad.byCohort[].n", "abroad.byCohort[].abroad", "abroad.byCohort[].us",
                      "abroad.byProgram[].n", "abroad.byProgram[].us"},
    "twin.json": {"groups[].n", "groups[].years[].n", "groups[].years[].fields[][]", "groups[].seniorityNow[][]",
                  "groups[].pivoted.of", "groups[].managerBy[].n", "groups[].managerBy[].of", "groups[].located",
                  "groups[].abroad"},
    "insights.json": {"rankings[].rows[].n", "rankings[].rows[].hits"},
}


@pytest.mark.parametrize("name", SAMPLES)
def test_scanner_classifies_every_count_field(name):
    assert {ps.path_str(p) for p, _ in ps.count_paths(SAMPLES[name])} == EXPECTED_COUNTS[name]


@pytest.mark.parametrize("name", SAMPLES)
def test_scanner_applies_the_right_floor(name):
    """Field counts (career families, sizes, shares) at 5; employers, titles and places at 10."""
    paths = ps.count_paths(SAMPLES[name])
    assert {ps.path_str(p) for p, _ in paths if ps.floor_for(p) == ps.K_FIELD_FLOOR} == EXPECTED_FIELD[name]
    assert all(ps.floor_for(p) == ps.K_NAMED_FLOOR for p, _ in paths if ps.path_str(p) not in EXPECTED_FIELD[name])


def test_unknown_count_fields_get_the_named_floor():
    """Deny by default: a count field the scanner has not been told about answers to the stricter floor."""
    data = {"slices": [{"newCount": 7, "years": [{"year": 1, "n": 7, "fields": [["tech", 7]], "other": 7}]}]}
    assert {p for p, _ in ps.k_violations(data)} == {"slices[].newCount", "slices[].years[].other"}


@pytest.mark.parametrize("name", SAMPLES)
def test_scanner_passes_valid_samples(name):
    data = SAMPLES[name]
    assert ps.k_violations(data) == []
    assert ps.structural_violations(data) == []
    assert ps.forbidden_keys(data) == []
    assert ps.string_violations(data) == {}


def _set(data, path, value):
    for p in path[:-1]:
        data = data[p]
    data[path[-1]] = value


@pytest.mark.parametrize("name", SAMPLES)
def test_scanner_flags_each_count_under_its_floor(name):
    for path, _ in ps.count_paths(SAMPLES[name]):
        floor = ps.floor_for(path)
        for small in (floor - 1, 0):
            data = copy.deepcopy(SAMPLES[name])
            _set(data, path, small)
            assert (ps.path_str(path), small) in ps.k_violations(data), ps.path_str(path)
        data = copy.deepcopy(SAMPLES[name])
        _set(data, path, floor)
        assert not [v for v in ps.k_violations(data) if v[0] == ps.path_str(path)], ps.path_str(path)


def test_scanner_uses_file_k_but_never_below_floor():
    data = copy.deepcopy(SAMPLES["river.json"])
    data["meta"]["k"] = {"field": 5, "named": 20}
    assert ("slices[].details.s0.tech.employers[].n", 11) in ps.k_violations(data)
    data["meta"]["k"] = 20
    assert ("slices[].years[].n", 120) not in ps.k_violations(data)
    assert ("slices[].links[].n", 70) not in ps.k_violations(data)
    data["slices"][0]["links"][0]["n"] = 19
    assert ("slices[].links[].n", 19) in ps.k_violations(data)
    assert ps.file_k({"k": 15}) == (15, 15) and ps.file_k({"x": 1}) == (ps.K_FIELD_FLOOR, ps.K_NAMED_FLOOR)
    assert ps.file_k({"k": {"field": 5, "named": 10}}) == (5, 10)


def test_scanner_structural_rules():
    """Sizes are chosen on true counts, so a published (perturbed) size may sit up to
    MAX_NOISE under the threshold, never further."""
    river = copy.deepcopy(SAMPLES["river.json"])
    river["slices"][0]["n"] = 50 - ps.MAX_NOISE
    river["slices"][0]["years"][1]["n"] = 10 - ps.MAX_NOISE
    twin = copy.deepcopy(SAMPLES["twin.json"])
    twin["groups"][0]["n"] = 30 - ps.MAX_NOISE
    twin["groups"][0]["years"][2]["n"] = 10 - ps.MAX_NOISE
    assert ps.structural_violations(river) == [] and ps.structural_violations(twin) == []
    river["slices"][0]["n"] -= 1
    river["slices"][0]["years"][1]["n"] -= 1
    twin["groups"][0]["n"] -= 1
    twin["groups"][0]["years"][2]["n"] -= 1
    assert ps.structural_violations(river) == ["slices[0].n < min_slice", "slices[0].years[1].n < min_year"]
    assert ps.structural_violations(twin) == ["groups[0].n < min_group", "groups[0].years[2].n < min_year"]


@pytest.mark.parametrize("key", ["name_full", "fullName", "first_name", "lastName", "person_id", "personId",
                                 "person", "linkedin_num_id", "linkedinUrl", "profile_url", "profileId",
                                 "url", "avatar", "default_avatar", "email", "eMail", "photo", "headline",
                                 "memberId", "public_identifier"])
def test_scanner_flags_personal_keys(key):
    assert ps.forbidden_keys({"rows": [{key: "x", "n": 12}]}) == [f"rows[].{key}"]


@pytest.mark.parametrize("key", ["name", "id", "n", "link", "program", "employers", "profiles", "firstJobInKingston",
                                 "topMetros", "employersFirst", "level", "label", "detail"])
def test_scanner_allows_aggregate_keys(key):
    assert ps.forbidden_keys({key: 1}) == []


@pytest.mark.parametrize("value, rule", [
    ("https://www.linkedin.com/in/someone-123", "linkedin profile url"),
    ("see http://example.com", "http url"),
    ("www.example.org", "http url"),
    ("someone@example.com", "email address"),
    ("123456789", "long numeric id"),
], ids=repr)
def test_scanner_flags_suspicious_strings(value, rule):
    found = ps.string_violations({"facts": [{"text": value}]})
    assert found.get(rule) == ["facts[].text"]


@pytest.mark.parametrize("value, flagged", [
    ("jane-doe-4a2b3c19", True), ("toronto-on-ca", False), ("1995-1999", False), ("tech_now", False),
    ("law-2015", False),
], ids=repr)
def test_scanner_flags_profile_like_ids(value, flagged):
    found = ps.string_violations({"metros": [{"id": value}]})
    assert ("profile-id-like id" in found) is flagged


def test_scanner_reports_paths_not_values():
    found = ps.string_violations({"x": "someone@example.com"})
    assert "someone" not in json.dumps(found)


def test_name_and_id_matching_counts_only(tmp_path, ingest):
    people = write_parquet(tmp_path / "people.parquet", [
        {"person_id": "jane-q-public-1a2b3c", "linkedin_num_id": "987654321", "name": "Jane  Q Public "},
        {"person_id": "abc", "linkedin_num_id": "1", "name": "Prince"},             # one token: ignored
        {"person_id": "john-smith", "linkedin_num_id": "123", "name": "John Smith"},
        {"person_id": "x1", "linkedin_num_id": "2", "name": "Account Executive"},  # a title typed as a name
    ], ingest.SCHEMAS["people"])
    # "Account Executive" is the title of 10 people, "John Smith" (an employer) of only 9.
    roles = write_parquet(tmp_path / "roles.parquet",
                          [{"person_id": f"t{i}", "std": "Account Executive"} for i in range(10)]
                          + [{"person_id": f"e{i}", "parent": "John Smith"} for i in range(9)], ROLES_SCHEMA)
    strings = {"jane q public", "Prince", "Toronto", " JOHN SMITH", "abc", "987654321", "john-smith",
               "Account Executive"}
    assert ps.count_full_name_matches(strings, people) == (3, 0)
    assert ps.count_full_name_matches(strings, people, roles, k=10) == (2, 1)
    assert ps.count_profile_id_matches(strings, people) == 2      # "abc" is too short to compare
    assert ps.count_full_name_matches(set(), people) == (0, 0)


# ── The real files ───────────────────────────────────────────────────────────

def published_files():
    files = sorted(SITE_DATA.rglob("*.json")) if SITE_DATA.exists() else []
    files += sorted(STAGING.rglob("*.json")) if STAGING.exists() else []
    if not files:
        return [pytest.param(None, marks=pytest.mark.skip(reason="no JSON in site/public/data or data/aggregates"))]
    return [pytest.param(f, id=f.relative_to(ROOT).as_posix(), marks=pytest.mark.real_data) for f in files]


@pytest.mark.parametrize("path", published_files())
def test_published_json_has_no_personal_keys(path):
    assert ps.forbidden_keys(ps.load(path)) == []


@pytest.mark.parametrize("path", published_files())
def test_published_json_has_no_urls_emails_or_ids(path):
    found = ps.string_violations(ps.load(path))
    assert found == {}, {rule: f"{len(paths)} strings, e.g. at {paths[0]}" for rule, paths in found.items()}


@pytest.mark.parametrize("path", published_files())
def test_published_json_counts_meet_k(path):
    data = ps.load(path)
    k = ps.file_k(data)
    assert k[0] >= ps.K_FIELD_FLOOR and k[1] >= ps.K_NAMED_FLOOR, f"file declares k={k}, below the project floors"
    by_path = {}
    for p, v in ps.k_violations(data, k):
        by_path.setdefault(p, []).append(v)
    summary = {p: f"{len(vs)} values under their floor {k} (min {min(vs)})" for p, vs in by_path.items()}
    assert not summary, f"people counts under k (if a field is not a people count, classify it in privacy_scan.py): {summary}"
    assert ps.structural_violations(data) == []


@pytest.mark.parametrize("path", published_files())
def test_published_json_has_counts(path):
    """Guards the k-check against silently checking nothing (e.g. a renamed field)."""
    if path.name == "meta.json" or "slices" in ps.load(path) or path.stem in {"diaspora", "twin", "insights"}:
        assert ps.count_paths(ps.load(path)), "no people counts found; is the scanner reading this file?"


@pytest.mark.parametrize("path", published_files())
def test_published_strings_are_not_names_or_profile_ids(path):
    if not PEOPLE.exists():
        pytest.skip("data/processed/people.parquet not available locally")
    strings = ps.exported_strings(ps.load(path))
    # A match that is also the title/employer of >= k alumni is a common job title or a firm,
    # i.e. an aggregate itself (the real data has one: a sales title some profile uses as its name).
    n_names, n_explained = ps.count_full_name_matches(strings, PEOPLE, ROLES, ps.file_k(ps.load(path))[1])
    n_ids = ps.count_profile_id_matches(strings, PEOPLE)
    assert n_names == 0, (f"{n_names} exported strings equal a person's full name and are not a title/employer "
                          f"of >= k alumni (names not shown; {n_explained} other matches were)")
    assert n_ids == 0, f"{n_ids} exported strings equal a person_id / linkedin_num_id (values not shown)"
