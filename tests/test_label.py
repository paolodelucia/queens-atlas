"""label_spec.py and 04_label.py. Nothing here talks to the API: an autouse fixture makes any
attempt to build an Anthropic client fail the test."""

import json
import re
from types import SimpleNamespace

import pytest

import label_spec
from conftest import read_rows, write_parquet


@pytest.fixture(autouse=True)
def no_api(label, monkeypatch):
    def refuse(*a, **k):
        raise AssertionError("tests must never create an Anthropic client")
    monkeypatch.setattr(label.anthropic, "Anthropic", refuse)
    monkeypatch.setattr(label, "client", refuse)


# ── Taxonomies and prompts ───────────────────────────────────────────────────

ENUMS = {"FUNCTIONS": label_spec.FUNCTIONS, "SENIORITY": label_spec.SENIORITY,
         "INDUSTRIES": label_spec.INDUSTRIES, "DISCIPLINES": label_spec.DISCIPLINES,
         "PLACE_LEVELS": label_spec.PLACE_LEVELS}


@pytest.mark.parametrize("name", ENUMS)
def test_enums_non_empty_unique_snake_case(name):
    values = ENUMS[name]
    assert values, name
    assert len(values) == len(set(values)), f"{name} has duplicates"
    assert all(re.fullmatch(r"[a-z0-9_]+", v) for v in values), name


def test_catch_all_values_exist():
    assert "other" in label_spec.FUNCTIONS and "other" in label_spec.INDUSTRIES
    assert "unknown" in label_spec.SENIORITY and "unknown" in label_spec.PLACE_LEVELS


def prompt_fields(system):
    """Field names the prompt defines, from bullet lines like `- "fn": ...` or `- "lat", "lon": ...`."""
    names = []
    for m in re.finditer(r'^- ((?:"\w+"(?:,\s*)?)+):', system, re.M):
        names += re.findall(r'"(\w+)"', m.group(1))
    return names


@pytest.mark.parametrize("task", label_spec.TASKS)
def test_prompt_fields_match_schema(task):
    spec = label_spec.TASKS[task]
    assert prompt_fields(spec["system"]) == list(spec["schema_item"])


@pytest.mark.parametrize("task", label_spec.TASKS)
def test_task_spec(task):
    spec = label_spec.TASKS[task]
    assert set(spec) == {"system", "schema_item", "per_request"}
    assert spec["schema_item"]["i"] == {"type": "integer"}
    assert isinstance(spec["per_request"], int) and 0 < spec["per_request"] <= 500
    assert "Return every id exactly once." in spec["system"]
    assert spec["system"].startswith(label_spec.CONTEXT)
    for field, schema in spec["schema_item"].items():
        assert schema["type"] in {"integer", "string", "boolean", "number"}, field
        if "enum" in schema:
            assert schema["enum"], f"{task}.{field} enum is empty"
            missing = [v for v in schema["enum"] if v not in spec["system"]]
            assert not missing, f"{task}.{field}: enum values not offered in the prompt: {missing}"


@pytest.mark.parametrize("task", label_spec.TASKS)
def test_output_schema(task):
    item = label_spec.TASKS[task]["schema_item"]
    schema = label_spec.output_schema(task)
    assert schema["type"] == "object"
    assert schema["required"] == ["labels"] and schema["additionalProperties"] is False
    items = schema["properties"]["labels"]
    assert items["type"] == "array"
    obj = items["items"]
    assert obj["type"] == "object" and obj["additionalProperties"] is False
    assert obj["properties"] == item
    assert obj["required"] == list(item)
    json.dumps(schema)  # must be serialisable as a request body


def test_output_schema_unknown_task():
    with pytest.raises(KeyError):
        label_spec.output_schema("nope")


# ── parse() ──────────────────────────────────────────────────────────────────

CHUNK = [{"id": 3, "text": "a"}, {"id": 1, "text": "b"}, {"id": 2, "text": "c"}]


def message(text, stop="end_turn", blocks=None):
    content = blocks if blocks is not None else [SimpleNamespace(type="text", text=text)]
    return SimpleNamespace(stop_reason=stop, content=content)


def labels_json(*ids, **extra):
    return json.dumps({"labels": [{"i": i, "fn": "other", **extra} for i in ids]})


def test_parse_complete(label):
    got, missing = label.parse(message(labels_json(1, 2, 3)), CHUNK)
    assert [g["i"] for g in got] == [1, 2, 3]
    assert missing == []


