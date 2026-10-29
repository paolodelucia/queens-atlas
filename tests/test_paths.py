"""06_paths.py: career stages per Queen's credential, on tiny synthetic person histories.

Every case below is one synthetic person (person_id = case id). All cases are written to one
roles / credentials / education set and 06_paths runs once; each test checks one case.

Stage months for a grad year G: first destination window May G .. Dec G+3, yN = June G+N
(N = 1..20; y5 and y10 are the old "year 5" / "year 10" stages), now = 2025-09 (SNAPSHOT_YM).
A year whose June is after the snapshot is NULL: a G grad has y1..y(2025-G).
"""

from dataclasses import dataclass, field

import pytest

import label_spec
from conftest import CREDENTIALS_SCHEMA, ROLES_SCHEMA, read_rows, write_parquet
from conftest import load_pipeline

FAMILY = load_pipeline("06_paths").FAMILY
LEVEL_GROUP = load_pipeline("06_paths").LEVEL_GROUP
GRAD_LEVELS = load_pipeline("06_paths").GRAD_LEVELS
YEARS = load_pipeline("06_paths").YEARS
DETAIL_YEARS = load_pipeline("06_paths").DETAIL_YEARS


def C(level="bachelor", grad=2014, idx=0, start=None, program="Economics"):
    """A Queen's credential (also written to education.parquet as the person's Queen's entry)."""
    default_start = None if grad is None else grad - (4 if level in ("bachelor", "unknown") else 2)
    return dict(level=level, end_year=grad, idx=idx, start_year=start or default_start, program=program)


def R(start, end=None, *, current=False, fn="finance_investing", stu=False, side=False, employer=None,
      title="Analyst", lvl="entry", ind="banking", location="Toronto", exp=None, pos=0):
    """A role. Dates are YYYYMM ints; employer defaults to role<i> (its position in the case)."""
    return dict(start_ym=start, end_ym=end, is_current=current, fn=fn, stu=stu, side=side, parent=employer,
                std=title, lvl=lvl, ind=ind, location=location, exp_idx=exp, pos_idx=pos)


def E(start, end, school="Other University", queens=False):
    """Another education entry (any school) the person has."""
    return dict(start_year=start, end_year=end, school=school, is_queens=queens)


@dataclass
class Case:
    id: str
    creds: list
    roles: list = field(default_factory=list)
    edu: list = field(default_factory=list)
    expect: dict = None          # columns expected for credential idx 0
    by_idx: dict = None          # {idx: columns} for other credentials
    absent: bool = False         # person must not appear at all
    absent_idx: tuple = ()       # these credentials must not appear


FIN = "finance_accounting"
NONE_JOB = dict(s0_fn=None, s0_employer=None, s0_title=None, s0_seniority=None, s0_industry=None,
                s0_location=None, s0_start_ym=None)

