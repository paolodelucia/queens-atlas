"""
06_paths.py
-----------
Turns roles + credentials into one career path per Queen's credential:

  s0        first destination: first real job, or further study if that came first
  y1..y20   what they were doing in June of grad_year + N (N = 1..20): the main role held
            then; else further study (another degree under way); else no role listed
  now       their current role at the snapshot (Sept 2025)

Every year has a family (`yN_family`); the years the River draws as Sankey columns
(DETAIL_YEARS: 3, 5, 10, 20) also carry the role behind it (function, employer, title,
seniority, industry, location), like s0 and now. "Year 5" and "year 10" used to be stages
s5/s10: they are y5/y10 now, under the same rule.

"Real job" excludes student/intern roles and side roles (boards, volunteering, clubs).
A year is NULL when its June falls after the snapshot, so a 2018 grad has y1..y7 and no y8.

Output: data/derived/paths.parquet (per person, gitignored). 07_export_river.py aggregates it.

    .venv/Scripts/python pipeline/06_paths.py
"""

from pathlib import Path

import duckdb
import sys

# DuckDB prints box-drawing tables; a redirected stdout on Windows defaults to cp1252.
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")


DERIVED, PROC = "data/derived", "data/processed"
SNAPSHOT_YM = 202509
FIRST_GRAD_YEAR = 1960
FIRST_JOB_WINDOW_YEARS = 3   # a first job starting later than this is a gap, not a first job
YEARS = tuple(range(1, 21))  # yN_family: June of grad_year + N
DETAIL_YEARS = (3, 5, 10, 20)  # years that also get the role's columns (the River's Sankey columns)
STAGE_FIELDS = ("fn", "employer", "title", "seniority", "industry", "location")

# Bachelor's grads often list part-time jobs during school; only roles starting from the
# September of their final year count. Grad/professional students may already be working.
GRAD_LEVELS = ("master", "mba", "phd", "jd", "md")
LEVEL_RANK = {"bachelor": 1, "unknown": 2, "master": 3, "mba": 4, "jd": 5, "md": 6, "phd": 7}
LEVEL_GROUP = {"bachelor": "undergrad", "unknown": "undergrad_or_unknown", "master": "graduate",
               "phd": "graduate", "mba": "mba", "jd": "law", "md": "medicine"}

# 28 functions are too many for a readable river; they roll up into these families.
FAMILY = {
    "software_engineering": "tech", "data_analytics_ai": "tech", "it_infrastructure": "tech",
    "product_management": "tech", "design_ux": "tech",
    "engineering": "engineering",
    "research_science": "research_academia", "academia": "research_academia",
    "teaching_k12": "teaching",
    "healthcare_clinical": "healthcare",
    "finance_investing": "finance_accounting", "accounting_audit_tax": "finance_accounting",
    "consulting_strategy": "consulting",
    "sales_business_development": "sales_marketing", "marketing_communications": "sales_marketing",
    "operations_supply_chain": "operations_management", "executive_general_mgmt": "operations_management",
    "hr_people": "operations_management", "administration_support": "operations_management",
    "legal": "law",
    "public_policy_government": "government_policy", "military_protective": "government_policy",
    "social_community_services": "nonprofit_community",
    "arts_media_creative": "arts_media",
    "entrepreneurship_founder": "founder",
    "trades_retail_service": "service_trades", "athletics_sports": "service_trades",
    "other": "other",
}


def sql_map(d):
    return "MAP {" + ", ".join(f"'{k}': '{v}'" for k, v in d.items()) + "}"


ROLE_STRUCT = ("struct_pack(fn := r.fn, parent := r.parent, std := r.std, lvl := r.lvl, ind := r.ind, "
               "location := r.location)")
# Roles that start in the same month are common; without a full ordering DuckDB's parallel
# arg_max/arg_min picks one at random and paths.parquet changes from run to run. Ties go to
# the role that lasts longer, then to the one listed first on the profile.
TIE_BREAK = "r.end_eff DESC, r.exp_idx, r.pos_idx"


def active_role_sql(stage, month_expr, horizon_ok):
    """Main role held at a given month: the most recently started one if several overlap."""
    return f"""
      {stage}_role AS (
        SELECT c.cred_id, first({ROLE_STRUCT} ORDER BY r.start_ym DESC, {TIE_BREAK}) AS role
        FROM creds c JOIN main_roles r ON r.person_id = c.person_id
        WHERE {horizon_ok} AND NOT r.stu AND r.start_ym <= {month_expr} AND r.end_eff >= {month_expr}
        GROUP BY 1),
      {stage}_study AS (
        SELECT DISTINCT c.cred_id
        FROM creds c JOIN other_edu e ON e.person_id = c.person_id AND e.cred_id = c.cred_id
        WHERE {horizon_ok} AND e.start_year < ({month_expr}) // 100 AND e.end_year >= ({month_expr}) // 100)"""


