"""05_join.py rule tables. 05 evaluates these regexes with DuckDB's regexp_matches (RE2), so
they are tested through DuckDB using the same generated CASE expression (sql_case), not
Python's `re`."""

import duckdb
import pytest


@pytest.fixture(scope="module")
def con():
    return duckdb.connect()


def classify(con, join, pairs, value, default="NULL"):
    """Run `sql_case(pairs, ...)` on one value exactly as 05_join does (lower + coalesce)."""
    case = join.sql_case(pairs, "lower(coalesce(v, ''))", default)
    return con.execute(f"SELECT {case} FROM (SELECT ?::VARCHAR AS v)", [value]).fetchone()[0]


# ── Degree level (LEVELS, first match wins) ─────────────────────────────────

LEVEL_CASES = [
    ("Bachelor of Commerce - BCom", "bachelor"),
    ("Master of Business Administration (MBA)", "mba"),
    ("Doctor of Law - JD", "jd"),
    ("Juris Doctor", "jd"),
    ("LLB", "jd"),
    ("Bachelor of Laws (LL.B.)", "jd"),
    ("Doctor of Medicine - MD", "md"),
    ("Medical Doctor", "md"),
    ("Family Medicine Residency", "md"),
    ("Doctor of Philosophy - PhD", "phd"),
    ("Ph. D.", "phd"),
    ("PhD Candidate", "phd"),
    ("D.Phil", "phd"),
    ("Doctorate", "phd"),
    ("Doctor of Science", "phd"),
    ("MSc", "master"),
    ("M.A.", "master"),
    ("Master's degree", "master"),
    ("Masters", "master"),
    ("Master of Applied Science - MASc", "master"),
    ("M.Eng.", "master"),
    ("MEd", "master"),
    ("Master of Laws - LLM", "master"),
    ("LL.M.", "master"),
    ("Master of Public Health - MPH", "master"),
    ("MIR", "master"),
    ("MMA", "master"),
    ("MMAI", "master"),
    ("MFin", "master"),
    ("Master of Planning (MPl)", "master"),
    ("MScPT", "master"),
    ("Postgraduate Degree", "master"),
    ("B. Sc.", "bachelor"),
    ("B.A.", "bachelor"),
    ("BAH", "bachelor"),
    ("BA (Hons)", "bachelor"),
    ("Honours Bachelor of Arts", "bachelor"),
    ("Bachelor of Education (B.Ed.)", "bachelor"),
    ("Bachelor of Applied Science - BASc", "bachelor"),
    ("B.A.Sc.", "bachelor"),
    ("BSc (Eng)", "bachelor"),
    ("BEng", "bachelor"),
    ("B.Comm", "bachelor"),
    ("BScN", "bachelor"),
    ("Bachelor of Nursing Science - BNSc", "bachelor"),
    ("BPHE", "bachelor"),
    ("BFA", "bachelor"),
    ("BMus", "bachelor"),
    ("BComp", "bachelor"),
    ("BS", "bachelor"),
    ("Bachelor's degree", "bachelor"),
    ("Undergraduate", "bachelor"),
    ("Engineer's degree", "bachelor"),
    ("Concurrent Education", "bachelor"),
    ("Graduate Diploma in Accounting", "certificate"),
    ("Certificate in Business", "certificate"),
    ("High School Diploma", "certificate"),
    ("Exchange Program", "certificate"),
    ("Additional Qualification", "certificate"),
    ("ABQ", "certificate"),
    ("Continuing Education", "certificate"),
    ("Non-Degree Program", "certificate"),
    ("Queen's Executive Program", "certificate"),
    ("Executive MBA", "mba"),                 # mba is tested before certificate's "executive"
    ("EMBA", "mba"),
    ("M.B.A.", "mba"),
    ("MBA Candidate", "mba"),
    # Combined entries: the LEVELS order decides, not the order in the string.
    ("MD/PhD", "phd"),
    ("JD/MBA", "jd"),
    ("MBA/JD", "jd"),
    ("B.A., M.A.", "master"),
    # Nothing recognisable -> unknown (05 may later infer it from the program).
    ("Associate's degree", "unknown"),
    ("Postdoctoral Fellow", "unknown"),
    ("Economics", "unknown"),
    ("", "unknown"),
    (None, "unknown"),
]


@pytest.mark.parametrize("degree, level", LEVEL_CASES, ids=repr)
def test_degree_level(con, join, degree, level):
    assert classify(con, join, join.LEVELS, degree, "'unknown'") == level