CASES = [
    # ── First destination (s0) ──
    Case("first_job_after_grad", [C(grad=2015)],
         [R(201507, 201812, employer="Bank", title="Analyst", lvl="entry", ind="banking", location="Toronto")],
         expect=dict(s0_family=FIN, s0_fn="finance_investing", s0_employer="Bank", s0_title="Analyst",
                     s0_seniority="entry", s0_industry="banking", s0_location="Toronto", s0_start_ym=201507)),
    Case("first_job_last_month_of_window", [C(grad=2015)], [R(201812, current=True)],
         expect=dict(s0_family=FIN, s0_start_ym=201812)),
    Case("first_job_after_window_is_a_gap", [C(grad=2015)], [R(201901, current=True)],
         expect=dict(s0_family="no_role_listed", **NONE_JOB, now_family=FIN)),
    Case("pre_final_year_job_ended_at_grad", [C(grad=2014)], [R(201301, 201408)],
         expect=dict(s0_family="no_role_listed")),
    Case("pre_final_year_job_stayed_a_year", [C(grad=2014)], [R(201301, 201505)],
         expect=dict(s0_family=FIN, s0_start_ym=201301)),
    Case("pre_final_year_job_stayed_11_months", [C(grad=2014)], [R(201301, 201504)],
         expect=dict(s0_family="no_role_listed")),
    Case("final_year_job_counts", [C(grad=2014)], [R(201309, 201406)],
         expect=dict(s0_family=FIN, s0_start_ym=201309)),
    Case("job_begun_before_final_year", [C(grad=2014)], [R(201308, 201406)],
         expect=dict(s0_family="no_role_listed")),
    Case("job_ended_before_may_of_grad_year", [C(grad=2014)], [R(201310, 201404)],
         expect=dict(s0_family="no_role_listed")),
    Case("student_role_from_may_of_grad_year_counts", [C(grad=2014)], [R(201405, 201408, stu=True, fn="legal")],
         expect=dict(s0_family="law", s0_start_ym=201405)),
    Case("student_role_spanning_grad_excluded", [C(grad=2014)], [R(201401, 201412, stu=True)],
         expect=dict(s0_family="no_role_listed")),
    Case("student_role_then_job", [C(grad=2014)],
         [R(201401, 201412, stu=True, employer="Internship"),
          R(201501, current=True, fn="software_engineering", employer="Shopify")],
         expect=dict(s0_family="tech", s0_employer="Shopify", s0_start_ym=201501)),
    Case("earliest_qualifying_role_wins", [C(grad=2014)],
         [R(201410, current=True, employer="Second"), R(201409, 201512, employer="First")],
         expect=dict(s0_employer="First", s0_start_ym=201409)),
    Case("same_start_longer_role_wins", [C(grad=2014)],
         [R(201407, 201409, employer="Short"), R(201407, 201712, employer="Long")],
         expect=dict(s0_employer="Long")),
    Case("same_start_and_end_first_listed_wins", [C(grad=2014)],
         [R(201407, 201612, employer="ListedSecond", exp=1), R(201407, 201612, employer="ListedFirst", exp=0)],
         expect=dict(s0_employer="ListedFirst")),
    Case("side_role_never_a_job", [C(grad=2014)],
         [R(201406, 201612, side=True, employer="Board"), R(201501, current=True, employer="Job")],
         expect=dict(s0_employer="Job", s0_start_ym=201501, now_employer="Job")),
    Case("role_without_function_ignored", [C(grad=2014)],
         [R(201406, 201612, fn=None, employer="Unlabelled"), R(201501, current=True, employer="Job")],
         expect=dict(s0_employer="Job")),
    Case("null_end_date_lasts_one_month", [C(grad=2014)], [R(201406, None, employer="OneMonth")],
         expect=dict(s0_employer="OneMonth", y5_family="no_role_listed", now_family="no_role_listed")),
    Case("null_end_date_before_may_excluded", [C(grad=2014)], [R(201404, None)],
         expect=dict(s0_family="no_role_listed")),

    # ── Further study vs first job ──
    Case("further_study_first", [C(grad=2014)], [R(201709, current=True, employer="Firm")], [E(2014, 2017)],
         expect=dict(s0_family="further_study", **NONE_JOB, now_employer="Firm")),
    Case("job_first_then_study", [C(grad=2014)], [R(201406, 201508, employer="Job")], [E(2015, 2017)],
         expect=dict(s0_family=FIN, s0_employer="Job", s0_start_ym=201406)),
    Case("same_year_job_before_september_wins", [C(grad=2014)], [R(201407, 201408, employer="Summer")],
         [E(2014, 2016)], expect=dict(s0_family=FIN, s0_employer="Summer")),
    Case("same_year_job_in_september_study_wins", [C(grad=2014)], [R(201409, 201608)], [E(2014, 2016)],
         expect=dict(s0_family="further_study", s0_start_ym=None)),
    Case("study_three_years_later_ignored", [C(grad=2014)], [R(202001, current=True)], [E(2017, 2019)],
         expect=dict(s0_family="no_role_listed")),
    Case("study_begun_before_grad_ignored", [C(grad=2014)], [R(201406, current=True, employer="Job")],
         [E(2013, 2015)], expect=dict(s0_family=FIN, s0_employer="Job")),
    Case("study_without_end_year_counts", [C(grad=2014)], [R(201601, current=True)], [E(2015, None)],
         expect=dict(s0_family="further_study")),
    Case("same_year_study_entry_dropped", [C(grad=2014)], [R(201601, current=True, employer="Job")],
         [E(2015, 2015)], expect=dict(s0_family=FIN, s0_employer="Job")),
    Case("second_queens_credential_is_further_study",
         [C("bachelor", 2012, idx=0, start=2008), C("master", 2014, idx=1, start=2012)],
         [R(201405, current=True, employer="Job")],
         expect=dict(s0_family="further_study", cred_rank=1),
         by_idx={1: dict(s0_family=FIN, s0_employer="Job", cred_rank=2)}),

    # ── Year 5 / year 10 / now ──
    Case("overlapping_roles_latest_start_wins", [C(grad=2014)],
         [R(201501, current=True, employer="Old"),
          R(201803, 202001, fn="software_engineering", employer="New")],
         expect=dict(s0_employer="Old", y5_family="tech", y5_employer="New", y5_fn="software_engineering",
                     y10_family=FIN, y10_employer="Old", now_employer="Old")),
    Case("stage_tie_longer_role_wins", [C(grad=2014)],
         [R(201901, 201908, employer="Short"), R(201901, current=True, employer="Long")],
         expect=dict(y5_employer="Long", now_employer="Long")),
    Case("student_role_ignored_at_y5", [C(grad=2014)], [R(201801, 202012, stu=True, employer="TA")],
         [E(2017, 2021)], expect=dict(s0_family="no_role_listed", y5_family="further_study", y5_employer=None)),
    Case("nothing_at_y5", [C(grad=2014)], [R(201406, 201506)],
         expect=dict(y5_family="no_role_listed", y10_family="no_role_listed", now_family="no_role_listed")),
    Case("study_starting_in_stage_year_not_yet_counted", [C(grad=2014)], [R(201406, 201506)], [E(2019, 2021)],
         expect=dict(y5_family="no_role_listed")),
    Case("study_ending_in_stage_year_counts", [C(grad=2014)], [R(201406, 201506)], [E(2017, 2019)],
         expect=dict(y5_family="further_study")),
    Case("role_beats_study_at_y5", [C(grad=2014)], [R(201901, 201912, employer="Job")], [E(2018, 2020)],
         expect=dict(y5_family=FIN, y5_employer="Job")),
    Case("current_role_spans_every_stage", [C(grad=2005)], [R(200506, current=True, fn="legal", employer="Lifer")],
         expect=dict(s0_family="law", y5_family="law", y10_family="law", now_family="law", s0_employer="Lifer",
                     y5_employer="Lifer", y10_employer="Lifer", now_employer="Lifer")),
    Case("role_ending_in_snapshot_month_is_current", [C(grad=2014)], [R(202001, 202509, employer="Recent")],
         expect=dict(now_family=FIN, now_employer="Recent")),
    Case("role_ended_month_before_snapshot", [C(grad=2014)], [R(202001, 202508)],
         expect=dict(now_family="no_role_listed", now_employer=None)),
    Case("null_end_role_in_the_stage_month", [C(grad=2014)], [R(201906, None, employer="OneMonth")],
         expect=dict(s0_family="no_role_listed", y5_employer="OneMonth")),
    Case("now_further_study", [C(grad=2014)], [R(201406, 201506)], [E(2023, 2026)],
         expect=dict(now_family="further_study")),
    Case("now_student_role_ignored", [C(grad=2014)], [R(202401, current=True, stu=True)],
         expect=dict(now_family="no_role_listed")),
    Case("stage_columns_follow_the_role", [C(grad=2014)],
         [R(201801, current=True, fn="consulting_strategy", employer="McKinsey", title="Engagement Manager",
            lvl="manager", ind="management_consulting", location="Montreal")],
         expect=dict(y5_family="consulting", y5_fn="consulting_strategy", y5_employer="McKinsey",
                     y5_title="Engagement Manager", y5_seniority="manager", y5_industry="management_consulting",
                     y5_location="Montreal", now_location="Montreal")),

    # ── Horizons: stages after the snapshot are NULL ──
    Case("grad_2025", [C(grad=2025)], [R(202506, current=True, employer="NewGrad")],
         expect=dict(s0_employer="NewGrad", y5_family=None, y5_employer=None, y10_family=None,
                     now_employer="NewGrad")),
    Case("grad_2020_reaches_y5", [C(grad=2020)], [R(202007, current=True)],
         expect=dict(y5_family=FIN, y10_family=None, y10_employer=None)),
    Case("grad_2021_has_no_y5", [C(grad=2021)], [R(202107, current=True)],
         expect=dict(s0_family=FIN, y5_family=None, y5_employer=None, now_family=FIN)),
    Case("grad_2015_reaches_y10", [C(grad=2015)], [R(201507, current=True)],
         expect=dict(y5_family=FIN, y10_family=FIN)),
    Case("grad_2016_has_no_y10", [C(grad=2016)], [R(201607, current=True)],
         expect=dict(y5_family=FIN, y10_family=None)),

    # ── Year by year (y1..y20) ──
    Case("yearly_job_then_gap_then_job", [C(grad=2010)],
         [R(201007, 201212, employer="First"), R(201503, current=True, fn="software_engineering", employer="Second")],
         expect=dict(y1_family=FIN, y2_family=FIN, y3_family="no_role_listed", y3_employer=None,
                     y4_family="no_role_listed", y5_family="tech", y5_employer="Second", y15_family="tech")),
    Case("yearly_role_must_cover_june", [C(grad=2010)],
         [R(201107, 201205, employer="EndsInMay"), R(201207, 201305, employer="StartsInJuly")],
         expect=dict(y1_family="no_role_listed", y2_family="no_role_listed", y3_family="no_role_listed")),
    Case("yearly_role_ending_in_june_counts", [C(grad=2010)], [R(201107, 201306, employer="Job")],
         expect=dict(y1_family="no_role_listed", y2_family=FIN, y3_family=FIN, y3_employer="Job",
                     y4_family="no_role_listed")),
    Case("yearly_further_study", [C(grad=2010)], [R(201007, 201108)], [E(2011, 2014)],
         expect=dict(y1_family=FIN, y2_family="further_study", y3_family="further_study", y3_employer=None,
                     y4_family="further_study", y5_family="no_role_listed")),
    Case("yearly_role_beats_study", [C(grad=2010)], [R(201301, 201312, employer="PartTime")], [E(2012, 2014)],
         # study begun in 2012 counts from June 2013 (as at s5/s10), so y2 has nothing yet
         expect=dict(y2_family="no_role_listed", y3_family=FIN, y3_employer="PartTime", y4_family="further_study")),
    Case("yearly_student_role_is_not_a_job", [C(grad=2010)], [R(201201, 201412, stu=True)], [E(2011, 2015)],
         expect=dict(y2_family="further_study", y3_family="further_study", y3_employer=None)),
    Case("yearly_overlapping_roles_latest_start_wins", [C(grad=2000)],
         [R(200007, current=True, fn="legal", employer="Firm"),
          R(200901, 201012, fn="public_policy_government", employer="Secondment")],
         expect=dict(y8_family="law", y9_family="government_policy", y10_family="government_policy",
                     y10_employer="Secondment", y11_family="law", y20_family="law", y20_employer="Firm",
                     y20_fn="legal")),
    Case("yearly_same_start_longer_role_wins", [C(grad=2000)],
         [R(201001, 201008, employer="Short"), R(201001, 202012, employer="Long")],
         expect=dict(y10_employer="Long", y20_employer="Long")),
    Case("yearly_detail_columns_follow_the_role", [C(grad=2000)],
         [R(201901, current=True, fn="consulting_strategy", employer="BCG", title="Partner", lvl="executive",
            ind="management_consulting", location="Calgary")],
         expect=dict(y20_family="consulting", y20_fn="consulting_strategy", y20_employer="BCG", y20_title="Partner",
                     y20_seniority="executive", y20_industry="management_consulting", y20_location="Calgary",
                     y3_family="no_role_listed", y3_fn=None, y3_location=None)),
    # Horizons: the last reached year is the June of 2025 (before the Sept 2025 snapshot).
    Case("horizon_grad_2024", [C(grad=2024)], [R(202407, current=True)],
         expect=dict(y1_family=FIN, y2_family=None, y3_family=None, y3_employer=None, y20_family=None,
                     now_family=FIN)),
    Case("horizon_grad_2023", [C(grad=2023)], [R(202307, current=True)],
         expect=dict(y1_family=FIN, y2_family=FIN, y3_family=None)),
    Case("horizon_grad_2005_reaches_y20", [C(grad=2005)], [R(200507, current=True)],
         expect=dict(y20_family=FIN, y20_employer="role0")),
    Case("horizon_grad_2006_stops_at_y19", [C(grad=2006)], [R(200607, current=True)],
         expect=dict(y19_family=FIN, y20_family=None, y20_employer=None)),
    Case("horizon_grad_1995", [C(grad=1995)], [R(199507, 200012)],
         expect=dict(y5_family=FIN, y6_family="no_role_listed", y20_family="no_role_listed")),

    # ── Who gets a path ──
    Case("certificate_only_excluded", [C("certificate", 2015)], [R(201507, current=True)], absent=True),
    Case("certificate_not_ranked", [C("certificate", 2010, idx=0), C("bachelor", 2014, idx=1)],
         [R(201406, current=True)], by_idx={1: dict(cred_rank=1, s0_family=FIN)}, absent_idx=(0,)),
    Case("no_dated_roles_excluded", [C(grad=2014)], [R(None, None)], absent=True),
    Case("no_roles_excluded", [C(grad=2014)], [], absent=True),
    Case("only_side_roles_still_included", [C(grad=2014)], [R(201406, current=True, side=True)],
         expect=dict(s0_family="no_role_listed", now_family="no_role_listed")),
    Case("grad_after_snapshot_year_excluded", [C(grad=2026)], [R(202001, current=True)], absent=True),
    Case("grad_1959_excluded", [C(grad=1959)], [R(195906, current=True)], absent=True),
    Case("grad_1960_included", [C(grad=1960)], [R(196006, 196512)], expect=dict(s0_family=FIN)),
    Case("grad_year_missing_excluded", [C(grad=None, start=2010)], [R(201406, current=True)], absent=True),

    # ── cred_rank: grad year, then level rank, then idx ──
    Case("rank_by_grad_year", [C("master", 2012, idx=0), C("bachelor", 2010, idx=1)], [R(201006, current=True)],
         expect=dict(cred_rank=2), by_idx={1: dict(cred_rank=1)}),
    Case("rank_same_year_by_level", [C("jd", 2015, idx=0), C("mba", 2015, idx=1)], [R(201506, current=True)],
         expect=dict(cred_rank=2, level_group="law"), by_idx={1: dict(cred_rank=1, level_group="mba")}),
    Case("rank_same_year_same_level_by_idx", [C(grad=2015, idx=1), C(grad=2015, idx=0)], [R(201506, current=True)],
         expect=dict(cred_rank=1), by_idx={1: dict(cred_rank=2)}),
    Case("rank_bachelor_before_unknown", [C("unknown", 2015, idx=0), C("bachelor", 2015, idx=1)],
         [R(201506, current=True)], expect=dict(cred_rank=2), by_idx={1: dict(cred_rank=1)}),

    # ── Credential columns carried through ──
    Case("credential_columns", [C(grad=2015, program="History")], [R(201507, current=True)],
         expect=dict(cred_id="credential_columns:0", person_id="credential_columns", idx=0, program="History",
                     disc="economics", level="bachelor", level_group="undergrad", grad_year=2015, cred_rank=1)),
]

