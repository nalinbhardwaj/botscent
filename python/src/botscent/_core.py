"""The verdict, the shared decision from evidence to verdict, and the wire
grammar (contract sections 1 to 5 and 9). Pure; mirrors src/core in TypeScript."""

from __future__ import annotations

import math
import re
from collections.abc import Iterable, Mapping
from typing import Literal, NamedTuple, NotRequired, TypedDict

from ._generated import REASONS


class Verdict(TypedDict):
    type: Literal["agent", "human"]
    agent_name: NotRequired[str]
    reasons: list[str]


class Evidence(NamedTuple):
    """One observation that counts as agent evidence. ``name`` is set only by an
    identity-grade source, whose class ("declaration" or "shape") decides precedence."""

    reason: str
    name: str | None = None
    source: str | None = None


_RANK = {reason: i for i, reason in enumerate(REASONS)}


def human() -> Verdict:
    return {"type": "human", "reasons": []}


def ordered(reasons: Iterable[str]) -> list[str]:
    """Reasons in catalogue order; unknown reasons keep their relative order after the known ones."""
    seen: set[str] = set()
    known: list[str] = []
    unknown: list[str] = []
    for reason in reasons:
        if reason in seen:
            continue
        seen.add(reason)
        (known if reason in _RANK else unknown).append(reason)
    known.sort(key=_RANK.__getitem__)
    return known + unknown


def name_of(evidence: Iterable[Evidence]) -> tuple[str | None, str]:
    """(name, why): declarations first and only when they agree; shapes only without declarations."""
    declared: set[str] = set()
    shaped: set[str] = set()
    for e in evidence:
        if not e.name:
            continue
        if e.source == "declaration":
            declared.add(e.name)
        elif e.source == "shape":
            shaped.add(e.name)

    def pick(names: set[str], kind: str) -> tuple[str | None, str]:
        found = sorted(names)
        if len(found) == 1:
            return found[0], f"{kind} {found[0]}"
        return None, f"{kind}s disagree: {', '.join(found)}"

    if declared:
        return pick(declared, "declaration")
    if shaped:
        return pick(shaped, "shape")
    return None, "no identity-grade evidence"


def make_verdict(reasons: Iterable[str], name: str | None = None) -> Verdict:
    reasons = list(reasons)
    if not reasons:
        return human()
    if name:
        return {"type": "agent", "agent_name": name, "reasons": reasons}
    return {"type": "agent", "reasons": reasons}


def decide(evidence: Iterable[Evidence]) -> Verdict:
    evidence = list(evidence)
    if not evidence:
        return human()
    return make_verdict(ordered(e.reason for e in evidence), name_of(evidence)[0])


def _reasons_of(verdict: object) -> list:
    reasons = verdict.get("reasons") if isinstance(verdict, Mapping) else None
    return reasons if isinstance(reasons, list) else []


def is_verified(verdict: object, name: str | None = None) -> bool:
    """True when the request itself was verified: by a Web Bot Auth signature
    against a bundled key, or by the hosting platform. With a name, true only
    when a verified signature names that agent; the platform's field verifies
    that some bot sent the request, not which one. A reason with the ``page.``
    prefix never counts, and a named check fails on any verdict that holds one."""
    reasons = _reasons_of(verdict)
    signed = "signer.web-bot-auth.verified" in reasons
    if name is None:
        return signed or "signer.edge-verified-bot" in reasons
    return (
        signed
        and verdict.get("agent_name") == name
        and not any(isinstance(r, str) and r.startswith("page.") for r in reasons)
    )


def combine(request: Verdict, report: Verdict | None) -> Verdict:
    """Adds a page report's evidence (already ``page.``-prefixed by read_report) to the request's."""
    if not report or not report.get("reasons"):
        return request
    reasons = list(request["reasons"])
    for reason in report["reasons"]:
        if reason not in reasons:
            reasons.append(reason)
    return make_verdict(reasons, request.get("agent_name") or report.get("agent_name"))


WIRE_VERSION = "1"
WIRE_MAX = 256
_ENTRY = re.compile(
    r"([0-9]{1,3})(?:\.[0-9]{1,3})?;([a-z0-9-]{0,64});([0-9]{0,15});"
    r"([a-z0-9._-]{1,80}(?:,[a-z0-9._-]{1,80})*)(?:;[\x21-\x3a\x3c-\x7e]*)*"
)
_NAME = re.compile(r"[a-z0-9-]{1,64}")
_REASON = re.compile(r"[a-z0-9._-]{1,80}")


def encode(verdict: Verdict, time: float | None = None) -> str | None:
    """The entry for an agent verdict, or None for a person. A name or reason
    that cannot travel is left out, and reasons are dropped from the end until
    the entry fits in WIRE_MAX bytes."""
    if verdict.get("type") != "agent":
        return None
    name = verdict.get("agent_name")
    name = name if isinstance(name, str) and _NAME.fullmatch(name) else ""
    stamp = ""
    if isinstance(time, (int, float)) and not isinstance(time, bool) and math.isfinite(time) and time >= 0:
        stamp = str(math.floor(time))[:15]
    head = f"{WIRE_VERSION};{name};{stamp};"
    body = ""
    for reason in verdict.get("reasons", []):
        if not isinstance(reason, str) or not _REASON.fullmatch(reason):
            continue
        candidate = f"{body},{reason}" if body else reason
        if len(head) + len(candidate) > WIRE_MAX:
            break
        body = candidate
    return head + body if body else None


def decode(value: object) -> dict | None:
    """Parses an entry; None for anything malformed, over-long or of another major version."""
    if not isinstance(value, str) or len(value) > WIRE_MAX:
        return None
    m = _ENTRY.fullmatch(value)
    if not m or int(m.group(1)) != int(WIRE_VERSION):
        return None
    entry: dict = {"reasons": list(dict.fromkeys(m.group(4).split(",")))}
    if m.group(2):
        entry["name"] = m.group(2)
    if m.group(3):
        entry["time"] = int(m.group(3))
    return entry


def read_report(value: str | Mapping[str, object] | None) -> Verdict | None:
    """A page report as a verdict whose reasons carry the ``page.`` prefix, or
    None. Accepts the wire string (from the header or the form field) or a
    verdict mapping passed as an argument, held to the same grammar."""
    entry = None
    if isinstance(value, str):
        entry = decode(value)
    elif isinstance(value, Mapping):
        reasons, name = value.get("reasons"), value.get("agent_name")
        if (
            value.get("type") != "agent"
            or not isinstance(reasons, list)
            or not all(isinstance(r, str) for r in reasons)
        ):
            return None
        if name is not None and not isinstance(name, str):
            return None
        entry = decode(encode(make_verdict(reasons, name)))
    if not entry:
        return None
    return make_verdict((f"page.{r}" for r in entry["reasons"]), entry.get("name"))