# Regressions: "mph d..." used to read as a PhD; dotted M.P.A. used to be unknown.
@pytest.mark.parametrize("degree, level", [
    ("MPH Degree", "master"),
    ("MPH", "master"),
    ("M.P.A.", "master"),
    ("Ph.D.", "phd"),
], ids=repr)
def test_degree_level_regressions(con, join, degree, level):
    assert classify(con, join, join.LEVELS, degree, "'unknown'") == level


def test_level_names(join):
    names = [name for name, _ in join.LEVELS]
    assert len(names) == len(set(names))
    assert names[-1] == "certificate", "certificate must be the last resort"


# ── Program fallback from the degree string (DEGREE_PROGRAM) ─────────────────

DEGREE_PROGRAM_CASES = [
    ("Bachelor of Commerce", "Commerce", "business_commerce"),
    ("B.Com", "Commerce", "business_commerce"),
    ("Commerce and Engineering", "Commerce", "business_commerce"),   # first match wins
    ("Bachelor of Education", "Education", "education"),
    ("BEd", "Education", "education"),
    ("Concurrent Education", "Education", "education"),
    ("Bachelor of Nursing Science - BNSc", "Nursing", "health_medicine_nursing"),
    ("Master of Management Analytics", "Management Analytics", "business_commerce"),
    ("MMA", "Management Analytics", "business_commerce"),
    ("MIR", "Industrial Relations", "business_commerce"),
    ("Master of Public Administration - MPA", "Public Administration", "public_policy_admin"),
    ("BFA", "Fine Art", "fine_performing_arts"),
    ("Bachelor of Music", "Music", "fine_performing_arts"),
    ("Physical and Health Education", "Kinesiology", "health_medicine_nursing"),
    ("BASc", "Engineering (unspecified)", "engineering"),
    ("B.Eng", "Engineering (unspecified)", "engineering"),
    ("Bachelor of Applied Science", "Engineering (unspecified)", "engineering"),
    ("Bachelor of Arts", None, None),
    ("Doctor of Medicine", None, None),   # professional degrees get their program from LEVEL_PROGRAM
    (None, None, None),
]


@pytest.mark.parametrize("degree, program, disc", DEGREE_PROGRAM_CASES, ids=repr)
def test_degree_program(con, join, degree, program, disc):
    prog_pairs = [(prog, pat) for pat, prog, _ in join.DEGREE_PROGRAM]
    disc_pairs = [(d, pat) for pat, _, d in join.DEGREE_PROGRAM]
    assert classify(con, join, prog_pairs, degree) == program
    assert classify(con, join, disc_pairs, degree) == disc


# ── Industry from an unlabelled employer's name (NAME_INDUSTRY) ──────────────

NAME_INDUSTRY_CASES = [
    ("Smith & Jones Barristers", "legal_services"),
    ("Law Society of Ontario", "legal_services"),
    ("Legal Aid Ontario", "legal_services"),
    ("Cabinet d'avocats", "legal_services"),
    ("Notaire Tremblay", "legal_services"),
    ("Law Clinic", "legal_services"),                    # legal is tested before healthcare
    ("Lawson Foundation", None),
    ("Outlaw Brewing", None),
    ("Limestone District School Board", "k12_education"),
    ("Seaway Secondary School", "k12_education"),
    ("Montessori School", None),
    ("Kingston General Hospital", "hospitals_healthcare"),
    ("Community Health Centre", "hospitals_healthcare"),
    ("Physio Clinic", "hospitals_healthcare"),
    ("Clinical Research Inc", None),
    ("University Hospital", "hospitals_healthcare"),     # healthcare before higher education
    ("Queen's University", "higher_education"),
    ("St. Lawrence College", "higher_education"),
    ("Université Laval", "higher_education"),
    ("Collegiate Institute", None),
    ("Royal Bank of Canada", "banking"),
    ("Banque Nationale", "banking"),
    ("Kawartha Credit Union", "banking"),
    ("Bankers Hall", None),
    ("Shopify", None),
    (None, None),
]


@pytest.mark.parametrize("company, industry", NAME_INDUSTRY_CASES, ids=repr)
def test_name_industry(con, join, company, industry):
    assert classify(con, join, join.NAME_INDUSTRY, company) == industry


# ── Side roles (SIDE_RE) ─────────────────────────────────────────────────────

