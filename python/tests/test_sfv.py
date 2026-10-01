"""RFC 9651 conformance against the HTTP working group's published test suite
(test/fixtures/sfv in the repository root, shared with the TypeScript tests)."""

import base64
import json
import pathlib

import pytest

from botscent._sfv import (
    InnerList,
    SfError,
    parse_dictionary,
    parse_item,
    parse_list,
    serialize_member,
    serialize_params,
)

FIXTURES = pathlib.Path(__file__).parents[2] / "test" / "fixtures" / "sfv"


def bare(b):
    t, v = b
    if t == "tok":
        return {"__type": "token", "value": v}
    if t == "bin":
        return {"__type": "binary", "value": base64.b32encode(v).decode()}
    if t == "date":
        return {"__type": "date", "value": v}
    if t == "dstr":
        return {"__type": "displaystring", "value": v}
    return v


def params(p):
    return [[k, bare(v)] for k, v in p.items()]


def member(m):
    if isinstance(m, InnerList):
        return [[[bare(i.item), params(i.params)] for i in m.list], params(m.params)]
    return [bare(m.item), params(m.params)]


def serialize_dictionary(d):
    out = []
    for k, m in d.items():
        if not isinstance(m, InnerList) and m.item.t == "bool" and m.item.v is True:
            out.append(k + serialize_params(m.params))
        else:
            out.append(f"{k}={serialize_member(m)}")
    return ", ".join(out)


def same(a, b):
    """JSON equality that tells 1 from 1.0 and from True, as the fixtures do."""
    if isinstance(a, bool) or isinstance(b, bool):
        return type(a) is type(b) and a == b
    if isinstance(a, (int, float)) and isinstance(b, (int, float)):
        return a == b
    if isinstance(a, list) and isinstance(b, list):
        return len(a) == len(b) and all(same(x, y) for x, y in zip(a, b))
    if isinstance(a, dict) and isinstance(b, dict):
        return a.keys() == b.keys() and all(same(a[k], b[k]) for k in a)
    return a == b


@pytest.mark.parametrize("path", sorted(FIXTURES.glob("*.json")), ids=lambda p: p.name)
def test_structured_fields(path):
    for case in json.loads(path.read_text()):
        value = ", ".join(case["raw"])
        try:
            if case["header_type"] == "dictionary":
                d = parse_dictionary(value)
                parsed, serialized = [[k, member(m)] for k, m in d.items()], serialize_dictionary(d)
            elif case["header_type"] == "list":
                lst = parse_list(value)
                parsed, serialized = [member(m) for m in lst], ", ".join(serialize_member(m) for m in lst)
            else:
                i = parse_item(value)
                parsed, serialized = member(i), serialize_member(i)
        except SfError:
            if case.get("must_fail") or case.get("can_fail"):
                continue
            raise AssertionError(f"{case['name']}: {value!r} raised")
        assert not case.get("must_fail"), f"{case['name']}: {value!r} must fail"
        assert same(parsed, case["expected"]), case["name"]
        if "canonical" in case:
            assert serialized == ", ".join(case["canonical"]), f"{case['name']}: canonical form"
