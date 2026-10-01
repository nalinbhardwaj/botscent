"""The server half: inspect, and the Server-Timing helpers adapters use.
Mirrors src/server in TypeScript; the shared vectors hold both to the same output."""

from __future__ import annotations

import base64
import functools
import logging
import math
import re
import time
from collections.abc import Callable, Mapping
from typing import NamedTuple

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey

from . import _generated as g
from ._core import Evidence, Verdict, decide, encode, human, name_of
from ._sfv import InnerList, Item, SfError, parse_dictionary, parse_item, serialize_member

log = logging.getLogger("botscent")


class Registry(NamedTuple):
    signers: Mapping[str, str]
    keys: Mapping[str, list]
    tokens: tuple


BUNDLED = Registry(g.SIGNERS, g.KEYS, g.TOKENS)


# --- the request ------------------------------------------------------------


class RequestView(NamedTuple):
    header: Callable[[str], str | None]
    method: str
    url: str | None  # the absolute target URI, when known
    target: str | None  # path and query, when known
    authority: str | None  # lower-cased, without a default port


_ABSOLUTE = re.compile(r"[A-Za-z][A-Za-z0-9+.-]*://")
_URL_PARTS = re.compile(r"([A-Za-z][A-Za-z0-9+.-]*)://([^/?#]*)([^?#]*)(\?[^#]*)?")


def _headers_of(source) -> Callable[[str], str | None]:
    getlist = getattr(source, "getlist", None) or getattr(source, "get_all", None)
    if callable(getlist):

        def header(name: str) -> str | None:
            values = [str(v) for v in getlist(name) or []]
            return ", ".join(values) if values else None

        return header
    lowered: dict[str, str] = {}
    for key, value in (source or {}).items():
        name = key.decode("latin-1") if isinstance(key, bytes) else str(key)
        if isinstance(value, bytes):
            value = value.decode("latin-1")
        elif isinstance(value, (list, tuple)):
            value = ", ".join(v.decode("latin-1") if isinstance(v, bytes) else str(v) for v in value)
        name = name.lower()
        lowered[name] = f"{lowered[name]}, {value}" if name in lowered else str(value)
    return lambda name: lowered.get(name.lower())


def view(request) -> RequestView:
    """A Django, Starlette, Flask or Werkzeug request, any object with a
    ``headers`` mapping, or a mapping of headers itself."""
    source = getattr(request, "headers", None) if not isinstance(request, Mapping) else request
    header = _headers_of(source)
    method = str(getattr(request, "method", None) or "GET").upper()
    raw_url = getattr(request, "url", None)
    raw_url = str(raw_url) if raw_url is not None and not isinstance(request, Mapping) else None
    url = target = None
    if raw_url and _ABSOLUTE.match(raw_url):
        url = raw_url
        m = _URL_PARTS.match(raw_url)
        target = (m.group(3) or "/") + (m.group(4) or "") if m else None
    elif callable(getattr(request, "get_full_path", None)):
        target = request.get_full_path()
    elif raw_url and raw_url.startswith("/"):
        target = raw_url
    host = header("host") or header(":authority")
    if not host and url:
        m = _URL_PARTS.match(url)
        host = m.group(2) if m else None
    authority = None
    if host:
        authority = host.strip().lower()
        scheme = (_URL_PARTS.match(url).group(1).lower() + ":") if url and _URL_PARTS.match(url) else "https:"
        if (scheme == "https:" and authority.endswith(":443")) or (scheme == "http:" and authority.endswith(":80")):
            authority = authority[: authority.rindex(":")]
    return RequestView(header, method, url, target, authority)


# --- declared tokens ----------------------------------------------------------

_BEFORE = " \t;(,+"
_AFTER = "/ \t;),"


def match_tokens(ua: str, tokens) -> list[tuple[str, str]]:
    """Every registry token that occurs in the user agent as a whole token, with its name."""
    found = []
    for token, name in tokens:
        at = ua.find(token)
        while at != -1:
            before = ua[at - 1] if at > 0 else ""
            after = ua[at + len(token)] if at + len(token) < len(ua) else ""
            if (before == "" or before in _BEFORE) and (after == "" or after in _AFTER):
                found.append((token, name))
                break
            at = ua.find(token, at + 1)
    return found