def is_side(con, join, title):
    t = "lower(coalesce(?, ''))"
    sql = f"SELECT regexp_matches({t}, '{join.SIDE_RE}') AND NOT regexp_matches({t}, '{join.NOT_SIDE_RE}')"
    return con.execute(sql, [title, title]).fetchone()[0]


@pytest.mark.parametrize("title, side", [
    ("Volunteer", True),
    ("Board Member", True),
    ("Member, Board of Directors", True),
    ("Board Of Directors", True),
    ("Advisory Board Member", True),
    ("Co-Chair", True),
    ("Cochair", True),
    ("Chair of the Board", True),
    ("Mentor", True),
    ("Peer Mentor", True),
    ("Student Ambassador", True),
    ("Campus Ambassador", True),
    ("Ambassador", False),             # ambiguous; "Brand Ambassador" is a (usually paid) job
    ("Brand Ambassador", False),
    ("Delegate", True),
    ("Trustee", True),
    ("Board of Governors", True),
    ("Governor", False),
    ("Advisor to the CEO", True),
    ("Software Engineer", False),
    ("Chairman", False),
    ("Chairperson", False),
    ("Senior Advisor", False),
    ("Membership Coordinator", False),
    ("Members Services Rep", False),
    ("Volunteering Coordinator", False),
    ("Remember", False),
    (None, False),
], ids=repr)
def test_side_re(con, join, title, side):
    assert is_side(con, join, title) is side


# Regressions: real jobs the side-role rule used to drop from career paths (~1.7k people).
@pytest.mark.parametrize("title", [
    "Member of Parliament",            # 12
    "Member of Technical Staff",       # 51 incl. "Senior ..."
    "Faculty Member",                  # 97
    "Team Member",                     # 152 (+ "Sales Floor/Operations/... Team Member")
    "Crew Member",                     # 215
    "Department Chair",                # 14
    "Canada Research Chair",
], ids=repr)
def test_side_re_real_jobs(con, join, title):
    assert is_side(con, join, title) is False


# ── SQL helpers ──────────────────────────────────────────────────────────────

def test_sql_case_first_match_wins_and_default(con, join):
    pairs = [("a", "x"), ("b", "x|y")]
    assert classify(con, join, pairs, "x") == "a"
    assert classify(con, join, pairs, "Y") == "b"       # input is lower-cased
    assert classify(con, join, pairs, "z") is None
    assert classify(con, join, pairs, "z", "'fallback'") == "fallback"


def test_sql_map(con, join):
    m = join.sql_map({"Engineering": "Engineering (unspecified)", "Unknown": None})
    row = con.execute(f"SELECT {m}['Engineering'], {m}['Unknown'], map_contains({m}, 'Unknown'), "
                      f"{m}['Absent']").fetchone()
    assert row == ("Engineering (unspecified)", None, True, None)


def all_patterns(join):
    yield "SIDE_RE", join.SIDE_RE
    yield "NOT_SIDE_RE", join.NOT_SIDE_RE
    for name, pat in join.LEVELS:
        yield f"LEVELS.{name}", pat
    for name, pat in join.NAME_INDUSTRY:
        yield f"NAME_INDUSTRY.{name}", pat
    for pat, prog, _ in join.DEGREE_PROGRAM:
        yield f"DEGREE_PROGRAM.{prog}", pat


def test_every_pattern_is_valid_re2(con, join):
    for name, pat in all_patterns(join):
        con.execute(f"SELECT regexp_matches('', '{pat}')")  # raises on RE2-incompatible syntax


def test_no_quotes_in_interpolated_sql(join, paths_mod):
    """sql_case/sql_map paste values into SQL without escaping."""
    values = [pat for _, pat in all_patterns(join)]
    values += [v for _, prog, disc in join.DEGREE_PROGRAM for v in (prog, disc)]
    values += [k for k in join.PROGRAM_MERGE] + [v for v in join.PROGRAM_MERGE.values() if v]
    values += list(join.COMMERCE_VARIANTS) + list(join.GENERIC_FNS)
    values += [x for d in (join.INDUSTRY_FN, join.INDUSTRY_FN_NARROW, paths_mod.FAMILY, paths_mod.LEVEL_GROUP)
               for kv in d.items() for x in kv]
    values += [x for v in join.LEVEL_PROGRAM.values() for x in v]
    assert not [v for v in values if "'" in v]
