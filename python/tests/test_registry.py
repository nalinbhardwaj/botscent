"""The generated module carries the registry exactly (scripts/generate.ts writes it)."""

import json
import pathlib

from botscent import _generated as g

ROOT = pathlib.Path(__file__).parents[2]


def read(path):
    return json.loads((ROOT / path).read_text())


def test_generated_module_matches_the_registry():
    assert g.REASONS == tuple(r["id"] for r in read("registry/reasons.json")["reasons"])
    assert g.SIGNERS == read("registry/signers.json")["signers"]
    assert g.TOKENS == tuple((t["token"], t["name"]) for t in read("registry/tokens.json")["tokens"])
    directories = read("registry/keys.json")["directories"]
    assert g.KEYS == {
        host: [{"x": k["x"], "kid": k.get("kid"), "nbf": k.get("nbf"), "exp": k.get("exp")} for k in keys]
        for host, keys in directories.items()
    }
    assert g.VERSION == read("package.json")["version"]
