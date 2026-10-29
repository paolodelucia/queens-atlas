"""
02_snapshot_date.py
-------------------
The scrape has no timestamp, so we triangulate it from three independent signals:

  1. "Present" roles: LinkedIn shows "Jan 2025 - Present · 9 months", counting
     months inclusively. So start_month + duration - 1 = the month the page was
     rendered. The mode across ~100k current roles pins the scrape month.
  2. Activity IDs: LinkedIn post/activity IDs are snowflakes whose top 41 bits
     are a ms timestamp. A profile can't show activity from after it was scraped,
     so per-profile max(activity time) is a lower bound on that profile's scrape
     time; the upper envelope across profiles approximates the scrape window.
  3. (Outside the data) the Bright Data-style export file name.

    .venv/Scripts/python pipeline/02_snapshot_date.py
"""

import duckdb
import sys

# DuckDB prints box-drawing tables; a redirected stdout on Windows defaults to cp1252.
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")


con = duckdb.connect()
con.execute("CREATE VIEW positions AS SELECT * FROM 'data/processed/positions.parquet'")
con.execute("CREATE VIEW activity AS SELECT * FROM 'data/processed/activity.parquet'")


def show(title, sql):
    print(f"\n== {title}")
    print(con.sql(sql))


# 1. Present-role arithmetic -------------------------------------------------
show("Implied render month from 'Present' roles (start + duration - 1)", """
    WITH r AS (
        SELECT start_ym, duration_months,
               (start_ym // 100) * 12 + (start_ym % 100 - 1) + duration_months - 1 AS m
        FROM positions
        WHERE is_current AND start_month_known AND duration_months IS NOT NULL
    )
    SELECT printf('%d-%02d', m // 12, m % 12 + 1) AS implied_month,
           count(*) AS roles,
           round(100.0 * count(*) / sum(count(*)) OVER (), 2) AS pct
    FROM r GROUP BY m ORDER BY roles DESC LIMIT 8
""")

# 2. Activity timestamps -----------------------------------------------------
show("Latest activity timestamps seen anywhere", """
    SELECT strftime(make_timestamp(ts_ms * 1000), '%Y-%m-%d %H:%M') AS ts, kind, interaction
    FROM activity WHERE ts_ms IS NOT NULL ORDER BY ts_ms DESC LIMIT 5
""")

show("Per-profile newest activity: distribution of the top end", """
    WITH p AS (SELECT person_id, max(ts_ms) AS newest FROM activity
               WHERE ts_ms IS NOT NULL GROUP BY 1)
    SELECT unnest([0.5, 0.9, 0.99, 0.999, 1.0]) AS quantile,
           unnest(list_transform(quantile_disc(newest, [0.5, 0.9, 0.99, 0.999, 1.0]),
                  lambda x: strftime(make_timestamp(x * 1000), '%Y-%m-%d'))) AS newest_activity
    FROM p
""")

show("Profiles by date of their newest activity (last 30 days of window)", """
    WITH p AS (SELECT person_id, max(ts_ms) AS newest FROM activity
               WHERE ts_ms IS NOT NULL GROUP BY 1),
         d AS (SELECT make_timestamp(newest * 1000)::DATE AS day FROM p)
    SELECT day, count(*) AS profiles FROM d
    WHERE day > (SELECT max(day) FROM d) - INTERVAL 30 DAY
    GROUP BY day ORDER BY day
""")
