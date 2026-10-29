"""
05_join.py
----------
Joins the LLM labels back onto every row and applies the deterministic clean-up rules
the labels alone can't express:

  data/derived/roles.parquet        one row per role + title/company labels, final function,
                                    `side` flag for extracurricular / board / volunteer roles
  data/derived/credentials.parquet  one row per Queen's education entry with degree level,
                                    canonical program and discipline

Both files are per-person and live under data/ (gitignored).

    .venv/Scripts/python pipeline/05_join.py
"""

from pathlib import Path

import duckdb
import sys

# DuckDB prints box-drawing tables; a redirected stdout on Windows defaults to cp1252.
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")


PROC, LAB, OUT = "data/processed", "data/labels", Path("data/derived")

# Ambiguous titles ("Associate", "Partner", "Analyst") get their function from the employer's
# industry, but only when the title-only guess was one of these catch-all functions;
# a specific guess ("Research Assistant" -> research_science) is kept.
GENERIC_FNS = ("other", "consulting_strategy", "executive_general_mgmt")
INDUSTRY_FN = {
    "banking": "finance_investing",
    "investment_mgmt_pe_vc": "finance_investing",
    "insurance": "finance_investing",
    "legal_services": "legal",
    "government_public_sector": "public_policy_government",
    "k12_education": "teaching_k12",
    "nonprofit_ngo": "social_community_services",
    "military_defence": "military_protective",
    "management_consulting": "consulting_strategy",
}
# "Consultant" at Deloitte is consulting, so accounting firms only override other/exec guesses.
INDUSTRY_FN_NARROW = {"accounting_professional_services": "accounting_audit_tax"}

# Employers with under 3 roles weren't labelled; a few name patterns are unambiguous enough
# to give them an industry anyway (a "Partner" at "Smith & Jones Barristers" is a lawyer).
NAME_INDUSTRY = [
    ("legal_services", r"\blaw\b|barrister|solicitor|\blegal\b|avocats?\b|notaire"),
    ("k12_education", r"school board|district school|\bschool district|secondary school|elementary school"),
    ("hospitals_healthcare", r"hospital|health centre|health center|\bclinic\b"),
    ("higher_education", r"\buniversity\b|\bcollege\b|université"),
    ("banking", r"\bbank\b|\bbanque\b|credit union"),
]

# Concurrent side roles that shouldn't count as someone's job. Deliberately narrow: "Member of
# Parliament", "Faculty Member", "Crew Member" and "Brand Ambassador" are jobs.
SIDE_RE = (r"\b(volunteer|board member|board of directors|board of governors|board of trustees"
           r"|committee member|council member|member at large|general member|club member"
           r"|co-?chair|chair|mentor|student ambassador|campus ambassador|delegate|trustee"
           r"|advisory board|advisor to)\b")
# ...except academic chairs, which are positions.
NOT_SIDE_RE = r"department chair|chair of the department|chair, department|research chair|endowed chair"

# Degree level from the free-text degree string; first match wins.
LEVELS = [
    ("phd", r"\bph\.?\s?d\b|doctor of philosophy|doctor of science|doctorate|d\.phil"),
    ("md", r"\bm\.?d\b|doctor of medicine|medical doctor|residency"),
    ("jd", r"\bj\.?d\b|juris|doctor of law|\bll\.?b\b|bachelor of laws"),
    ("mba", r"\bm\.?b\.?a\b|master of business admin|\bemba\b"),
    ("master", r"master|\bm\.?sc\b|\bm\.?a\.?\b|\bm\.?eng\b|\bm\.?ed\b|\bm\.?a\.?sc\b|\bm\.?p\.?a\b"
               r"|\bmir\b|\bmma\b|\bmfin\b|\bmpl\b|\bll\.?m\b|\bmmie\b|\bmmai\b|\bmpt\b|\bmsc\b"
               r"|postgraduate degree|\bmscpt\b|\bmph\b"),
    ("bachelor", r"bachelor|\bb\.?a\b|\bb\.?sc|\bb\.?a\.?sc|\bb\.?com|\bb\.?ed\b|\bbah\b|\bbfa\b"
                 r"|\bbmus\b|\bbnsc\b|\bbphe\b|\bb\.?eng\b|\bbhsc\b|\bbcomp\b|\bbs\b|honou?rs"
                 r"|undergrad|\bb\.\s?(sc|comm?|ed|a)\b|engineer.s degree|concurrent education"),
    ("certificate", r"certificate|certification|diploma|exchange|continuing|non-degree"
                    r"|additional qualification|\b(abq|aq)\b|executive|leadership program"),
]
# An entry with no recognisable degree takes its program's usual level when that level
# covers at least this share of the program's entries that do have one (Commerce -> bachelor).
INFER_LEVEL_SHARE = 0.8

