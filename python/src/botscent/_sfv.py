"""Structured Field Values (RFC 9651): parsing as in section 4.2, and the
serialisation (section 4.1) that HTTP message signatures need for their
signature base. Mirrors src/server/sfv.ts. A parse failure raises SfError."""

from __future__ import annotations

import base64
import binascii
import re
from typing import NamedTuple


class SfError(ValueError):
    pass


class Bare(NamedTuple):
    """A bare item: t is int, dec, str, tok, bin, bool, date or dstr."""

    t: str
    v: object


class Item(NamedTuple):
    item: Bare
    params: dict[str, Bare]


class InnerList(NamedTuple):
    list: list[Item]
    params: dict[str, Bare]


Member = Item | InnerList

_KEY_FIRST = re.compile(r"[a-z*]")
_KEY_CHAR = re.compile(r"[a-z0-9_\-.*]")
_TOKEN_FIRST = re.compile(r"[A-Za-z*]")
_TOKEN_CHAR = re.compile(r"[!#$%&'*+\-.^_`|~0-9A-Za-z:/]")
_BASE64 = re.compile(r"[A-Za-z0-9+/=]*")
_HEX2 = re.compile(r"[0-9a-f]{2}")


class _Parser:
    def __init__(self, s: str):
        self.s = s
        self.i = 0

    def peek(self) -> str:
        return self.s[self.i] if self.i < len(self.s) else ""

    def fail(self, why: str):
        raise SfError(f"{why} at {self.i}")

    def sp(self):
        while self.peek() == " ":
            self.i += 1

    def ows(self):
        while self.peek() in (" ", "\t") and self.peek():
            self.i += 1

    def done(self) -> bool:
        return self.i >= len(self.s)

    def dictionary(self) -> dict[str, Member]:
        out: dict[str, Member] = {}
        while not self.done():
            key = self.key()
            if self.peek() == "=":
                self.i += 1
                member = self.member_value()
            else:
                member = Item(Bare("bool", True), self.params())
            out[key] = member
            self.ows()
            if self.done():
                return out
            if self.peek() != ",":
                self.fail("expected ,")
            self.i += 1
            self.ows()
            if self.done():
                self.fail("trailing comma")
        return out

    def list(self) -> list[Member]:
        out: list[Member] = []
        while not self.done():
            out.append(self.member_value())
            self.ows()
            if self.done():
                return out
            if self.peek() != ",":
                self.fail("expected ,")
            self.i += 1
            self.ows()
            if self.done():
                self.fail("trailing comma")
        return out

    def member_value(self) -> Member:
        return self.inner_list() if self.peek() == "(" else self.item()

    def inner_list(self) -> InnerList:
        self.i += 1
        items: list[Item] = []
        while not self.done():
            self.sp()
            if self.peek() == ")":
                self.i += 1
                return InnerList(items, self.params())
            items.append(self.item())
            if self.peek() not in (" ", ")") or not self.peek():
                self.fail("expected space or )")
        self.fail("unterminated inner list")

    def item(self) -> Item:
        return Item(self.bare_item(), self.params())

    def params(self) -> dict[str, Bare]:
        out: dict[str, Bare] = {}
        while self.peek() == ";":
            self.i += 1
            self.sp()
            key = self.key()
            value = Bare("bool", True)
            if self.peek() == "=":
                self.i += 1
                value = self.bare_item()
            out[key] = value
        return out

    def key(self) -> str:
        start = self.i
        if not _KEY_FIRST.fullmatch(self.peek() or "!"):
            self.fail("key must start with lcalpha or *")
        while self.peek() and _KEY_CHAR.fullmatch(self.peek()):
            self.i += 1
        return self.s[start : self.i]

    def bare_item(self) -> Bare:
        c = self.peek()
        if c == "-" or ("0" <= c <= "9" and c):
            return self.number()
        if c == '"':
            return Bare("str", self.string())
        if c and _TOKEN_FIRST.fullmatch(c):
            return self.token()
        if c == ":":
            return self.bytes()
        if c == "?":
            return self.boolean()
        if c == "@":
            return self.date()
        if c == "%":
            return self.display_string()
        self.fail("unknown item type")

    def number(self) -> Bare:
        kind = "int"
        sign = 1
        num = ""
        if self.peek() == "-":
            self.i += 1
            sign = -1
        if self.done() or not ("0" <= self.peek() <= "9"):
            self.fail("expected digit")
        while not self.done():
            c = self.peek()
            if "0" <= c <= "9":
                num += c
            elif kind == "int" and c == ".":
                if len(num) > 12:
                    self.fail("integer part too long")
                num += c
                kind = "dec"
            else:
                break
            self.i += 1
            if kind == "int" and len(num) > 15:
                self.fail("integer too long")
            if kind == "dec" and len(num) > 16:
                self.fail("decimal too long")
        if kind == "int":
            return Bare("int", sign * int(num))
        if num.endswith("."):
            self.fail("decimal ends with .")
        if len(num) - num.index(".") - 1 > 3:
            self.fail("too many fractional digits")
        return Bare("dec", sign * float(num) + 0.0)

    def string(self) -> str:
        self.i += 1
        out = []
        while not self.done():
            c = self.s[self.i]
            self.i += 1
            if c == "\\":
                if self.done():
                    self.fail("dangling escape")
                nxt = self.s[self.i]
                self.i += 1
                if nxt not in ('"', "\\"):
                    self.fail("bad escape")
                out.append(nxt)
            elif c == '"':
                return "".join(out)
            elif c < " " or c > "~":
                self.fail("bad string character")
            else:
                out.append(c)
        self.fail("unterminated string")

    def token(self) -> Bare:
        start = self.i
        self.i += 1
        while self.peek() and _TOKEN_CHAR.fullmatch(self.peek()):
            self.i += 1
        return Bare("tok", self.s[start : self.i])

    def bytes(self) -> Bare:
        self.i += 1
        end = self.s.find(":", self.i)
        if end < 0:
            self.fail("unterminated byte sequence")
        b64 = self.s[self.i : end]
        self.i = end + 1
        if not _BASE64.fullmatch(b64):
            self.fail("bad base64")
        decoded = base64_decode(b64)
        if decoded is None:
            self.fail("bad base64")
        return Bare("bin", decoded)

    def boolean(self) -> Bare:
        self.i += 1
        c = self.s[self.i] if self.i < len(self.s) else ""
        self.i += 1
        if c == "1":
            return Bare("bool", True)
        if c == "0":
            return Bare("bool", False)
        self.fail("bad boolean")

    def date(self) -> Bare:
        self.i += 1
        n = self.number()
        if n.t != "int":
            self.fail("date must be an integer")
        return Bare("date", n.v)

    def display_string(self) -> Bare:
        self.i += 1
        if self.peek() != '"':
            self.fail('expected "')
        self.i += 1
        data = bytearray()
        while not self.done():
            c = self.s[self.i]
            self.i += 1
            if c < " " or c > "~":
                self.fail("bad display string character")
            if c == "%":
                hex2 = self.s[self.i : self.i + 2]
                if not _HEX2.fullmatch(hex2):
                    self.fail("bad percent escape")
                data.append(int(hex2, 16))
                self.i += 2
            elif c == '"':
                try:
                    return Bare("dstr", data.decode("utf-8"))
                except UnicodeDecodeError:
                    self.fail("display string is not UTF-8")
            else:
                data.append(ord(c))
        self.fail("unterminated display string")


