import json
import pathlib
import random

from botscent import _core as core
from botscent._core import Evidence

VECTORS = json.loads((pathlib.Path(__file__).parents[2] / "vectors" / "core.json").read_text())


def canonical(value):
    return json.dumps(value, separators=(",", ":"), ensure_ascii=False)


def test_vectors_read_report():
    for case in VECTORS["reports"]:
        assert canonical(core.read_report(case["value"])) == canonical(case["report"]), (
            case["value"],
            case.get("note"),
        )


def test_vectors_combine():
    for case in VECTORS["combine"]:
        assert canonical(core.combine(case["request"], case["report"])) == canonical(case["combined"]), case.get("note")


def test_vectors_is_verified():
    for case in VECTORS["is_verified"]:
        assert core.is_verified(case["verdict"], case.get("name")) is case["verified"], case


def test_non_ascii_digits_are_not_digits():
    # Python's \d would accept these; the grammar is ASCII only, as in TypeScript.
    assert core.decode("١;;;x") is None
    assert core.decode("1;;١٢;x") is None


def test_decide_is_order_and_duplicate_independent():
    pool = [
        Evidence("signer.web-bot-auth.verified", "chatgpt", "declaration"),
        Evidence("signer.edge-verified-bot"),
        Evidence("ua.declared-agent-token", "manus", "declaration"),
        Evidence("browser.webdriver-flag"),
        Evidence("muse.credentials.accessor-family", "muse", "shape"),
        Evidence("x.from-a-newer-server"),
    ]
    rng = random.Random(7)
    for _ in range(300):
        subset = [e for e in pool if rng.random() < 0.5]
        expected = canonical(core.decide(subset))
        shuffled = subset + [e for e in subset if rng.random() < 0.3]
        rng.shuffle(shuffled)
        assert canonical(core.decide(shuffled)) == expected


def test_verdicts_are_fresh_objects():
    a, b = core.decide([]), core.decide([])
    a["reasons"].append("mutated")
    assert b == {"type": "human", "reasons": []}