# Program fallback when the field is blank or unhelpful, from the degree string.
DEGREE_PROGRAM = [
    (r"\bb\.?\s?com|commerce", "Commerce", "business_commerce"),
    (r"\bb\.?\s?ed\b|bachelor of education|concurrent education", "Education", "education"),
    (r"nursing|\bbnsc\b", "Nursing", "health_medicine_nursing"),
    (r"\bmma\b|management analytics", "Management Analytics", "business_commerce"),
    (r"\bmir\b|industrial relations", "Industrial Relations", "business_commerce"),
    (r"\bmpa\b|public administration", "Public Administration", "public_policy_admin"),
    (r"\bbfa\b|fine art", "Fine Art", "fine_performing_arts"),
    (r"\bbmus\b|music", "Music", "fine_performing_arts"),
    (r"\bbphe\b|physical (and health )?education", "Kinesiology", "health_medicine_nursing"),
    (r"\bb\.?a\.?sc|\bb\.?eng\b|applied science|engineer", "Engineering (unspecified)", "engineering"),
]
# Professional degrees name their own program regardless of what was typed as the field.
LEVEL_PROGRAM = {"mba": ("MBA", "business_commerce"), "jd": ("Law", "law"),
                 "md": ("Medicine", "health_medicine_nursing")}

# Undergraduate business is one program (the BCom); concentrations collapse into it.
COMMERCE_VARIANTS = (
    "Business", "Business Administration", "Business Management", "Commerce", "Finance",
    "Marketing", "Accounting", "Accounting and Finance", "International Business",
    "Management", "Entrepreneurship", "Human Resources", "Business Analytics",
)
PROGRAM_MERGE = {
    "English Language and Literature": "English",
    "Geology": "Geological Sciences",
    "Computing": "Computer Science",
    "French": "French Studies",
    "Engineering": "Engineering (unspecified)",
    "Applied Science": "Engineering (unspecified)",
    "Applied Mathematics and Engineering": "Mathematics and Engineering",
    "Arts": "Arts (general)",
    "Science": "Science (general)",
    "Life Science": "Life Sciences",
    "Master of Management Analytics": "Management Analytics",
    "Management, Innovation and Entrepreneurship": "Management Innovation and Entrepreneurship",
    "Fine Arts": "Fine Art",
    "Unknown": None,
    "Other": None,
}


def sql_map(d):
    return "MAP {" + ", ".join(f"'{k}': " + ("NULL" if v is None else f"'{v}'")
                                for k, v in d.items()) + "}"


def sql_case(pairs, expr, default="NULL"):
    whens = " ".join(f"WHEN regexp_matches({expr}, '{pat}') THEN '{val}'" for val, pat in pairs)
    return f"CASE {whens} ELSE {default} END"


