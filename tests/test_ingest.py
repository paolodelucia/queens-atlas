"""01_ingest.py: parsing helpers, row builders, schemas, the chunked writer and main()."""

import json

import pyarrow.parquet as pq
import pytest

from conftest import read_rows


# ── parse_ym / month_known ───────────────────────────────────────────────────

@pytest.mark.parametrize("raw, expected", [
    ("Nov 2023", 202311),
    ("November 2023", 202311),      # only the first three letters matter
    ("sept 2020", 202009),
    ("  Jan 2020  ", 202001),
    ("2019", 201901),               # year only: month unknown, stored as January
    ("Present", None),
    ("present", None),
    ("", None),
    (None, None),
    (2019, None),                   # non-strings are ignored
    ("Foo 2020", None),
    ("2019 Jan", None),
    ("Jan 2020 extra", None),
    ("19", None),
], ids=repr)
def test_parse_ym(ingest, raw, expected):
    assert ingest.parse_ym(raw) == expected


@pytest.mark.parametrize("raw, expected", [
    ("Nov 2023", True), ("2019", False), ("Present", False), ("", False), (None, False), (2019, False),
], ids=repr)
def test_month_known(ingest, raw, expected):
    assert ingest.month_known(raw) is expected


# ── Durations ────────────────────────────────────────────────────────────────

@pytest.mark.parametrize("raw, expected", [
    ("1 year 9 months", 21),
    ("2 yrs 3 mos", 27),
    ("10 yrs 11 mos", 131),
    ("9 months", 9),
    ("1 mo", 1),
    ("1 yr", 12),
    ("3 years", 36),
    ("less than a year", None),
    ("", None),
    (None, None),
    (12, None),
    # Raw `duration` values on single roles carry the date range first.
    ("Jan 2020 - Present 5 years", 60),
    ("Jul 2023 - Present 1 year 7 months", 19),
    ("2003 Apr 2019 16 years", 192),
], ids=repr)
def test_parse_duration_months(ingest, raw, expected):
    assert ingest.parse_duration_months(raw) == expected


@pytest.mark.parametrize("meta, expected", [
    ("Jan 2025 - Present 9 months", 9),
    ("Sep 2019 - Apr 2021 1 year 8 months", 20),
    ("2015 - 2019 4 years", 48),
    ("Jan 2020 - Present", None),
    ("", None),
    (None, None),
], ids=repr)
def test_duration_from_meta(ingest, meta, expected):
    assert ingest.duration_from_meta(meta) == expected


# ── Snowflake ids ────────────────────────────────────────────────────────────

def test_linkedin_id_round_trip(ingest):
    ts_ms = 1759179120000  # 2025-09-29 20:52 UTC, the newest activity in the scrape
    activity_id = (ts_ms << 22) | 0x2ABCD
    assert ingest.linkedin_id_to_ts_ms(activity_id) == ts_ms
    assert ingest.linkedin_id_to_ts_ms(str(activity_id)) == ts_ms


@pytest.mark.parametrize("bad", [None, "", "abc", "12x"], ids=repr)
def test_linkedin_id_invalid(ingest, bad):
    assert ingest.linkedin_id_to_ts_ms(bad) is None


@pytest.mark.parametrize("raw, expected", [("12", 12), (7, 7), ("500+", None), (None, None), ("", None)],
                         ids=repr)
def test_to_int(ingest, raw, expected):
    assert ingest.to_int(raw) == expected


# ── QUEENS_RE ────────────────────────────────────────────────────────────────

@pytest.mark.parametrize("school, expected", [
    ("Queen's University", True),
    ("Queens University", True),
    ("QUEEN'S UNIVERSITY", True),
    ("Queen's University at Kingston", True),
    ("Smith School of Business at Queen's University", True),
    ("Smith School of Business", True),
    ("Queen's School of Business", True),
    ("University of Toronto", False),
    ("The University of Queensland", False),
    ("Queens College", False),
    ("", False),
], ids=repr)
def test_queens_re(ingest, school, expected):
    assert ingest.is_queens_school(school) is expected


