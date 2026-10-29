"""
04_label.py
-----------
LLM labelling of distinct job titles, companies, Queen's fields of study and locations.

    python pipeline/04_label.py pilot   [--models sonnet,haiku]     # small sync run + cost projection
    python pipeline/04_label.py submit  --model sonnet [--tasks titles,companies,fields]
    python pipeline/04_label.py collect                               # poll batches, write labels
    python pipeline/04_label.py run     --task places                 # small task, synchronous

Outputs (all under data/labels/, gitignored):
    {task}_items.parquet        id -> text -> how many roles/entries use it
    pilot_{model}_{task}.parquet
    {task}.parquet              final labels from the batch run
    batches.json                submitted batch ids
"""

import argparse
import json
import os
import random
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import anthropic
import duckdb
import pyarrow as pa
import pyarrow.parquet as pq
from anthropic.types.message_create_params import MessageCreateParamsNonStreaming
from anthropic.types.messages.batch_create_params import Request

sys.path.insert(0, str(Path(__file__).parent))
from label_spec import TASKS, output_schema  # noqa: E402

PROC = Path("data/processed")
OUT = Path("data/labels")
BATCHES = OUT / "batches.json"
MIN_COMPANY_ROLES = 3
MIN_PLACE_USES = 3

MODELS = {"sonnet": "claude-sonnet-5-5", "haiku": "claude-haiku-5-5", "opus": "claude-opus-5-5"}
PRICE = {  # standard $/1M tokens (input, output); Batch API is 50% of these
    "claude-sonnet-5-5": (2.00, 10.00),
    "claude-haiku-5-5": (0.10, 0.50),
    "claude-opus-5-5": (4.00, 20.00),
}
# Thinking adds nothing for single-label classification, so turn it off where the model allows.
THINKING = {
    "claude-sonnet-5-5": {"type": "between_tools"},  # Sonnet 5.5's thinking-off mode
    "claude-haiku-5-5": {"type": "disabled"},
    "claude-opus-5-5": {"type": "adaptive"},          # cannot be disabled on Opus 5.5
}


def client():
    # The key lives in the Windows user environment; shells started earlier don't inherit it.
    if not os.environ.get("ANTHROPIC_API_KEY") and sys.platform == "win32":
        import winreg
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, "Environment") as k:
            os.environ["ANTHROPIC_API_KEY"] = winreg.QueryValueEx(k, "ANTHROPIC_API_KEY")[0]
    return anthropic.Anthropic(max_retries=5)


# ── Items ────────────────────────────────────────────────────────────────────

ITEM_SQL = {
    # One row per distinct lower-cased string; display the most common raw spelling.
    "titles": f"""
        SELECT arg_max(raw, n) AS text, sum(n) AS uses FROM (
            SELECT title AS raw, lower(trim(title)) AS k, count(*) AS n
            FROM '{PROC}/positions.parquet' WHERE nullif(trim(title), '') IS NOT NULL GROUP BY 1, 2)
        GROUP BY k""",
    "companies": f"""
        SELECT arg_max(raw, n) AS text, sum(n) AS uses FROM (
            SELECT company AS raw, lower(trim(company)) AS k, count(*) AS n
            FROM '{PROC}/positions.parquet' WHERE nullif(trim(company), '') IS NOT NULL GROUP BY 1, 2)
        GROUP BY k HAVING sum(n) >= {MIN_COMPANY_ROLES}""",
    "fields": f"""
        SELECT arg_max(raw, n) AS text, sum(n) AS uses FROM (
            SELECT field AS raw, lower(trim(field)) AS k, count(*) AS n
            FROM '{PROC}/education.parquet'
            WHERE is_queens AND nullif(trim(field), '') IS NOT NULL GROUP BY 1, 2)
        GROUP BY k""",
    # Where people live now (every string, so everyone can be placed) plus job locations
    # used at least MIN_PLACE_USES times.
    "places": f"""
        SELECT arg_max(raw, n) AS text, sum(n) AS uses FROM (
            SELECT raw, lower(trim(raw)) AS k, count(*) AS n, bool_or(is_home) AS is_home FROM (
                SELECT city AS raw, true AS is_home FROM '{PROC}/people.parquet'
                UNION ALL
                SELECT location, false FROM '{PROC}/positions.parquet')
            WHERE nullif(trim(raw), '') IS NOT NULL GROUP BY 1, 2)
        GROUP BY k HAVING bool_or(is_home) OR sum(n) >= {MIN_PLACE_USES}""",
}


