"""The whole chain on a synthetic world: raw JSON -> 01 ingest -> 04 label items (with fake
labels, no API) -> 05 join -> 06 paths -> 07 River export, then the privacy scanner on the
result. Checks the contracts between steps and that the export is reproducible."""

import json
import random

import pytest

import privacy_scan as ps
from conftest import load_pipeline, read_rows, write_labels

N_PEOPLE = 180
TEST_SALT = "e2e-test-salt-not-the-real-one"
PROGRAMS = [  # degree, field, weight
    ("Bachelor of Commerce - BCom", "Commerce", 5),
    ("Bachelor of Arts - BA", "Economics", 3),
    ("Bachelor of Applied Science - BASc", "Mechanical Engineering", 3),
    ("Master of Business Administration - MBA", "Business Administration", 1),
    ("Juris Doctor - JD", "Law", 1),
]
JOBS = [  # title, company, weight
    ("Software Engineer", "Shopify", 4), ("Analyst", "RBC", 4), ("Consultant", "Deloitte", 3),
    ("Associate", "Smith & Jones Barristers", 2), ("Teacher", "Limestone District School Board", 2),
    ("Mechanical Engineer", "Magna", 3), ("Volunteer", "Kingston Food Bank", 1), ("Research Assistant", "Queen's University", 1),
    ("Summer Student", "RBC", 1),
]
TITLE_LABELS = {
    "Software Engineer": ("software_engineering", False, False), "Analyst": ("finance_investing", True, False),
    "Consultant": ("consulting_strategy", False, False), "Associate": ("other", True, False),
    "Teacher": ("teaching_k12", False, False), "Mechanical Engineer": ("engineering", False, False),
    "Volunteer": ("social_community_services", False, False), "Research Assistant": ("research_science", False, True),
    "Summer Student": ("other", True, True),
}
COMPANY_LABELS = {"Shopify": "software_internet", "RBC": "banking", "Deloitte": "accounting_professional_services",
                  "Limestone District School Board": "k12_education", "Magna": "automotive_aerospace",
                  "Kingston Food Bank": "nonprofit_ngo", "Queen's University": "higher_education"}
FIELD_LABELS = {"Commerce": ("Commerce", "business_commerce"), "Economics": ("Economics", "economics"),
                "Mechanical Engineering": ("Mechanical Engineering", "engineering"),
                "Business Administration": ("Business Administration", "business_commerce"), "Law": ("Law", "law")}
MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]


def synthetic_profiles(seed=7):
    rng = random.Random(seed)
    profiles = []
    for i in range(N_PEOPLE):
        degree, field, _ = rng.choices(PROGRAMS, [p[2] for p in PROGRAMS])[0]
        grad = rng.randint(2000, 2022)
        experience, year = [], grad
        for j in range(rng.randint(1, 3)):
            title, company, _ = rng.choices(JOBS, [x[2] for x in JOBS])[0]
            start = (year, rng.randint(1, 12))
            end = (start[0] + rng.randint(1, 5), rng.randint(1, 12))
            if j == 2 or rng.random() < 0.3 or end[0] > 2024:   # still there at the snapshot
                end = None
            experience.append({"title": title, "company": company, "location": "Toronto, Ontario, Canada",
                               "start_date": f"{MONTHS[start[1] - 1]} {start[0]}",
                               "end_date": "Present" if end is None else f"{MONTHS[end[1] - 1]} {end[0]}"})
            if end is None:
                break
            year = end[0]
        if i == 7:   # someone self-employed under their own name: must never surface in the export
            experience.append({"title": "Owner", "company": "Synthetic Alum 7", "start_date": "2019",
                               "end_date": "Present"})
        profiles.append({
            "id": f"synthetic-alum-{i:04d}", "linkedin_num_id": str(90_000_000 + i), "name": f"Synthetic Alum {i}",
            "city": "Toronto, Ontario, Canada", "country_code": "CA",
            "education": [{"title": "Queen's University", "degree": degree, "field": field,
                           "start_year": str(grad - 4), "end_year": str(grad)}],
            "experience": experience,
        })
    return profiles