def stage_cols(stage, horizon_ok):
    return f"""
      CASE WHEN NOT ({horizon_ok}) THEN NULL
           WHEN {stage}_role.role IS NOT NULL THEN fam[{stage}_role.role.fn]
           WHEN {stage}_study.cred_id IS NOT NULL THEN 'further_study'
           ELSE 'no_role_listed' END AS {stage}_family,
      {role_cols(f"{stage}_role.role", stage)}"""


def role_cols(role, prefix):
    """The stage columns (fn, employer, ...) of a role struct."""
    src = dict(fn="fn", employer="parent", title="std", seniority="lvl", industry="ind", location="location")
    return ", ".join(f"{role}.{src[f]} AS {prefix}_{f}" for f in STAGE_FIELDS)


def yearly_sql():
    """CTEs for y1..y20: one row per (credential, year reached), then one wide row per credential.
    Same rule as `now`, at June of grad_year + N: the most recently started main role active
    then (ties as in TIE_BREAK); else another degree under way that year; else no role listed.
    Years whose June is after the snapshot get no row, so their columns are NULL."""
    return f"""
      year_points AS (
        SELECT c.cred_id, c.person_id, y.yr, (c.grad_year + y.yr) * 100 + 6 AS ym
        FROM creds c CROSS JOIN (SELECT range AS yr FROM range({YEARS[0]}, {YEARS[-1] + 1})) y
        WHERE (c.grad_year + y.yr) * 100 + 6 <= {SNAPSHOT_YM}),
      yr_role AS (
        SELECT p.cred_id, p.yr, first({ROLE_STRUCT} ORDER BY r.start_ym DESC, {TIE_BREAK}) AS role
        FROM year_points p JOIN main_roles r ON r.person_id = p.person_id
        WHERE NOT r.stu AND r.start_ym <= p.ym AND r.end_eff >= p.ym
        GROUP BY 1, 2),
      yr_study AS (
        SELECT DISTINCT p.cred_id, p.yr
        FROM year_points p JOIN other_edu e ON e.cred_id = p.cred_id
        WHERE e.start_year < p.ym // 100 AND e.end_year >= p.ym // 100),
      yr_stage AS (
        SELECT p.cred_id, p.yr, r.role,
               CASE WHEN r.role IS NOT NULL THEN fam[r.role.fn]
                    WHEN s.cred_id IS NOT NULL THEN 'further_study'
                    ELSE 'no_role_listed' END AS family
        FROM year_points p CROSS JOIN fam
        LEFT JOIN yr_role r ON r.cred_id = p.cred_id AND r.yr = p.yr
        LEFT JOIN yr_study s ON s.cred_id = p.cred_id AND s.yr = p.yr),
      yr_wide AS (
        SELECT cred_id,
          {", ".join(f"any_value(family) FILTER (yr = {n}) AS y{n}_family" for n in YEARS)},
          {", ".join(f"any_value(role) FILTER (yr = {n}) AS y{n}_role" for n in DETAIL_YEARS)}
        FROM yr_stage GROUP BY 1)"""


def year_cols():
    """yN_family for every year, then the role columns of the detail years."""
    cols = [f"yw.y{n}_family" for n in YEARS]
    cols += [role_cols(f"yw.y{n}_role", f"y{n}") for n in DETAIL_YEARS]
    return ",\n      ".join(cols)