def load_items(task):
    """Stable ids: most-used first, ties broken alphabetically. Cached to parquet so
    batch results can always be joined back to the exact strings that were sent."""
    path = OUT / f"{task}_items.parquet"
    if not path.exists():
        OUT.mkdir(parents=True, exist_ok=True)
        duckdb.sql(f"""
            COPY (SELECT row_number() OVER (ORDER BY uses DESC, text) - 1 AS id,
                         replace(replace(text, '\t', ' '), '\n', ' ') AS text, uses
                  FROM ({ITEM_SQL[task]}))
            TO '{path}' (FORMAT parquet)""")
    return pq.read_table(path).to_pylist()


def chunks(items, size):
    return [items[i:i + size] for i in range(0, len(items), size)]


# ── Requests ─────────────────────────────────────────────────────────────────

def params(task, model, chunk):
    lines = "\n".join(f"{it['id']}\t{it['text']}" for it in chunk)
    return {
        "model": model,
        "max_tokens": 16000,
        "system": TASKS[task]["system"],
        "thinking": THINKING[model],
        "output_config": {"effort": "low",
                          "format": {"type": "json_schema", "schema": output_schema(task)}},
        "messages": [{"role": "user", "content": lines}],
    }


def parse(message, chunk):
    """Returns (labels, missing_ids). Labels for ids we didn't send are dropped."""
    sent = {it["id"] for it in chunk}
    if message.stop_reason not in ("end_turn", "stop_sequence"):
        return [], sorted(sent)
    text = next((b.text for b in message.content if b.type == "text"), "")
    try:
        labels = json.loads(text)["labels"]
    except (json.JSONDecodeError, KeyError, TypeError):  # TypeError: valid JSON, wrong shape
        return [], sorted(sent)
    if not isinstance(labels, list):
        return [], sorted(sent)
    seen, out = set(), []
    for lab in labels:
        i = lab.get("i") if isinstance(lab, dict) else None
        if isinstance(i, int) and not isinstance(i, bool) and i in sent and i not in seen:
            seen.add(i)
            out.append(lab)
    return out, sorted(sent - seen)


def cost(usage_in, usage_out, model, batch=True):
    pin, pout = PRICE[model]
    mult = 0.5 if batch else 1.0
    return (usage_in * pin + usage_out * pout) / 1e6 * mult


# ── Pilot ────────────────────────────────────────────────────────────────────

def pilot(models):
    c = client()
    rng = random.Random(42)
    plan = []  # (task, kind, chunk)
    for task in TASKS:
        items = load_items(task)
        size = TASKS[task]["per_request"]
        n_random = 2 if task == "titles" else 1
        for _ in range(n_random):
            plan.append((task, "random", rng.sample(items, min(size, len(items)))))
        if task == "titles":
            plan.append((task, "top", items[:size]))

    jobs = [(m, task, kind, ch) for m in models for task, kind, ch in plan]

    def run(job):
        m, task, kind, ch = job
        t0 = time.time()
        msg = c.messages.create(**params(task, MODELS[m], ch))
        labels, missing = parse(msg, ch)
        return {"model": m, "task": task, "kind": kind, "n": len(ch), "labels": labels,
                "missing": missing, "in": msg.usage.input_tokens, "out": msg.usage.output_tokens,
                "stop": msg.stop_reason, "secs": time.time() - t0}

    print(f"Running {len(jobs)} pilot requests...", file=sys.stderr)
    with ThreadPoolExecutor(6) as ex:
        results = list(ex.map(run, jobs))

    # Save pilot labels joined to their source text for eyeballing
    for m in models:
        for task in TASKS:
            text = {it["id"]: it for it in load_items(task)}
            rows = [{**lab, "text": text[lab["i"]]["text"], "uses": text[lab["i"]]["uses"], "kind": r["kind"]}
                    for r in results if r["model"] == m and r["task"] == task for lab in r["labels"]]
            pq.write_table(pa.Table.from_pylist(rows), OUT / f"pilot_{m}_{task}.parquet")

    report(results, models)