def is_headless_chrome(ua: str) -> bool:
    return "HeadlessChrome/" in ua


# --- Web Bot Auth ---------------------------------------------------------------

_ORIGIN = re.compile(r"https://([A-Za-z0-9.-]+)(?::([0-9]{1,5}))?/?")


def _origin_host(value: str | None) -> str | None:
    m = _ORIGIN.fullmatch(value) if value is not None else None
    if not m:
        return None
    host = m.group(1).lower()
    return host if m.group(2) is None or int(m.group(2)) == 443 else f"{host}:{int(m.group(2))}"


def _str(member) -> str | None:
    return member.item.v if isinstance(member, Item) and member.item.t == "str" else None


def _param(params, key: str) -> str | None:
    v = params.get(key)
    return v.v if v is not None and v.t in ("str", "tok") else None


def _int(params, key: str) -> int | None:
    v = params.get(key)
    return v.v if v is not None and v.t == "int" else None


@functools.lru_cache(maxsize=64)
def _public_key(x: str) -> Ed25519PublicKey:
    return Ed25519PublicKey.from_public_bytes(base64.urlsafe_b64decode(x + "=" * (-len(x) % 4)))


class Signature(NamedTuple):
    label: str
    host: str | None
    name: str | None
    verified: bool
    why: str


def _component_value(req: RequestView, c: Item) -> str | tuple[str]:
    """The value of one covered component, or a 1-tuple holding why it cannot be derived."""
    name = c.item.v if c.item.t == "str" else None
    if name is None:
        return ("a component identifier is not a string",)
    for p in c.params:
        if p != "key":
            return (f"unsupported component parameter ;{p} on {name}",)
    key = _param(c.params, "key")
    if name.startswith("@"):
        if key is not None:
            return (f";key on derived component {name}",)
        m = _URL_PARTS.match(req.url) if req.url else None
        if name == "@method":
            return req.method
        if name == "@authority":
            return req.authority if req.authority else ("no authority on the request",)
        if name == "@scheme":
            return m.group(1).lower() if m else ("scheme unknown",)
        if name == "@target-uri":
            return req.url if req.url else ("target URI unknown",)
        if name == "@path":
            if m:
                return m.group(3) or "/"
            return req.target.split("?")[0] if req.target else ("path unknown",)
        if name == "@query":
            if m:
                return m.group(4) or "?"
            if req.target:
                return req.target[req.target.index("?") :] if "?" in req.target else "?"
            return ("query unknown",)
        return (f"unsupported derived component {name}",)
    field = req.header(name)
    if field is None:
        return (f"covered field {name} is absent",)
    if key is None:
        return field.strip()
    try:
        member = parse_dictionary(field).get(key)
    except SfError:
        return (f"covered field {name} is not a dictionary",)
    return serialize_member(member) if member is not None else (f'covered member {name};key="{key}" is absent',)


def verify_signatures(req: RequestView, now_ms: float, registry: Registry, debug) -> list[Signature]:
    input_header, signature_header = req.header("signature-input"), req.header("signature")
    if input_header is None or signature_header is None:
        return []
    try:
        inputs = parse_dictionary(input_header)
        signatures = parse_dictionary(signature_header)
    except SfError as error:
        debug and debug(f"signature headers do not parse ({error}): no evidence")
        return []
    agents = legacy = None
    agent_header = req.header("signature-agent")
    if agent_header is not None:
        try:
            if agent_header.lstrip().startswith('"'):
                legacy = _str(parse_item(agent_header))
            else:
                agents = parse_dictionary(agent_header)
        except SfError:
            debug and debug("Signature-Agent does not parse")
    out = []
    for label, member in inputs.items():
        if not isinstance(member, InnerList) or _param(member.params, "tag") != "web-bot-auth":
            continue
        result = _one(req, now_ms, registry, label, member, signatures, agents, legacy)
        if debug:
            signer = (result.host or "(none)") + (f" ({result.name})" if result.name else "")
            debug(f"signature {label}: signer {signer} {'verified' if result.verified else 'declared: ' + result.why}")
        out.append(result)
    return out