def main(derived=DERIVED, proc=PROC, out=None, report=True):
    """derived: roles + credentials (05_join), proc: education (01_ingest), out: where
    paths.parquet is written (defaults to `derived`). Tests pass temp dirs."""
    out = derived if out is None else out
    Path(out).mkdir(parents=True, exist_ok=True)
    derived, proc, out = Path(derived).as_posix(), Path(proc).as_posix(), Path(out).as_posix()
    con = duckdb.connect()
    grad_levels = ", ".join(f"'{l}'" for l in GRAD_LEVELS)
    con.sql(f"""
    COPY (
    WITH
      fam AS (SELECT {sql_map(FAMILY)} AS fam),
      people_with_roles AS (
        SELECT DISTINCT person_id FROM '{derived}/roles.parquet' WHERE start_ym IS NOT NULL),
      creds AS (
        SELECT person_id || ':' || idx AS cred_id, person_id, idx, program, disc, level,
               {sql_map(LEVEL_GROUP)}[level] AS level_group, end_year AS grad_year,
               row_number() OVER (PARTITION BY person_id
                                  ORDER BY end_year, {sql_map({k: str(v) for k, v in LEVEL_RANK.items()})}[level]::int, idx)
                 AS cred_rank
        FROM '{derived}/credentials.parquet'
        WHERE level <> 'certificate' AND end_year BETWEEN {FIRST_GRAD_YEAR} AND {SNAPSHOT_YM // 100}
          AND person_id IN (SELECT person_id FROM people_with_roles)),
      main_roles AS (
        SELECT * REPLACE (coalesce(stu, false) AS stu),
               CASE WHEN is_current THEN 999912 ELSE coalesce(end_ym, start_ym) END AS end_eff
        FROM '{derived}/roles.parquet'
        WHERE NOT side AND fn IS NOT NULL AND start_ym IS NOT NULL),
      -- Every other education entry (any school) a person has, relative to each credential.
      other_edu AS (
        SELECT c.cred_id, e.person_id, e.start_year, coalesce(e.end_year, e.start_year + 1) AS end_year
        FROM creds c JOIN '{proc}/education.parquet' e ON e.person_id = c.person_id
        WHERE e.start_year IS NOT NULL AND NOT (e.is_queens AND e.idx = c.idx)
          AND coalesce(e.end_year, e.start_year + 1) > e.start_year),
      -- First job: a student-type role only counts if it began after graduating (articling,
      -- a post-grad internship). A job begun before final year counts if it ran a year past
      -- graduation (stayed on after a co-op) or the credential is a grad/professional degree.
      s0_job AS (
        SELECT c.cred_id, first({ROLE_STRUCT} ORDER BY r.start_ym, {TIE_BREAK}) AS role,
               min(r.start_ym) AS start_ym
        FROM creds c JOIN main_roles r ON r.person_id = c.person_id
        WHERE r.end_eff >= c.grad_year * 100 + 5
          AND r.start_ym <= (c.grad_year + {FIRST_JOB_WINDOW_YEARS}) * 100 + 12
          AND (NOT r.stu OR r.start_ym >= c.grad_year * 100 + 5)
          AND (r.start_ym >= (c.grad_year - 1) * 100 + 9 OR c.level IN ({grad_levels})
               OR r.end_eff >= (c.grad_year + 1) * 100 + 5)
        GROUP BY 1),
      -- Another program started within two years of graduating (law school, a master's, ...).
      s0_study AS (
        SELECT o.cred_id, min(o.start_year) AS start_year
        FROM other_edu o JOIN creds c USING (cred_id)
        WHERE o.start_year BETWEEN c.grad_year AND c.grad_year + 2
        GROUP BY 1),
      {yearly_sql()},
      {active_role_sql("now", str(SNAPSHOT_YM), "true")}
    SELECT c.*,
      CASE WHEN s0_study_first THEN 'further_study'
           WHEN s0_job.role IS NOT NULL THEN fam[s0_job.role.fn]
           ELSE 'no_role_listed' END AS s0_family,
      -- When study came first, the job fields describe nothing in this stage.
      s0_r.fn AS s0_fn, s0_r.parent AS s0_employer, s0_r.std AS s0_title,
      s0_r.lvl AS s0_seniority, s0_r.ind AS s0_industry, s0_r.location AS s0_location,
      CASE WHEN NOT s0_study_first THEN s0_job.start_ym END AS s0_start_ym,
      {year_cols()},
      {stage_cols("now", "true")}
    FROM creds c CROSS JOIN fam
    LEFT JOIN s0_job USING (cred_id) LEFT JOIN s0_study USING (cred_id)
    CROSS JOIN LATERAL (
      SELECT coalesce(s0_study.cred_id IS NOT NULL
                      AND (s0_job.start_ym IS NULL OR s0_study.start_year * 100 + 9 <= s0_job.start_ym),
                      false) AS s0_study_first,
             CASE WHEN NOT s0_study_first THEN s0_job.role END AS s0_r)
    LEFT JOIN yr_wide yw USING (cred_id)
    LEFT JOIN now_role USING (cred_id) LEFT JOIN now_study USING (cred_id)
    ) TO '{out}/paths.parquet' (FORMAT parquet, COMPRESSION zstd)""")

    if not report:
        return
    paths = f"'{out}/paths.parquet'"
    print(con.sql(f"""
        SELECT count(*) AS credentials, count(DISTINCT person_id) AS people,
               count(*) FILTER (cred_rank = 1) AS first_credentials,
               count(y5_family) AS with_y5, count(y10_family) AS with_y10, count(y20_family) AS with_y20
        FROM {paths}"""))
    for stage in ("s0", "y5", "y10", "now"):
        print(con.sql(f"""
            SELECT {stage}_family AS family, count(*) AS n,
                   round(100.0 * count(*) / sum(count(*)) OVER (), 1) AS pct
            FROM {paths} WHERE cred_rank = 1 AND {stage}_family IS NOT NULL
            GROUP BY 1 ORDER BY n DESC"""))


if __name__ == "__main__":
    main()