# Regressions found in the real data (previously mis-matched or missed).
@pytest.mark.parametrize("school, expected", [
    ("Queen's University Belfast", False),      # a different university
    ("Queens University, Belfast", False),
    ("Queens University of Charlotte", False),
    ("Queen’s University", True),               # curly apostrophe
    ("Smith School of Business, Queen’s University", True),
    ("Queen's Law", True),                      # Queen's Faculty of Law
    ("Queen's Faculty of Law", True),
    ("Queen's Univ", True),
    ("Queen's College", False),                 # ambiguous (Oxford, CUNY, ...)
    ("Queens", False),
    (None, False),
], ids=repr)
def test_queens_school_regressions(ingest, school, expected):
    assert ingest.is_queens_school(school) is expected


# ── Row builders ─────────────────────────────────────────────────────────────

PROFILE = {
    "id": "synthetic-profile-1",
    "linkedin_num_id": "1000001",
    "name": "Test Person",
    "position": "Analyst at Example",
    "city": "Kingston, Ontario, Canada",
    "country_code": "CA",
    "connections": "500",
    "followers": "500+",
    "current_company": {"name": "Nested Co", "company_id": "nested-co", "title": "Analyst"},
    "languages": [{"title": "English"}, "junk", {"title": "French"}],
    "education": [
        {"title": "Queen's University", "degree": "Bachelor of Commerce - BCom", "field": "Commerce",
         "start_year": "2010", "end_year": "2014"},
        "not-a-dict",
        {"title": "University of Toronto", "degree": "Juris Doctor", "start_year": "2015", "end_year": None},
    ],
    "experience": [
        {"company": "Solo Co", "company_id": "solo", "title": "Analyst", "location": "Toronto",
         "start_date": "Jun 2014", "end_date": "Present", "duration": "1 year 9 months"},
        {"company": "Group Co", "company_id": "group", "location": "Ottawa", "positions": [
            {"title": "Senior Manager", "start_date": "Jan 2020", "end_date": "Present",
             "meta": "Jan 2020 - Present 5 years 9 months"},
            {"title": "Manager", "start_date": "2017", "end_date": "Dec 2019", "location": "Montreal",
             "meta": "2017 - Dec 2019 3 years"},
            "junk",
        ]},
        "junk",
    ],
    "activity": [
        {"id": str((1759179120000 << 22) | 1), "interaction": "Liked by"},
        {"id": "urn-not-numeric", "link": "https://www.linkedin.com/feed/update/urn:li:activity-7378123456789012345"},
    ],
    "posts": [{"id": "slug", "link": "https://example.com/posts/x-activity-7300000000000000000-abcd",
               "attribution": "Posted"}, {"id": "no-link"}],
}


def test_person_row(ingest):
    row = ingest.person_row(PROFILE)
    assert list(row) == ingest.SCHEMAS["people"].names
    assert row["person_id"] == "synthetic-profile-1"
    assert row["headline"] == "Analyst at Example"
    assert row["connections"] == 500 and row["followers"] is None
    assert row["current_company"] == "Nested Co"           # falls back to the nested object
    assert row["current_company_id"] == "nested-co"
    assert row["current_title"] == "Analyst"
    assert row["languages"] == ["English", "French"]
    assert (row["n_experience"], row["n_education"], row["n_languages"]) == (3, 3, 3)


def test_person_row_prefers_top_level_company(ingest):
    row = ingest.person_row({**PROFILE, "current_company_name": "Top Co", "current_company_company_id": "top"})
    assert (row["current_company"], row["current_company_id"]) == ("Top Co", "top")


def test_education_rows(ingest):
    rows = list(ingest.education_rows(PROFILE))
    assert [list(r) for r in rows] == [ingest.SCHEMAS["education"].names] * 2
    assert [r["idx"] for r in rows] == [0, 2]                # idx is the position in the raw list
    assert [r["is_queens"] for r in rows] == [True, False]
    assert (rows[0]["start_year"], rows[0]["end_year"]) == (2010, 2014)
    assert rows[1]["end_year"] is None