# Before-final-year job with a long gap to graduation: only grad/professional degrees count it.
CASES += [Case(f"prior_job_{lvl}", [C(lvl, 2014, start=2012)], [R(201201, 201412, employer="Prior")],
               expect=dict(s0_employer="Prior" if lvl in GRAD_LEVELS else None,
                           s0_family=FIN if lvl in GRAD_LEVELS else "no_role_listed"))
          for lvl in ("bachelor", "unknown", "master", "mba", "phd", "jd", "md")]
# Every level maps to its level group.
CASES += [Case(f"level_group_{lvl}", [C(lvl, 2015)], [R(201507, current=True)], expect=dict(level_group=group))
          for lvl, group in LEVEL_GROUP.items()]
# Every labelled function rolls up into its family.
CASES += [Case(f"family_{fn}", [C(grad=2015)], [R(201507, current=True, fn=fn)],
               expect=dict(s0_family=FAMILY[fn], now_family=FAMILY[fn], s0_fn=fn))
          for fn in label_spec.FUNCTIONS]


def build_inputs(root, cases):
    roles, creds, edu = [], [], []
    for case in cases:
        for i, r in enumerate(case.roles):
            roles.append({**r, "person_id": case.id, "exp_idx": i if r["exp_idx"] is None else r["exp_idx"],
                          "parent": r["parent"] or f"role{i}", "title": r["std"], "company": r["parent"]})
        for c in case.creds:
            creds.append({**c, "person_id": case.id, "disc": "economics", "level_inferred": False})
            edu.append({"person_id": case.id, "idx": c["idx"], "school": "Queen's University", "is_queens": True,
                        "start_year": c["start_year"], "end_year": c["end_year"]})
        for j, e in enumerate(case.edu):
            edu.append({**e, "person_id": case.id, "idx": 10 + j})
    ingest = load_pipeline("01_ingest")
    write_parquet(root / "derived" / "roles.parquet", roles, ROLES_SCHEMA)
    write_parquet(root / "derived" / "credentials.parquet", creds, CREDENTIALS_SCHEMA)
    write_parquet(root / "processed" / "education.parquet", edu, ingest.SCHEMAS["education"])


