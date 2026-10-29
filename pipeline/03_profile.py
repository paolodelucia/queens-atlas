"""
03_profile.py
-------------
Coverage report: what share of the data is usable for each Atlas view?
Prints aggregates only (no names) so the output is safe to share.

    .venv/Scripts/python pipeline/03_profile.py
"""

import duckdb
import sys

# DuckDB prints box-drawing tables; a redirected stdout on Windows defaults to cp1252.
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")


con = duckdb.connect()
for t in ("people", "education", "positions"):
    con.execute(f"CREATE VIEW {t} AS SELECT * FROM 'data/processed/{t}.parquet'")


def show(title, sql, n=25):
    print(f"\n== {title}")
    con.sql(sql).show(max_rows=n, max_width=140)


show("Headline counts", """
    SELECT
      (SELECT count(*) FROM people)                                        AS profiles,
      (SELECT count(DISTINCT person_id) FROM education WHERE is_queens)    AS with_queens_edu,
      (SELECT count(*) FROM people WHERE n_experience > 0)                 AS with_experience,
      (SELECT count(*) FROM positions)                                     AS roles,
      (SELECT count(*) FROM positions WHERE start_ym IS NOT NULL)          AS roles_with_start,
      (SELECT count(DISTINCT lower(trim(title))) FROM positions)           AS distinct_titles,
      (SELECT count(DISTINCT coalesce(company_id, lower(company))) FROM positions) AS distinct_companies
""")

show("Queen's education entries: how often do we know the grad year?", """
    SELECT count(*) AS queens_entries,
           round(100.0 * count(end_year) / count(*), 1)   AS pct_end_year,
           round(100.0 * count(start_year) / count(*), 1) AS pct_start_year,
           round(100.0 * count(field) / count(*), 1)      AS pct_field,
           round(100.0 * count(degree) / count(*), 1)     AS pct_degree
    FROM education WHERE is_queens
""")

show("Queen's grad year by decade (latest Queen's entry per person)", """
    WITH q AS (SELECT person_id, max(end_year) AS grad FROM education
               WHERE is_queens AND end_year BETWEEN 1940 AND 2032 GROUP BY 1)
    SELECT (grad // 5) * 5 AS cohort_5yr, count(*) AS people FROM q GROUP BY 1 ORDER BY 1
""", 30)

show("Top Queen's fields of study (raw, before normalization)", """
    SELECT field, count(*) AS n FROM education WHERE is_queens AND field IS NOT NULL
    GROUP BY 1 ORDER BY n DESC LIMIT 25
""")

show("Top Queen's degree strings (raw)", """
    SELECT degree, count(*) AS n FROM education WHERE is_queens AND degree IS NOT NULL
    GROUP BY 1 ORDER BY n DESC LIMIT 15
""")

show("Where alumni are now (country)", """
    SELECT country_code, count(*) AS people, round(100.0 * count(*) / sum(count(*)) OVER (), 1) AS pct
    FROM people GROUP BY 1 ORDER BY people DESC LIMIT 12
""")

show("Top current cities", """
    SELECT city, count(*) AS people FROM people WHERE city IS NOT NULL
    GROUP BY 1 ORDER BY people DESC LIMIT 15
""")

show("Top employers (ever held a role there)", """
    SELECT company, count(DISTINCT person_id) AS alumni FROM positions WHERE company IS NOT NULL
    GROUP BY 1 ORDER BY alumni DESC LIMIT 25
""")

show("Title long tail: how many distinct titles cover X% of roles?", """
    WITH t AS (SELECT lower(trim(title)) AS t, count(*) AS n FROM positions
               WHERE title IS NOT NULL GROUP BY 1),
         c AS (SELECT n, sum(n) OVER (ORDER BY n DESC ROWS UNBOUNDED PRECEDING) / sum(n) OVER () AS cum,
                      row_number() OVER (ORDER BY n DESC) AS rk FROM t)
    SELECT min(rk) FILTER (WHERE cum >= 0.5) AS titles_for_50pct,
           min(rk) FILTER (WHERE cum >= 0.8) AS titles_for_80pct,
           min(rk) FILTER (WHERE cum >= 0.95) AS titles_for_95pct,
           count(*) AS distinct_titles,
           count(*) FILTER (WHERE n = 1) AS singleton_titles
    FROM c
""")

show("Profile richness: roles per person", """
    SELECT CASE WHEN n = 0 THEN '0' WHEN n <= 2 THEN '1-2' WHEN n <= 5 THEN '3-5'
                WHEN n <= 10 THEN '6-10' ELSE '11+' END AS roles, count(*) AS people
    FROM (SELECT p.person_id, count(r.person_id) AS n FROM people p
          LEFT JOIN positions r USING (person_id) GROUP BY 1)
    GROUP BY 1 ORDER BY min(n)
""")