def test_position_rows_flatten_groups(ingest):
    rows = list(ingest.position_rows(PROFILE))
    assert all(list(r) == ingest.SCHEMAS["positions"].names for r in rows)
    assert [(r["exp_idx"], r["pos_idx"], r["grouped"]) for r in rows] == [(0, 0, False), (1, 0, True), (1, 1, True)]
    solo, senior, manager = rows
    assert (solo["company"], solo["start_ym"], solo["end_ym"], solo["is_current"]) == ("Solo Co", 201406, None, True)
    assert solo["duration_months"] == 21                    # single roles read `duration`
    assert (senior["company"], senior["company_id"]) == ("Group Co", "group")
    assert senior["duration_months"] == 69                  # grouped roles read `meta`
    assert senior["location"] == "Ottawa"                   # inherits the group's location
    assert manager["location"] == "Montreal"
    assert (manager["start_ym"], manager["start_month_known"]) == (201701, False)
    assert (manager["end_ym"], manager["is_current"]) == (201912, False)


def test_activity_rows(ingest):
    rows = list(ingest.activity_rows(PROFILE))
    assert [r["kind"] for r in rows] == ["activity", "activity", "posts", "posts"]
    assert rows[0]["ts_ms"] == 1759179120000
    assert rows[1]["activity_id"] == "7378123456789012345"   # non-numeric id -> taken from the link
    assert rows[2]["activity_id"] == "7300000000000000000"   # posts always use the link
    assert rows[2]["interaction"] == "Posted"
    assert rows[3]["activity_id"] is None and rows[3]["ts_ms"] is None


def test_builders_tolerate_empty_profile(ingest):
    p = {"id": "x"}
    assert ingest.person_row(p)["n_experience"] == 0
    assert list(ingest.education_rows(p)) == []
    assert list(ingest.position_rows(p)) == []
    assert list(ingest.activity_rows(p)) == []


# ── Writer ───────────────────────────────────────────────────────────────────

def test_chunked_writer_keeps_schema_when_first_chunk_is_null(ingest, tmp_path):
    path = tmp_path / "education.parquet"
    schema = ingest.SCHEMAS["education"]
    w = ingest.ChunkedWriter(path, schema)
    w.add([{"person_id": "a", "idx": 0, "school": None, "is_queens": False, "degree": None,
            "field": None, "start_year": None, "end_year": None, "description": None}])
    w.flush()
    w.flush()  # empty flush is a no-op
    w.add([{"person_id": "b", "idx": 0, "school": "Queen's University", "is_queens": True,
            "degree": "BA", "field": "History", "start_year": 2001, "end_year": 2005, "description": "x"}])
    w.close()
    f = pq.ParquetFile(path)
    assert f.schema_arrow == schema
    assert f.metadata.num_row_groups == 2
    assert [r["end_year"] for r in read_rows(path, "person_id")] == [None, 2005]


# ── main() end to end on a synthetic raw file ────────────────────────────────

def test_main_end_to_end(ingest, tmp_path, monkeypatch):
    profiles = [PROFILE, {"name": "no id"}, "not a profile",
                {**PROFILE, "id": "synthetic-profile-2", "experience": [], "activity": [], "posts": []},
                {**PROFILE, "id": "synthetic-profile-3"}]
    raw = tmp_path / "raw.json"
    raw.write_text(json.dumps(profiles))
    out = tmp_path / "processed"
    monkeypatch.setattr(ingest, "RAW", raw)
    monkeypatch.setattr(ingest, "OUT", out)
    monkeypatch.setattr(ingest, "CHUNK", 2)
    ingest.main()

    counts = {name: pq.ParquetFile(out / f"{name}.parquet").metadata.num_rows for name in ingest.SCHEMAS}
    assert counts == {"people": 3, "education": 6, "positions": 6, "activity": 8}
    for name, schema in ingest.SCHEMAS.items():
        assert pq.ParquetFile(out / f"{name}.parquet").schema_arrow == schema
    assert pq.ParquetFile(out / "people.parquet").metadata.num_row_groups == 2   # flushed every CHUNK profiles