def likely_queens_belfast(con, proc, labels):
    """Profiles that list a plain "Queen's University" but are Queen's University *Belfast*
    grads the scrape picked up by name. Signal: they live in Northern Ireland or name a Belfast
    school, AND have no job ever located in Canada AND no Kingston-specific school name. (Of
    Northern Ireland residents, 0.9% ever held a Canadian job, vs 34% of other UK residents.)
    Returns a SQL predicate on person_id; needs the geocoded places labels (04 places task)."""
    places = Path(labels, "places.parquet")
    if not places.exists():
        return "false"
    con.sql(f"""
        CREATE TABLE places_lab AS
        SELECT norm(it.text) AS k, l.country, l.region
        FROM '{labels}/places_items.parquet' it JOIN '{labels}/places.parquet' l ON l.i = it.id""")
    con.sql(f"""
        CREATE TABLE likely_qub AS
        WITH ni AS (
          SELECT p.person_id FROM '{proc}/people.parquet' p
          JOIN places_lab pl ON pl.k = norm(p.city)
          WHERE pl.country = 'GB' AND pl.region ILIKE '%northern ireland%'
          UNION
          SELECT person_id FROM '{proc}/education.parquet' WHERE school ILIKE '%belfast%'),
        canada_job AS (
          SELECT DISTINCT r.person_id FROM '{proc}/positions.parquet' r
          JOIN places_lab pl ON pl.k = norm(r.location) WHERE pl.country = 'CA'),
        kingston_school AS (
          SELECT DISTINCT person_id FROM '{proc}/education.parquet'
          WHERE is_queens AND regexp_matches(lower(school),
                'smith|kingston|ontario|canada|bader|engineering and applied science'))
        SELECT person_id FROM ni
        WHERE person_id NOT IN (SELECT person_id FROM canada_job)
          AND person_id NOT IN (SELECT person_id FROM kingston_school)""")
    return "person_id IN (SELECT person_id FROM likely_qub)"