@pytest.fixture(scope="module")
def paths_dir(tmp_path_factory, paths_mod):
    root = tmp_path_factory.mktemp("paths")
    build_inputs(root, CASES)
    paths_mod.main(derived=root / "derived", proc=root / "processed", out=root / "out", report=False)
    return root


@pytest.fixture(scope="module")
def paths(paths_dir):
    return {r["cred_id"]: r for r in read_rows(paths_dir / "out" / "paths.parquet")}


def test_case_ids_unique():
    ids = [c.id for c in CASES]
    assert len(ids) == len(set(ids))


@pytest.mark.parametrize("case", CASES, ids=[c.id for c in CASES])
def test_stage(paths, case):
    person_rows = {k: v for k, v in paths.items() if v["person_id"] == case.id}
    if case.absent:
        assert person_rows == {}
        return
    expectations = dict(case.by_idx or {})
    if case.expect is not None:
        expectations[0] = case.expect
    for idx, cols in expectations.items():
        row = paths.get(f"{case.id}:{idx}")
        assert row is not None, f"credential idx {idx} has no path"
        assert {c: row[c] for c in cols} == cols
    for idx in case.absent_idx:
        assert f"{case.id}:{idx}" not in paths


STAGE_FIELDS = ["family", "fn", "employer", "title", "seniority", "industry", "location"]