def _one(req, now_ms, registry, label, inp: InnerList, signatures, agents, legacy) -> Signature:
    covered = next((c for c in inp.list if c.item.t == "str" and c.item.v == "signature-agent"), None)
    covered_key = _param(covered.params, "key") if covered else None
    agent_value = None
    if legacy is not None:
        agent_value = legacy
    elif agents is not None:
        if covered_key is not None:
            agent_member = agents.get(covered_key)
        else:
            agent_member = agents.get(label) or (next(iter(agents.values())) if len(agents) == 1 else None)
        kind = agent_member.params.get("type") if isinstance(agent_member, Item) else None
        if kind is None or (kind.t == "tok" and kind.v == "directory"):
            agent_value = _str(agent_member)
    host = _origin_host(agent_value)
    name = registry.signers.get(host) if host else None

    def fail(why: str) -> Signature:
        return Signature(label, host, name, False, why)

    try:
        if not host:
            return fail("no https Signature-Agent origin for this signature")
        keys = registry.keys.get(host)
        if not keys:
            return fail("signer not in the bundled registry")
        components = [c.item.v if c.item.t == "str" else "" for c in inp.list]
        if "@authority" not in components and "@target-uri" not in components:
            return fail("covers neither @authority nor @target-uri")
        if covered is None:
            return fail("Signature-Agent is not covered")
        if legacy is None and covered_key is None and agents is not None and len(agents) != 1:
            return fail("Signature-Agent is covered whole but has several members")
        keyid, alg = _param(inp.params, "keyid"), _param(inp.params, "alg")
        created, expires = _int(inp.params, "created"), _int(inp.params, "expires")
        if alg is not None and alg != "ed25519":
            return fail(f"alg {alg} is not ed25519")
        if keyid is None or created is None or expires is None:
            return fail("keyid, created or expires is missing")
        key = next((k for k in keys if k["thumbprint"] == keyid or k["kid"] == keyid), None)
        if key is None:
            return fail(f"keyid {keyid} is not in the bundled directory")
        now = now_ms / 1000
        if now < created or now > expires:
            return fail(
                f"outside its window: created {_round(now - created)} s ago, expires {_round(expires - now)} s from now"
            )
        if (key["nbf"] is not None and created < key["nbf"]) or (key["exp"] is not None and created > key["exp"]):
            return fail("the key was not valid when the signature was created")
        value = signatures.get(label)
        if not isinstance(value, Item) or value.item.t != "bin":
            return fail("no Signature member for this label")
        if len(value.item.v) != 64:
            return fail("the signature is not 64 bytes")
        lines = []
        for c in inp.list:
            v = _component_value(req, c)
            if isinstance(v, tuple):
                return fail(v[0])
            lines.append(f"{serialize_member(c)}: {v}")
        lines.append(f'"@signature-params": {serialize_member(inp)}')
        try:
            _public_key(key["x"]).verify(value.item.v, "\n".join(lines).encode())
        except InvalidSignature:
            return fail(f"the signature does not verify over {', '.join(components)}")
        return Signature(label, host, name, True, "verified")
    except Exception as error:  # noqa: BLE001 - a failure is a signature that did not verify
        return fail(f"verification failed: {error}")


def _round(x: float) -> int:
    """Math.round: halves round up, as in TypeScript, so both write the same lines."""
    return math.floor(x + 0.5)


# --- inspect ------------------------------------------------------------------


