"""02_snapshot_date.py and 03_profile.py are reports; check they run on a synthetic data/ and
that the snapshot arithmetic lands on the expected month."""

import pytest

from conftest import run_script, write_parquet

TS_2025_09_29 = 1759179120000


@pytest.fixture(scope="module")
def processed_world(tmp_path_factory, ingest):
    root = tmp_path_factory.mktemp("reports")
    proc = root / "data" / "processed"
    people = [{"person_id": f"p{i}", "name": f"Synthetic Person {i}", "city": "Kingston", "country_code": "CA",
               "n_experience": 1} for i in range(5)]
    education = [{"person_id": f"p{i}", "idx": 0, "school": "Queen's University", "is_queens": True,
                  "degree": "Bachelor of Arts - BA", "field": "History", "start_year": 2010, "end_year": 2014}
                 for i in range(5)]
    # Current roles "Jan 2025 - Present 9 months" imply a page rendered in 2025-09.
    positions = [{"person_id": f"p{i}", "exp_idx": 0, "pos_idx": 0, "company": "Example Co", "title": "Analyst",
                  "start_ym": 202501, "start_month_known": True, "is_current": True, "duration_months": 9}
                 for i in range(5)]
    activity = [{"person_id": f"p{i}", "kind": "activity", "activity_id": str(TS_2025_09_29 << 22),
                 "ts_ms": TS_2025_09_29 - i * 86_400_000} for i in range(5)]
    for name, rows in [("people", people), ("education", education), ("positions", positions), ("activity", activity)]:
        write_parquet(proc / f"{name}.parquet", rows, ingest.SCHEMAS[name])
    return root


def test_snapshot_date_report(processed_world):
    res = run_script("02_snapshot_date.py", processed_world)
    assert res.returncode == 0, res.stderr[-2000:]
    assert "2025-09" in res.stdout
    assert "2025-09-29" in res.stdout


def test_profile_report(processed_world):
    res = run_script("03_profile.py", processed_world)
    assert res.returncode == 0, res.stderr[-2000:]
    assert "== Headline counts" in res.stdout
    # The report is meant to be shareable: it must not print profile names.
    assert "Synthetic Person" not in res.stdout