def test_output_columns(paths):
    cols = list(next(iter(paths.values())))
    expected = ["cred_id", "person_id", "idx", "program", "disc", "level", "level_group", "grad_year", "cred_rank"]
    expected += [f"s0_{f}" for f in STAGE_FIELDS] + ["s0_start_ym"]
    expected += [f"y{n}_family" for n in range(1, 21)]
    expected += [f"y{n}_{f}" for n in (3, 5, 10, 20) for f in STAGE_FIELDS[1:]]
    expected += [f"now_{f}" for f in STAGE_FIELDS]
    assert cols == expected
    assert YEARS == tuple(range(1, 21)) and DETAIL_YEARS == (3, 5, 10, 20)


def test_one_row_per_credential(paths_dir):
    rows = read_rows(paths_dir / "out" / "paths.parquet")
    assert len(rows) == len({r["cred_id"] for r in rows})


def test_cred_rank_is_dense_per_person(paths):
    ranks = {}
    for row in paths.values():
        ranks.setdefault(row["person_id"], []).append(row["cred_rank"])
    assert all(sorted(r) == list(range(1, len(r) + 1)) for r in ranks.values())


def test_families_are_known(paths):
    allowed = set(FAMILY.values()) | {"further_study", "no_role_listed", None}
    for row in paths.values():
        for s in ("s0", *(f"y{n}" for n in YEARS), "now"):
            assert row[f"{s}_family"] in allowed