def test_parse_reports_missing_ids_sorted(label):
    got, missing = label.parse(message(labels_json(3)), CHUNK)
    assert [g["i"] for g in got] == [3]
    assert missing == [1, 2]


def test_parse_keeps_first_of_duplicates(label):
    text = json.dumps({"labels": [{"i": 1, "fn": "first"}, {"i": 1, "fn": "second"}, {"i": 2}, {"i": 3}]})
    got, missing = label.parse(message(text), CHUNK)
    assert [(g["i"], g.get("fn")) for g in got] == [(1, "first"), (2, None), (3, None)]
    assert missing == []


@pytest.mark.parametrize("bad_label", [
    {"i": 99}, {"i": "1"}, {"fn": "no id"}, {"i": None}, {"i": True}, {"i": [1]}, {"i": {"x": 1}}, 1, "x", None, [1],
], ids=repr)
def test_parse_drops_ids_not_sent(label, bad_label):
    text = json.dumps({"labels": [bad_label, {"i": 3}]})
    got, missing = label.parse(message(text), CHUNK)
    assert got == [{"i": 3}]
    assert missing == [1, 2]


@pytest.mark.parametrize("text", [
    "not json", '{"labels": [', "", '{"other": []}', "[]", '"labels"', '{"labels": null}',
    '{"labels": {"i": 1}}', '{"labels": 5}',
], ids=["garbage", "truncated", "empty", "no-labels-key", "array", "string", "labels-null",
        "labels-object", "labels-number"])
def test_parse_bad_json_marks_everything_missing(label, text):
    got, missing = label.parse(message(text), CHUNK)
    assert got == []
    assert missing == [1, 2, 3]


@pytest.mark.parametrize("stop", ["max_tokens", "refusal", "pause_turn", "tool_use", None])
def test_parse_rejects_unfinished_messages(label, stop):
    got, missing = label.parse(message(labels_json(1, 2, 3), stop=stop), CHUNK)
    assert (got, missing) == ([], [1, 2, 3])


def test_parse_accepts_stop_sequence(label):
    got, missing = label.parse(message(labels_json(1, 2, 3), stop="stop_sequence"), CHUNK)
    assert len(got) == 3 and missing == []


def test_parse_uses_first_text_block(label):
    blocks = [SimpleNamespace(type="thinking", thinking="..."),
              SimpleNamespace(type="text", text=labels_json(1, 2, 3)),
              SimpleNamespace(type="text", text="ignored")]
    got, missing = label.parse(message(None, blocks=blocks), CHUNK)
    assert len(got) == 3 and missing == []


def test_parse_without_text_block(label):
    got, missing = label.parse(message(None, blocks=[SimpleNamespace(type="thinking", thinking="...")]), CHUNK)
    assert (got, missing) == ([], [1, 2, 3])


def test_parse_empty_chunk(label):
    assert label.parse(message(labels_json()), []) == ([], [])


# ── chunks(), cost(), params() ───────────────────────────────────────────────

@pytest.mark.parametrize("n, size, sizes", [
    (0, 3, []), (1, 3, [1]), (3, 3, [3]), (7, 3, [3, 3, 1]), (5, 10, [5]), (400, 200, [200, 200]),
])
def test_chunks(label, n, size, sizes):
    items = list(range(n))
    out = label.chunks(items, size)
    assert [len(c) for c in out] == sizes
    assert [x for c in out for x in c] == items


@pytest.mark.parametrize("model, batch, expected", [
    ("claude-sonnet-5-5", False, 12.0),
    ("claude-sonnet-5-5", True, 6.0),
    ("claude-haiku-5-5", True, 0.30),
    ("claude-opus-5-5", False, 24.0),
])
def test_cost_per_million_in_and_out(label, model, batch, expected):
    assert label.cost(1_000_000, 1_000_000, model, batch=batch) == pytest.approx(expected)


def test_cost_defaults_to_batch_pricing(label):
    model = label.MODELS["sonnet"]
    assert label.cost(1000, 500, model) == pytest.approx(label.cost(1000, 500, model, batch=False) / 2)
    assert label.cost(0, 0, model) == 0


def test_cost_unknown_model(label):
    with pytest.raises(KeyError):
        label.cost(1, 1, "gpt-4")


