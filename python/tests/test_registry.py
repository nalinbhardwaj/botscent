"""The generated module carries the registry exactly (scripts/generate.ts writes it)."""

import base64
import hashlib
import json
import pathlib

from botscent import _generated as g

ROOT = pathlib.Path(__file__).parents[2]


def thumbprint(x):
    digest = hashlib.sha256(f'{{"crv":"Ed25519","kty":"OKP","x":"{x}"}}'.encode()).digest()
    return base64.urlsafe_b64encode(digest).decode().rstrip("=")


def read(path):
    return json.loads((ROOT / path).read_text())


def test_generated_module_matches_the_registry():
    assert g.REASONS == tuple(r["id"] for r in read("registry/reasons.json")["reasons"])
    assert g.SIGNERS == read("registry/signers.json")["signers"]
    assert g.TOKENS == tuple(
        (t["token"], t["name"], t.get("match", "token")) for t in read("registry/tokens.json")["tokens"]
    )
    directories = read("registry/keys.json")["directories"]
    assert g.KEYS == {
        host: [
            {
                "x": k["x"],
                "thumbprint": thumbprint(k["x"]),
                "kid": k.get("kid"),
                "nbf": k.get("nbf"),
                "exp": k.get("exp"),
            }
            for k in keys
        ]
        for host, keys in directories.items()
    }
    assert g.VERSION == read("package.json")["version"]