def report(results, models):
    spent = sum(cost(r["in"], r["out"], MODELS[r["model"]], batch=False) for r in results)
    print("\n== Pilot requests")
    print(f"{'model':7} {'task':10} {'kind':7} {'items':>5} {'in_tok':>7} {'out_tok':>7} "
          f"{'missing':>7} {'stop':>9} {'secs':>5}")
    for r in results:
        print(f"{r['model']:7} {r['task']:10} {r['kind']:7} {r['n']:5} {r['in']:7} {r['out']:7} "
              f"{len(r['missing']):7} {r['stop']:>9} {r['secs']:5.0f}")
    print(f"\nPilot spend (standard pricing): ${spent:.2f}")

    print("\n== Projected full run (Batch API, 50% off), from the random-sample requests")
    print(f"{'model':7} {'task':10} {'items':>8} {'requests':>8} {'in_M':>6} {'out_M':>6} {'cost':>8}")
    for m in models:
        total = 0.0
        for task in TASKS:
            rs = [r for r in results if r["model"] == m and r["task"] == task and r["kind"] == "random"]
            if not rs:
                continue
            n_items = len(load_items(task))
            in_per_item = sum(r["in"] for r in rs) / sum(r["n"] for r in rs)
            out_per_item = sum(r["out"] for r in rs) / sum(r["n"] for r in rs)
            tin, tout = in_per_item * n_items, out_per_item * n_items
            cst = cost(tin, tout, MODELS[m])
            total += cst
            n_req = -(-n_items // TASKS[task]["per_request"])
            print(f"{m:7} {task:10} {n_items:8,} {n_req:8,} {tin / 1e6:6.2f} {tout / 1e6:6.2f} ${cst:7.2f}")
        print(f"{m:7} {'TOTAL':10} {'':8} {'':8} {'':6} {'':6} ${total:7.2f}")


# ── Batch submit / collect ───────────────────────────────────────────────────

def load_batches():
    return json.loads(BATCHES.read_text()) if BATCHES.exists() else []


def batch_items(task, item_ids=None):
    items = load_items(task)
    if item_ids is not None:
        wanted = set(item_ids)
        items = [it for it in items if it["id"] in wanted]
    return items


def submit(model_key, tasks, retry=False):
    """retry=True resubmits only the ids in {task}_missing.json, in smaller chunks."""
    c = client()
    model = MODELS[model_key]
    batches = load_batches()
    for task in tasks:
        item_ids, size, prefix = None, TASKS[task]["per_request"], task
        if retry:
            item_ids = json.loads((OUT / f"{task}_missing.json").read_text())
            if not item_ids:
                print(f"{task}: nothing to retry")
                continue
            size, prefix = 50, f"{task}-r{sum(e['task'] == task for e in batches)}"
        reqs = [Request(custom_id=f"{prefix}-{k:05d}",
                        params=MessageCreateParamsNonStreaming(**params(task, model, ch)))
                for k, ch in enumerate(chunks(batch_items(task, item_ids), size))]
        b = c.messages.batches.create(requests=reqs)
        batches.append({"task": task, "model": model, "id": b.id, "requests": len(reqs),
                        "prefix": prefix, "chunk": size, "item_ids": item_ids,
                        "created": time.strftime("%Y-%m-%d %H:%M:%S")})
        BATCHES.write_text(json.dumps(batches, indent=2))
        print(f"Submitted {task}{' retry' if retry else ''}: {len(reqs)} requests -> {b.id}")


def collect():
    c = client()
    batches = load_batches()
    for entry in batches:
        b = c.messages.batches.retrieve(entry["id"])
        rc = b.request_counts
        print(f"{entry['task']:10} {entry['id']} {b.processing_status:12} "
              f"ok={rc.succeeded} err={rc.errored} processing={rc.processing}")
        if b.processing_status != "ended" or entry.get("collected"):
            continue
        task = entry["task"]
        prefix, size = entry.get("prefix", task), entry.get("chunk", TASKS[task]["per_request"])
        items = batch_items(task, entry.get("item_ids"))
        chunk_by_id = {f"{prefix}-{k:05d}": ch for k, ch in enumerate(chunks(items, size))}
        labels, missing, tin, tout = [], [], 0, 0
        for res in c.messages.batches.results(entry["id"]):
            ch = chunk_by_id[res.custom_id]
            if res.result.type != "succeeded":
                missing += [it["id"] for it in ch]
                continue
            msg = res.result.message
            tin, tout = tin + msg.usage.input_tokens, tout + msg.usage.output_tokens
            got, miss = parse(msg, ch)
            labels += got
            missing += miss
        path = OUT / f"{task}.parquet"
        if entry.get("item_ids") is not None and path.exists():  # retry: merge into earlier labels
            have = pq.read_table(path).to_pylist()
            done = {lab["i"] for lab in have}
            labels = have + [lab for lab in labels if lab["i"] not in done]
            missing = sorted({it["id"] for it in load_items(task)} - {lab["i"] for lab in labels})
        pq.write_table(pa.Table.from_pylist(labels), path)
        (OUT / f"{task}_missing.json").write_text(json.dumps(missing))
        entry.update(collected=True, labelled=len(labels), missing=len(missing),
                     cost=round(cost(tin, tout, entry["model"]), 2))
        print(f"  -> {len(labels):,} labels, {len(missing):,} missing, ${entry['cost']:.2f}")
        BATCHES.write_text(json.dumps(batches, indent=2))


# ── Direct run (small tasks) ─────────────────────────────────────────────────

def run_direct(model_key, task, workers=8, max_rounds=3):
    """Synchronous, concurrent run at standard pricing: minutes instead of a batch's
    turnaround, worth it for small tasks. Missing ids are retried in smaller chunks."""
    c = client()
    model = MODELS[model_key]
    path = OUT / f"{task}.parquet"
    labels = pq.read_table(path).to_pylist() if path.exists() else []
    all_ids = {it["id"] for it in load_items(task)}
    tin = tout = 0

    def call(ch):
        msg = c.messages.create(**params(task, model, ch))
        return msg, ch

    for rnd in range(max_rounds):
        todo = sorted(all_ids - {lab["i"] for lab in labels})
        if not todo:
            break
        size = TASKS[task]["per_request"] if rnd == 0 else 50
        work = chunks(batch_items(task, todo), size)
        print(f"{task} round {rnd}: {len(todo):,} items in {len(work)} requests", file=sys.stderr)
        with ThreadPoolExecutor(workers) as ex:
            for msg, ch in ex.map(call, work):
                tin, tout = tin + msg.usage.input_tokens, tout + msg.usage.output_tokens
                labels += parse(msg, ch)[0]
        pq.write_table(pa.Table.from_pylist(labels), path)

    missing = sorted(all_ids - {lab["i"] for lab in labels})
    (OUT / f"{task}_missing.json").write_text(json.dumps(missing))
    print(f"{task}: {len(labels):,} labels, {len(missing):,} missing, "
          f"${cost(tin, tout, model, batch=False):.2f}")


def main():
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("pilot")
    p.add_argument("--models", default="sonnet,haiku")
    s = sub.add_parser("submit")
    s.add_argument("--model", required=True, choices=MODELS)
    s.add_argument("--tasks", default=",".join(TASKS))
    s.add_argument("--retry", action="store_true", help="resubmit only missing ids")
    sub.add_parser("collect")
    r = sub.add_parser("run", help="synchronous run for a small task")
    r.add_argument("--model", default="sonnet", choices=MODELS)
    r.add_argument("--task", required=True, choices=TASKS)
    a = ap.parse_args()
    if a.cmd == "pilot":
        pilot(a.models.split(","))
    elif a.cmd == "submit":
        submit(a.model, a.tasks.split(","), a.retry)
    elif a.cmd == "run":
        run_direct(a.model, a.task)
    else:
        collect()


if __name__ == "__main__":
    main()
