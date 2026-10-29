"""sdc.py: record keys, cell keys, the perturbation table and the salt."""

import collections
import random

import pytest

import sdc

SALT = "unit-test-salt-0123456789abcdef"


def keysum(ids, salt=SALT):
    return sum(sdc.rkeys(ids, salt))


# ── Record keys ──────────────────────────────────────────────────────────────

def test_rkey_is_deterministic_and_in_range():
    assert sdc.rkey("person-1", SALT) == sdc.rkey("person-1", SALT)
    keys = sdc.rkeys([f"p{i}" for i in range(2000)], SALT)
    assert all(0 <= k < sdc.KEY_MOD for k in keys)
    assert len(set(keys)) > 1990                       # 32-bit keys: collisions are rare
    assert sdc.rkeys(["a", "b", "a"], SALT) == [sdc.rkey("a", SALT), sdc.rkey("b", SALT), sdc.rkey("a", SALT)]


def test_rkey_depends_on_the_salt():
    ids = [f"p{i}" for i in range(50)]
    assert sdc.rkeys(ids, SALT) != sdc.rkeys(ids, SALT + "x")


def test_record_keys_look_uniform():
    keys = sdc.rkeys([f"p{i}" for i in range(20000)], SALT)
    deciles = collections.Counter(k * 10 // sdc.KEY_MOD for k in keys)
    assert all(1800 < deciles[d] < 2200 for d in range(10))


@pytest.mark.parametrize("salt", [None, "", "short"])
def test_a_salt_is_required(salt):
    with pytest.raises(ValueError):
        sdc.rkey("p1", salt)
    with pytest.raises(ValueError):
        sdc.rkeys(["p1"], salt)


def test_load_salt_refuses_a_missing_file(tmp_path):
    with pytest.raises(FileNotFoundError):
        sdc.load_salt(tmp_path / "secret" / "salt.txt")


def test_load_salt_creates_once_then_reuses(tmp_path, capsys):
    path = tmp_path / "secret" / "salt.txt"
    salt = sdc.load_salt(path, create=True)
    assert len(salt) == 64 and int(salt, 16) >= 0
    assert "created" in capsys.readouterr().out
    assert sdc.load_salt(path, create=True) == salt == sdc.load_salt(path)
    assert capsys.readouterr().out == ""


def test_load_salt_rejects_an_empty_file(tmp_path):
    path = tmp_path / "salt.txt"
    path.write_text("\n")
    with pytest.raises(ValueError):
        sdc.load_salt(path)


def test_the_real_salt_location_is_gitignored():
    """data/ is gitignored as a whole; the salt must stay inside it."""
    assert sdc.SALT_PATH.parts[0] == "data"
    from conftest import ROOT
    assert "/data/" in (ROOT / ".gitignore").read_text().splitlines()


# ── Cell keys and noise ──────────────────────────────────────────────────────

def test_same_contributors_same_noise_in_any_order():
    people = [f"p{i}" for i in range(37)]
    shuffled = people[:]
    random.Random(3).shuffle(shuffled)
    assert keysum(people) == keysum(shuffled)
    assert sdc.perturb(37, keysum(people)) == sdc.perturb(37, keysum(shuffled))
    assert sdc.cell_key(keysum(people)) == sdc.cell_key(keysum(shuffled))


def test_cell_key_is_the_fractional_part_of_the_record_key_sum():
    a, b = sdc.rkey("a", SALT), sdc.rkey("b", SALT)
    assert sdc.cell_key(a + b) == ((a / sdc.KEY_MOD + b / sdc.KEY_MOD) % 1)
    assert sdc.cell_key(0) == 0 and 0 <= sdc.cell_key(sdc.KEY_MOD * 7 - 1) < 1


def test_perturbation_table_bands():
    edge = lambda tenths: sdc.KEY_MOD * tenths // 10
    assert [sdc.noise(edge(t)) for t in (0, 4, 6, 8, 9)] == [0, 1, -1, 2, -2]
    assert [sdc.noise(edge(t) - 1) for t in (4, 6, 8, 9, 10)] == [0, 1, -1, 2, -2]
    assert sdc.noise(None) == 0 and sdc.MAX_NOISE == 2


def test_noise_is_zero_mean_with_the_table_distribution():
    rng = random.Random(11)
    keys = sdc.rkeys([f"p{i}" for i in range(100000)], SALT)
    cells = [rng.sample(range(100000), rng.randint(10, 200)) for _ in range(20000)]
    noise = [sdc.noise(sum(keys[i] for i in c)) for c in cells]
    freq = collections.Counter(noise)
    assert set(freq) == {-2, -1, 0, 1, 2}
    for value, tenths in sdc.PTABLE:
        assert abs(freq[value] / len(noise) - tenths / 10) < 0.015, value
    assert abs(sum(noise) / len(noise)) < 0.03


def test_perturb_stays_within_the_bound_and_never_under_k():
    rng = random.Random(5)
    for n in [10, 11, 12, 13, 50, 1000]:
        for _ in range(300):
            out = sdc.perturb(n, rng.randrange(10 * sdc.KEY_MOD))
            assert out >= sdc.K
            assert abs(out - n) <= sdc.MAX_NOISE
    assert sdc.perturb(10, sdc.KEY_MOD * 9 // 10) == 10          # 10 - 2 floors at k
    assert sdc.perturb(100, 0) == 100


def test_perturb_refuses_counts_under_k():
    for n in (0, 1, 9):
        with pytest.raises(ValueError):
            sdc.perturb(n, 123)
    assert sdc.perturb_ge_k(9, 123) is None and sdc.perturb_ge_k(None, 0) is None
    assert sdc.perturb_ge_k(10, 0) == 10


def test_cap_only_looks_at_published_limits():
    assert sdc.cap(15, 12, None, 20) == 12
    assert sdc.cap(15) == 15 and sdc.cap(None, 3) is None


# ── The two floors and publish_parts ─────────────────────────────────────────

def test_two_floors():
    assert (sdc.K_FIELD, sdc.K_NAMED) == (5, 10)
    assert sdc.K == sdc.K_NAMED                       # perturb()'s default is the strict floor


def test_perturb_at_the_field_floor():
    rng = random.Random(9)
    for n in (5, 6, 7, 9):
        outs = {sdc.perturb(n, rng.randrange(10 * sdc.KEY_MOD), sdc.K_FIELD) for _ in range(400)}
        assert min(outs) >= sdc.K_FIELD and max(outs) <= n + sdc.MAX_NOISE
    assert sdc.perturb(5, sdc.KEY_MOD * 9 // 10, sdc.K_FIELD) == 5        # 5 - 2 floors at 5
    with pytest.raises(ValueError):
        sdc.perturb(4, 0, sdc.K_FIELD)
    assert sdc.perturb_ge_k(4, 0, sdc.K_FIELD) is None and sdc.perturb_ge_k(5, 0, sdc.K_FIELD) == 5


def test_default_floor_fails_safe():
    """A call site that forgets to pick a floor raises on a 5-9 count instead of publishing it."""
    for n in (5, 9):
        with pytest.raises(ValueError):
            sdc.perturb(n, 0)
        assert sdc.perturb_ge_k(n, 0) is None


def test_publish_parts_folds_and_ranks():
    parts = {"tech": (40, 0), "law": (3, 0), "arts": (4, 0), "consulting": (5, 0), "founder": (2, 0)}
    assert sdc.publish_parts(parts, 5, "small") == [("tech", 40), ("small", 9), ("consulting", 5)]
    assert sdc.publish_parts(parts, 5) == [("tech", 40), ("consulting", 5)]           # no bucket: dropped
    assert sdc.publish_parts({"a": (6, 0), "b": (3, 0), "c": (1, 0)}, 5, "small") == [("a", 6)]  # bucket 4 < 5
    assert sdc.publish_parts({"b": (7, 0), "a": (7, 0)}, 5) == [("a", 7), ("b", 7)]   # ties by label


def test_publish_parts_perturbs_each_part_by_its_own_keys():
    ids = [f"p{i}" for i in range(30)]
    keys = sdc.rkeys(ids, SALT)
    parts = {"x": (12, sum(keys[:12])), "y": (3, sum(keys[12:15])), "z": (4, sum(keys[15:19])),
             "w": (11, sum(keys[19:30]))}
    out = dict(sdc.publish_parts(parts, 5, "small"))
    assert out["x"] == sdc.perturb(12, sum(keys[:12]), 5) and out["w"] == sdc.perturb(11, sum(keys[19:30]), 5)
    assert out["small"] == sdc.perturb(7, sum(keys[12:19]), 5)        # the bucket is its people's cell

