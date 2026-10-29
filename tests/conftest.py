"""
Shared test helpers.

The pipeline scripts have numeric names (`01_ingest.py`), which `import` can't handle, so
`load_pipeline("05_join")` imports them by path. Every fixture builds tiny synthetic tables in
tmp_path; nothing here reads data/raw, and tests never print per-person values.
"""

import importlib.util
import os
import subprocess
import sys
from pathlib import Path

import duckdb
import pyarrow as pa
import pyarrow.parquet as pq
import pytest

ROOT = Path(__file__).resolve().parents[1]
PIPELINE = ROOT / "pipeline"
PYTHON = sys.executable


def load_pipeline(stem):
    """Import pipeline/<stem>.py as module `pipeline_<stem>` (cached in sys.modules)."""
    name = f"pipeline_{stem}"
    if name not in sys.modules:
        spec = importlib.util.spec_from_file_location(name, PIPELINE / f"{stem}.py")
        module = importlib.util.module_from_spec(spec)
        sys.modules[name] = module
        spec.loader.exec_module(module)
    return sys.modules[name]


@pytest.fixture(scope="session")
def ingest():
    return load_pipeline("01_ingest")


@pytest.fixture(scope="session")
def label():
    return load_pipeline("04_label")


@pytest.fixture(scope="session")
def join():
    return load_pipeline("05_join")


@pytest.fixture(scope="session")
def paths_mod():
    return load_pipeline("06_paths")


@pytest.fixture(scope="session")
def river():
    return load_pipeline("07_export_river")


@pytest.fixture(scope="session")
def site():
    return load_pipeline("08_export_site")


# ── Synthetic tables ─────────────────────────────────────────────────────────

def write_parquet(path, rows, schema=None):
    """Write dict rows to parquet. With a schema, missing columns are filled with nulls."""
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    if schema is not None:
        rows = [{name: r.get(name) for name in schema.names} for r in rows]
        table = pa.Table.from_pylist(rows, schema=schema)
    else:
        table = pa.Table.from_pylist(rows)
    pq.write_table(table, path)
    return path


def read_rows(path, order_by=None):
    """Parquet -> list of dicts (NULL -> None), optionally ordered."""
    sql = f"SELECT * FROM '{Path(path).as_posix()}'" + (f" ORDER BY {order_by}" if order_by else "")
    cur = duckdb.connect().execute(sql)
    cols = [d[0] for d in cur.description]
    return [dict(zip(cols, row)) for row in cur.fetchall()]


S, I, B = pa.string(), pa.int64(), pa.bool_()

# What 05_join writes to roles.parquet, reduced to the columns 06_paths reads.
ROLES_SCHEMA = pa.schema([
    ("person_id", S), ("exp_idx", I), ("pos_idx", I), ("company", S), ("title", S),
    ("location", S), ("start_ym", I), ("end_ym", I), ("is_current", B),
    ("fn", S), ("lvl", S), ("std", S), ("stu", B), ("ind", S), ("parent", S), ("side", B)])

# What 05_join writes to credentials.parquet.
CREDENTIALS_SCHEMA = pa.schema([
    ("person_id", S), ("idx", I), ("degree", S), ("field", S), ("start_year", I), ("end_year", I),
    ("program", S), ("disc", S), ("level", S), ("level_inferred", B)])

LABEL_SCHEMAS = {
    "titles": pa.schema([("i", I), ("fn", S), ("lvl", S), ("std", S), ("stu", B), ("amb", B)]),
    "companies": pa.schema([("i", I), ("ind", S), ("parent", S)]),
    "fields": pa.schema([("i", I), ("prog", S), ("disc", S)]),
}
ITEMS_SCHEMA = pa.schema([("id", I), ("text", S), ("uses", I)])


def write_labels(labels_dir, task, labelled):
    """labelled: [(text, {label fields})]. Writes {task}_items.parquet and {task}.parquet
    the way 04_label.py does (ids are positions in the list)."""
    items = [{"id": i, "text": text, "uses": 1} for i, (text, _) in enumerate(labelled)]
    labs = [{"i": i, **lab} for i, (_, lab) in enumerate(labelled)]
    write_parquet(Path(labels_dir) / f"{task}_items.parquet", items, ITEMS_SCHEMA)
    write_parquet(Path(labels_dir) / f"{task}.parquet", labs, LABEL_SCHEMAS[task])


def run_script(script, cwd, *args, timeout=120):
    """Run a pipeline script as the CLI does, from `cwd` (which holds a synthetic data/)."""
    env = {**os.environ, "PYTHONIOENCODING": "utf-8"}  # DuckDB tables print box-drawing chars
    return subprocess.run([PYTHON, str(PIPELINE / script), *args], cwd=cwd, env=env,
                          capture_output=True, text=True, encoding="utf-8", timeout=timeout)