@pytest.fixture(scope="module")
def world(tmp_path_factory):
    root = tmp_path_factory.mktemp("world")
    ingest, label = load_pipeline("01_ingest"), load_pipeline("04_label")
    join, paths, river = load_pipeline("05_join"), load_pipeline("06_paths"), load_pipeline("07_export_river")
    raw = root / "data" / "raw" / "queensdata.json"
    raw.parent.mkdir(parents=True)
    raw.write_text(json.dumps(synthetic_profiles()))

    mp = pytest.MonkeyPatch()
    try:
        mp.setattr(ingest, "RAW", raw)
        mp.setattr(ingest, "OUT", root / "data" / "processed")
        ingest.main()
        # 04_label.py works on relative data/ paths; build its items, then label them without the API.
        mp.chdir(root)
        items = {task: label.load_items(task) for task in ("titles", "companies", "fields")}
    finally:
        mp.undo()

    def title_label(text):
        fn, amb, stu = TITLE_LABELS.get(text.strip(), ("other", False, False))
        return {"fn": fn, "lvl": "entry", "std": text.strip(), "stu": stu, "amb": amb}

    labels = root / "labels"
    write_labels(labels, "titles", [(it["text"], title_label(it["text"])) for it in items["titles"]])
    write_labels(labels, "companies", [(it["text"], {"ind": COMPANY_LABELS.get(it["text"], "other"),
                                                     "parent": it["text"]}) for it in items["companies"]])
    write_labels(labels, "fields", [(it["text"], dict(zip(("prog", "disc"), FIELD_LABELS[it["text"]])))
                                    for it in items["fields"]])
    proc, derived = root / "data" / "processed", root / "data" / "derived"
    join.main(proc=proc, labels=labels, out=derived, report=False)
    paths.main(derived=derived, proc=proc, report=False)
    river.main(paths=derived / "paths.parquet", out=root / "agg" / "river.json", salt=TEST_SALT)
    return {"root": root, "proc": proc, "derived": derived, "items": items,
            "river": json.loads((root / "agg" / "river.json").read_text())}


def test_ingest_counts(world):
    assert len(read_rows(world["proc"] / "people.parquet")) == N_PEOPLE
    assert all(r["is_queens"] for r in read_rows(world["proc"] / "education.parquet"))


def test_every_title_and_frequent_company_gets_a_label(world):
    """04's item keys and 05's join key (norm) must agree, or labels silently fail to join."""
    roles = read_rows(world["derived"] / "roles.parquet")
    assert roles and all(r["fn_title"] is not None for r in roles if (r["title"] or "").strip())
    labelled = {it["text"] for it in world["items"]["companies"]}
    assert all(r["ind"] is not None for r in roles if r["company"] in labelled and r["company"] in COMPANY_LABELS)


def test_every_credential_has_level_and_program(world):
    creds = read_rows(world["derived"] / "credentials.parquet")
    assert len(creds) == N_PEOPLE
    assert all(c["level"] in {"bachelor", "mba", "jd"} for c in creds)
    assert {c["program"] for c in creds} == {"Commerce", "Economics", "Mechanical Engineering", "MBA", "Law"}


def test_paths_cover_credentials_with_dated_roles(world):
    paths = read_rows(world["derived"] / "paths.parquet")
    assert 0 < len(paths) <= N_PEOPLE
    assert all(p["cred_rank"] == 1 for p in paths)


def test_river_export_passes_privacy_scan(world):
    data = world["river"]
    assert data["slices"], "the synthetic world should be big enough for at least one slice"
    assert ps.k_violations(data) == []
    assert ps.structural_violations(data) == []
    assert ps.forbidden_keys(data) == []
    assert ps.string_violations(data) == {}


def test_river_export_contains_no_names_or_ids(world):
    strings = ps.exported_strings(world["river"])
    people = world["proc"] / "people.parquet"
    assert ps.count_full_name_matches(strings, people, world["derived"] / "roles.parquet") == (0, 0)
    assert ps.count_profile_id_matches(strings, people) == 0


def test_rebuild_is_identical(world):
    """Re-running 06 and 07 on the same inputs reproduces the export byte for byte."""
    paths, river = load_pipeline("06_paths"), load_pipeline("07_export_river")
    again = world["root"] / "again"
    paths.main(derived=world["derived"], proc=world["proc"], out=again, report=False)
    river.main(paths=again / "paths.parquet", out=again / "river.json", salt=TEST_SALT)
    first = json.dumps(world["river"], sort_keys=False)
    second = json.dumps(json.loads((again / "river.json").read_text()), sort_keys=False)
    assert first == second