def test_years_are_null_exactly_after_the_horizon(paths):
    """yN is set (never NULL) up to N = 2025 - grad_year and NULL after: every credential,
    every year. The detail columns can only be set where the family is a job."""
    for row in paths.values():
        reach = 2025 - row["grad_year"]
        for n in YEARS:
            assert (row[f"y{n}_family"] is None) == (n > reach), (row["cred_id"], n)
        for n in DETAIL_YEARS:
            if row[f"y{n}_family"] in (None, "further_study", "no_role_listed"):
                assert row[f"y{n}_fn"] is None and row[f"y{n}_employer"] is None
            else:
                assert FAMILY[row[f"y{n}_fn"]] == row[f"y{n}_family"]


def test_rerun_is_identical(paths_dir, paths_mod, paths):
    """Same input, same output (ties between roles are broken deterministically)."""
    paths_mod.main(derived=paths_dir / "derived", proc=paths_dir / "processed", out=paths_dir / "again",
                   report=False)
    again = {r["cred_id"]: r for r in read_rows(paths_dir / "again" / "paths.parquet")}
    assert again == paths


def test_report_runs(paths_dir, paths_mod, capsys):
    paths_mod.main(derived=paths_dir / "derived", proc=paths_dir / "processed", out=paths_dir / "report")
    assert "first_credentials" in capsys.readouterr().out