def main(proc=PROC, labels=LAB, out=OUT, report=True):
    """proc: processed tables (01_ingest), labels: LLM labels (04_label), out: where the two
    derived tables are written. Defaults are the repo layout; tests pass temp dirs."""
    Path(out).mkdir(parents=True, exist_ok=True)
    proc, labels, out = Path(proc).as_posix(), Path(labels).as_posix(), Path(out).as_posix()
    con = duckdb.connect()
    # Same key the labelling step grouped strings by (see ITEM_SQL in 04_label.py).
    con.sql("CREATE MACRO norm(x) AS lower(trim(replace(replace(x, chr(9), ' '), chr(10), ' ')))")
    for task in ("titles", "companies", "fields"):
        con.sql(f"""
            CREATE VIEW {task}_lab AS
            SELECT k, l.* EXCLUDE (i) FROM (
                SELECT norm(text) AS k, min(id) AS id FROM '{labels}/{task}_items.parquet' GROUP BY 1
            ) it JOIN '{labels}/{task}.parquet' l ON l.i = it.id""")
    likely_qub = likely_queens_belfast(con, proc, labels)

    generic = ", ".join(f"'{f}'" for f in GENERIC_FNS)
    con.sql(f"""
        COPY (
          WITH law_degree AS (
            SELECT DISTINCT person_id FROM '{proc}/education.parquet'
            WHERE regexp_matches(lower(coalesce(degree, '')), '{dict(LEVELS)["jd"]}')
          ),
          j AS (
            SELECT p.*,
                   t.fn AS fn_title, t.lvl, nullif(t.std, '') AS std, t.stu, t.amb,
                   coalesce(c.ind, {sql_case(NAME_INDUSTRY, "lower(coalesce(p.company, ''))")}) AS ind,
                   c.ind IS NULL AND p.company IS NOT NULL AS ind_from_name,
                   c.parent
            FROM '{proc}/positions.parquet' p
            LEFT JOIN titles_lab t ON t.k = norm(p.title)
            LEFT JOIN companies_lab c ON c.k = norm(p.company)
          )
          SELECT * REPLACE (ind_from_name AND ind IS NOT NULL AS ind_from_name),
                 CASE
                   WHEN amb AND fn_title IN ({generic}) AND {sql_map(INDUSTRY_FN)}[ind] IS NOT NULL
                     THEN {sql_map(INDUSTRY_FN)}[ind]
                   WHEN amb AND fn_title IN ('other', 'executive_general_mgmt')
                        AND {sql_map(INDUSTRY_FN_NARROW)}[ind] IS NOT NULL
                     THEN {sql_map(INDUSTRY_FN_NARROW)}[ind]
                   -- "Partner" at an unlabelled small firm, held by someone with a law degree.
                   WHEN amb AND fn_title IN ({generic}) AND ind IS NULL
                        AND person_id IN (SELECT person_id FROM law_degree)
                     THEN 'legal'
                   ELSE fn_title
                 END AS fn,
                 coalesce(ind = 'student_organization', false)
                   OR (regexp_matches(lower(coalesce(std, title, '')), '{SIDE_RE}')
                       AND NOT regexp_matches(lower(coalesce(std, title, '')), '{NOT_SIDE_RE}')) AS side
          FROM j
        ) TO '{out}/roles.parquet' (FORMAT parquet, COMPRESSION zstd)""")

    commerce = ", ".join(f"'{p}'" for p in COMMERCE_VARIANTS)
    deg = "lower(coalesce(e.degree, ''))"
    level_prog = {k: v[0] for k, v in LEVEL_PROGRAM.items()}
    level_disc = {k: v[1] for k, v in LEVEL_PROGRAM.items()}
    con.sql(f"""
        COPY (
          WITH base AS (
            SELECT e.*, {sql_case(LEVELS, deg, "'unknown'")} AS degree_level,
                   CASE WHEN map_contains({sql_map(PROGRAM_MERGE)}, f.prog)
                        THEN {sql_map(PROGRAM_MERGE)}[f.prog] ELSE f.prog END AS prog_label,
                   f.disc AS disc_label,
                   {sql_case([(prog, pat) for pat, prog, _ in DEGREE_PROGRAM], deg)} AS deg_prog,
                   {sql_case([(disc, pat) for pat, _, disc in DEGREE_PROGRAM], deg)} AS deg_disc
            FROM '{proc}/education.parquet' e
            -- A blank field often means the field was typed into the degree box ("Economics").
            LEFT JOIN fields_lab f ON f.k = norm(coalesce(e.field, e.degree))
            WHERE e.is_queens AND NOT ({likely_qub})
          ),
          prog AS (
            SELECT *,
                   CASE
                     WHEN {sql_map(level_prog)}[degree_level] IS NOT NULL THEN {sql_map(level_prog)}[degree_level]
                     WHEN degree_level = 'master' AND prog_label IN ('Business', 'Business Administration') THEN 'MBA'
                     WHEN degree_level IN ('bachelor', 'unknown') AND prog_label IN ({commerce}) THEN 'Commerce'
                     ELSE coalesce(prog_label, deg_prog)
                   END AS program,
                   coalesce({sql_map(level_disc)}[degree_level],
                            CASE WHEN prog_label IS NULL THEN deg_disc END, disc_label) AS disc
            FROM base
          ),
          usual_level AS (
            SELECT program, arg_max(degree_level, n) AS level, max(n) / sum(n) AS share
            FROM (SELECT program, degree_level, count(*) AS n FROM prog
                  WHERE program IS NOT NULL AND degree_level <> 'unknown' GROUP BY 1, 2)
            GROUP BY 1
          )
          SELECT person_id, idx, degree, field, start_year, end_year, program, disc,
                 -- "Master of Business Administration" typed as a master's is still the MBA.
                 CASE WHEN program = 'MBA' THEN 'mba'
                      WHEN degree_level = 'unknown' AND u.share >= {INFER_LEVEL_SHARE} THEN u.level
                      ELSE degree_level END AS level,
                 degree_level = 'unknown' AND u.share >= {INFER_LEVEL_SHARE} AS level_inferred
          FROM prog LEFT JOIN usual_level u USING (program)
        ) TO '{out}/credentials.parquet' (FORMAT parquet, COMPRESSION zstd)""")

    if not report:
        return
    print(con.sql(f"""
        SELECT count(*) AS roles, count(fn) AS with_fn, count(ind) AS with_industry,
               count(*) FILTER (ind_from_name) AS industry_from_name,
               count(*) FILTER (fn <> fn_title) AS fn_from_industry,
               count(*) FILTER (side) AS side_roles
        FROM '{out}/roles.parquet'"""))
    print(con.sql(f"""
        SELECT level, count(*) AS entries, count(program) AS with_program, count(end_year) AS with_year
        FROM '{out}/credentials.parquet' GROUP BY 1 ORDER BY 2 DESC"""))


if __name__ == "__main__":
    main()