def test_every_model_is_priced_and_configured(label):
    for model in label.MODELS.values():
        assert model in label.PRICE and model in label.THINKING


@pytest.mark.parametrize("task", label_spec.TASKS)
def test_params(label, task):
    chunk = [{"id": 7, "text": "Senior Analyst"}, {"id": 8, "text": "Partner"}]
    p = label.params(task, "claude-sonnet-5-5", chunk)
    assert p["messages"] == [{"role": "user", "content": "7\tSenior Analyst\n8\tPartner"}]
    assert p["system"] == label_spec.TASKS[task]["system"]
    assert p["output_config"]["format"] == {"type": "json_schema", "schema": label_spec.output_schema(task)}
    assert p["thinking"] == label.THINKING["claude-sonnet-5-5"]
    json.dumps(p)


# ── load_items(): distinct strings with stable ids ───────────────────────────

@pytest.fixture
def labelling_cwd(tmp_path, monkeypatch, ingest):
    """A working dir with a synthetic data/processed, as 04_label.py expects (relative paths)."""
    proc = tmp_path / "data" / "processed"
    titles = ["Analyst"] * 3 + ["analyst", "  ANALYST "] + ["Partner"] * 2 + ["Senior\nAnalyst", "", "   ", None]
    companies = ["Big Bank"] * 3 + ["Tiny Co"] * 2 + ["big bank"]
    positions = [{"person_id": f"p{i}", "exp_idx": i, "pos_idx": 0, "title": t,
                  "company": companies[i] if i < len(companies) else None,
                  "location": "Toronto" if i < 3 else ("Rare Town" if i < 5 else None)}
                 for i, t in enumerate(titles)]
    education = [
        {"person_id": "p1", "idx": 0, "is_queens": True, "field": "Economics"},
        {"person_id": "p2", "idx": 0, "is_queens": True, "field": "Economics"},
        {"person_id": "p3", "idx": 0, "is_queens": True, "field": "economics "},
        {"person_id": "p2", "idx": 1, "is_queens": False, "field": "Not Queen's Field"},
    ]
    people = [{"person_id": "p1", "city": "Kingston"}]
    write_parquet(proc / "positions.parquet", positions, ingest.SCHEMAS["positions"])
    write_parquet(proc / "education.parquet", education, ingest.SCHEMAS["education"])
    write_parquet(proc / "people.parquet", people, ingest.SCHEMAS["people"])
    monkeypatch.chdir(tmp_path)
    return tmp_path


def test_load_items_titles(label, labelling_cwd):
    items = label.load_items("titles")
    texts = [(it["id"], it["text"], it["uses"]) for it in items]
    # Case/space variants are one item shown in their most common spelling; ids go by use count.
    assert texts[0] == (0, "Analyst", 5)
    assert texts[1] == (1, "Partner", 2)
    assert (2, "Senior Analyst", 1) in texts                 # newline flattened for the prompt line
    assert all(it["text"].strip() for it in items)          # blank titles are not labelled
    assert (labelling_cwd / "data" / "labels" / "titles_items.parquet").exists()


def test_load_items_is_cached(label, labelling_cwd, ingest):
    first = label.load_items("titles")
    write_parquet(labelling_cwd / "data" / "processed" / "positions.parquet",
                  [{"person_id": "x", "title": "Changed"}], ingest.SCHEMAS["positions"])
    assert label.load_items("titles") == first


def test_load_items_companies_need_three_roles(label, labelling_cwd):
    items = label.load_items("companies")
    assert [(it["text"], it["uses"]) for it in items] == [("Big Bank", 4)]


def test_load_items_fields_are_queens_only(label, labelling_cwd):
    items = label.load_items("fields")
    assert [(it["text"], it["uses"]) for it in items] == [("Economics", 3)]


def test_load_items_places(label, labelling_cwd):
    items = {it["text"]: it["uses"] for it in label.load_items("places")}
    # Home cities are always kept; job locations need MIN_PLACE_USES (3) uses, so "Rare Town" (2) is not.
    assert items == {"Toronto": 3, "Kingston": 1}


def test_items_ids_are_dense_and_unique(label, labelling_cwd):
    for task in ("titles", "companies", "fields", "places"):
        ids = [it["id"] for it in label.load_items(task)]
        assert ids == list(range(len(ids))), task
        rows = read_rows(labelling_cwd / "data" / "labels" / f"{task}_items.parquet")
        assert len(rows) == len(ids)
