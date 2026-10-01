import json
import logging
import pathlib

import botscent
from botscent import _generated as g
from botscent._core import decide
from botscent._server import (
    Registry,
    has_our_entry,
    inspect_with,
    is_navigation,
    match_tokens,
    scrub_server_timing,
    server_timing_entry,
)

ROOT = pathlib.Path(__file__).parents[2]
VECTORS = json.loads((ROOT / "vectors" / "requests.json").read_text())
REGISTRY = Registry(VECTORS["registry"]["signers"], VECTORS["registry"]["keys"], g.TOKENS)


def canonical(value):
    return json.dumps(value, separators=(",", ":"), ensure_ascii=False)


class MultiHeaders:
    """The getlist interface of Starlette's and Werkzeug's header objects."""

    def __init__(self, pairs):
        self.pairs = pairs

    def getlist(self, name):
        return [v for n, v in self.pairs if n.lower() == name.lower()]


class Request:
    def __init__(self, headers, method="GET", url=None):
        self.headers, self.method, self.url = headers, method, url


def shapes(pairs, method):
    joined = {}
    for name, value in pairs:
        joined[name] = f"{joined[name]}, {value}" if name in joined else value
    yield "a mapping of headers", (joined if method == "GET" else Request(joined, method))
    yield "an object with getlist", Request(MultiHeaders(pairs), method)
    yield "ASGI byte pairs", Request({n.lower().encode(): v.encode() for n, v in joined.items()}, method)


def test_vectors_inspect():
    for case in VECTORS["cases"]:
        for shape, request in shapes(case["headers"], case.get("method", "GET")):
            got = inspect_with(REGISTRY, request, cf=case.get("cf"), now=case.get("now"))
            assert canonical(got) == canonical(case["verdict"]), f"{case['name']} ({shape})"


def test_inspect_never_raises():
    class Hostile:
        @property
        def headers(self):
            raise RuntimeError("boom")

    for request in (None, 42, "GET /", {}, Request(None), Hostile()):
        assert botscent.inspect(request)["type"] == "human"


def test_debug_lines_say_why(caplog):
    case = next(c for c in VECTORS["cases"] if c["name"] == "unknown keyid")
    with caplog.at_level(logging.DEBUG, logger="botscent"):
        inspect_with(REGISTRY, dict(case["headers"]), now=case["now"])
    lines = [r.getMessage() for r in caplog.records]
    assert any(
        "signature sig1: signer signature-agent.test (test-signer) declared: keyid not-a-bundled-key is not in the bundled directory"
        in line
        for line in lines
    ), lines
    assert lines[-1] == "verdict agent test-signer [signer.web-bot-auth.declared]"


def test_tokens_match_only_as_whole_tokens():
    tokens = (("Devin", "devin", "token"), ("curl", "curl", "token"))
    assert [n for _, n in match_tokens("curl/8.7.1", tokens)] == ["curl"]
    assert match_tokens("curly/1.0 xcurl/1 Devinx", tokens) == []
    assert [n for _, n in match_tokens("curlcurl curl/1", tokens)] == ["curl"]


def test_navigation_and_server_timing():
    h = lambda d: lambda n: d.get(n)
    assert is_navigation(h({"sec-fetch-dest": "document"}), "POST")
    assert not is_navigation(h({"sec-fetch-dest": "empty", "accept": "text/html"}), "GET")
    assert is_navigation(h({"sec-fetch-dest": "document", "user-agent": ""}), "GET")
    html, browser = "text/html,application/xhtml+xml,*/*;q=0.8", "Mozilla/5.0 (X11; Linux x86_64) Chrome/154.0.0.0"
    assert is_navigation(h({"accept": html, "user-agent": browser}), "GET")
    assert not is_navigation(h({"accept": html, "user-agent": "facebookexternalhit/1.1"}), "GET")
    assert not is_navigation(h({"accept": html, "user-agent": "curl/8.7.1"}), "GET")
    assert not is_navigation(h({"accept": html}), "GET")
    assert not is_navigation(h({"accept": "*/*", "user-agent": browser}), "GET")
    assert not is_navigation(h({"accept": "text/x-component", "user-agent": browser}), "GET")
    assert (
        scrub_server_timing('db;dur=53, botscent;desc="1;chatgpt;1;x", app;desc="a, b; c";dur=1')
        == 'db;dur=53, app;desc="a, b; c";dur=1'
    )
    assert scrub_server_timing('BotScent;desc="1;x;;y"') is None
    assert (
        scrub_server_timing('a;desc="quote \\" and, comma", botscent;desc="1;;;x"') == 'a;desc="quote \\" and, comma"'
    )
    assert not has_our_entry('a;desc="botscent;desc=x"')
    verdict = decide([botscent._core.Evidence("signer.web-bot-auth.verified", "chatgpt", "declaration")])
    assert (
        server_timing_entry(verdict, 1759300000123)
        == 'botscent;desc="1;chatgpt;1759300000123;signer.web-bot-auth.verified"'
    )