def inspect_with(registry: Registry, request, *, cf=None, now=None) -> Verdict:
    debug = log.debug if log.isEnabledFor(logging.DEBUG) else None
    evidence: list[Evidence] = []
    try:
        req = view(request)
    except Exception as error:  # noqa: BLE001 - inspect never raises
        debug and debug(f"inspect: unreadable request ({error}): human")
        return human()
    ua = req.header("user-agent") or ""
    if debug:
        debug(f"{req.method} {req.authority or '?'}{(req.target or '').split('?')[0]} user-agent {_quote(ua[:200])}")

    def step(what, run):
        try:
            run()
        except Exception as error:  # noqa: BLE001
            debug and debug(f"{what}: failed ({error}); no evidence from it")

    def signatures():
        at = now if isinstance(now, (int, float)) and not isinstance(now, bool) and math.isfinite(now) else None
        for s in verify_signatures(req, at if at is not None else time.time() * 1000, registry, debug):
            reason = "signer.web-bot-auth.verified" if s.verified else "signer.web-bot-auth.declared"
            evidence.append(Evidence(reason, s.name, "declaration"))

    def platform():
        if not isinstance(cf, Mapping):
            return
        category = cf.get("verifiedBotCategory")
        management = cf.get("botManagement")
        flagged = isinstance(management, Mapping) and management.get("verifiedBot") is True
        if (isinstance(category, str) and category) or flagged:
            debug and debug(
                f"platform: verified bot{f' ({category})' if isinstance(category, str) and category else ''}"
            )
            evidence.append(Evidence("signer.edge-verified-bot"))

    def user_agent():
        for token, name in match_tokens(ua, registry.tokens):
            debug and debug(f"token {token}: {name}")
            evidence.append(Evidence("ua.declared-agent-token", name, "declaration"))
        if is_headless_chrome(ua):
            debug and debug("user agent declares HeadlessChrome")
            evidence.append(Evidence("ua.headless-chrome"))

    step("signatures", signatures)
    step("platform", platform)
    step("user agent", user_agent)
    verdict = decide(evidence)
    if debug:
        if verdict["type"] == "agent":
            debug(f"name: {name_of(evidence)[1]}")
        name = f" {verdict['agent_name']}" if "agent_name" in verdict else ""
        debug(f"verdict {verdict['type']}{name} [{', '.join(verdict['reasons'])}]")
    return verdict


def _quote(s: str) -> str:
    import json

    return json.dumps(s, ensure_ascii=False)


def inspect(request, *, cf=None, now=None) -> Verdict:
    """What this request itself declared: its signatures, its user agent and the
    platform's verified-bot field. Reads no body and no page report; never raises.

    ``request`` is a Django, Starlette, Flask or Werkzeug request, any object with
    a ``headers`` mapping and a ``method``, or a mapping of headers. ``cf`` is
    Cloudflare's request.cf as a mapping, when available; ``now`` is the request
    time in milliseconds since the epoch."""
    return inspect_with(BUNDLED, request, cf=cf, now=now)


# --- Server-Timing ------------------------------------------------------------


def is_navigation(header: Callable[[str], str | None], method: str) -> bool:
    """Sec-Fetch-Dest: document, or, from a client without fetch metadata, a GET that accepts HTML."""
    dest = header("sec-fetch-dest")
    if dest is not None:
        return dest.strip().lower() == "document"
    accept = header("accept") or ""
    return method.upper() == "GET" and re.search(r"(^|[\s,;])text/html(?=$|[\s,;])", accept, re.IGNORECASE) is not None


def _entries(value: str) -> list[str]:
    out, start, quoted, i = [], 0, False, 0
    while i < len(value):
        c = value[i]
        if quoted and c == "\\":
            i += 1
        elif c == '"':
            quoted = not quoted
        elif c == "," and not quoted:
            out.append(value[start:i])
            start = i + 1
        i += 1
    out.append(value[start:])
    return [e.strip() for e in out if e.strip()]


def _ours(entry: str) -> bool:
    return entry.split(";", 1)[0].strip().lower() == "botscent"


def scrub_server_timing(value: str | None) -> str | None:
    """The value without any botscent entry, every other entry kept as written; None when nothing is left."""
    if value is None:
        return None
    kept = [e for e in _entries(value) if not _ours(e)]
    return ", ".join(kept) if kept else None


def has_our_entry(value: str | None) -> bool:
    return value is not None and any(_ours(e) for e in _entries(value))


def server_timing_entry(verdict: Verdict, now_ms: float) -> str | None:
    """The botscent entry for an agent verdict (``botscent;desc="..."``), or None."""
    entry = encode(verdict, now_ms)
    return f'botscent;desc="{entry}"' if entry else None