def _parse(value: str, run):
    p = _Parser(value.strip(" "))
    out = run(p)
    p.sp()
    if not p.done():
        p.fail("trailing characters")
    return out


def parse_dictionary(value: str) -> dict[str, Member]:
    return _parse(value, lambda p: p.dictionary())


def parse_list(value: str) -> list[Member]:
    return _parse(value, lambda p: p.list())


def parse_item(value: str) -> Item:
    return _parse(value, lambda p: p.item())


def base64_decode(b64: str) -> bytes | None:
    """Standard or unpadded base64 to bytes; None when the input cannot be base64."""
    body = b64.rstrip("=")
    if re.search(r"[^A-Za-z0-9+/]", body) or len(body) % 4 == 1:
        return None
    try:
        return base64.b64decode(body + "=" * (-len(body) % 4), validate=True)
    except (binascii.Error, ValueError):
        return None


def serialize_bare_item(b: Bare) -> str:
    t, v = b
    if t == "int":
        return str(v)
    if t == "dec":
        s = repr(round(v, 3))
        return s if "." in s else s + ".0"
    if t == "str":
        return '"' + v.replace("\\", "\\\\").replace('"', '\\"') + '"'
    if t == "tok":
        return v
    if t == "bin":
        return ":" + base64.b64encode(v).decode() + ":"
    if t == "bool":
        return "?1" if v else "?0"
    if t == "date":
        return f"@{v}"
    if t == "dstr":
        out = []
        for byte in v.encode("utf-8"):
            out.append(f"%{byte:02x}" if byte in (0x25, 0x22) or byte < 0x20 or byte > 0x7E else chr(byte))
        return '%"' + "".join(out) + '"'
    raise SfError(f"unknown bare item type {t}")


def serialize_params(params: dict[str, Bare]) -> str:
    return "".join(
        f";{k}" if v.t == "bool" and v.v is True else f";{k}={serialize_bare_item(v)}" for k, v in params.items()
    )


def serialize_member(m: Member) -> str:
    if isinstance(m, InnerList):
        return "(" + " ".join(serialize_member(i) for i in m.list) + ")" + serialize_params(m.params)
    return serialize_bare_item(m.item) + serialize_params(m.params)
