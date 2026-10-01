"""The ASGI middleware keeps the application's behaviour and applies the transport rules."""

import pytest
from starlette.applications import Starlette
from starlette.requests import Request
from starlette.responses import JSONResponse, PlainTextResponse, RedirectResponse, Response, StreamingResponse
from starlette.routing import Route
from starlette.testclient import TestClient

from botscent.asgi import BotscentMiddleware

AGENT_UA = "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; ChatGPT-User/1.0; +https://openai.com/bot"
NAVIGATION = {"sec-fetch-dest": "document", "user-agent": AGENT_UA}


async def verdict(request: Request):
    return JSONResponse(request.state.botscent)


async def page(request: Request):
    return PlainTextResponse("<p>page</p>", headers={"server-timing": 'db;dur=12, botscent;desc="1;old;1;stale"'})


async def cookie_redirect(request: Request):
    response = RedirectResponse("/elsewhere", status_code=303)
    response.set_cookie("session", "abc")
    return response


async def stream(request: Request):
    async def chunks():
        for i in range(3):
            yield f"chunk {i}\n".encode()

    return StreamingResponse(chunks(), media_type="text/plain")


async def upload(request: Request):
    form = await request.form()
    data = await form["file"].read()
    return JSONResponse({"name": form["name"], "file": data.decode(), "size": len(data)})


async def raw(request: Request):
    return Response(await request.body(), media_type="application/octet-stream")


async def boom(request: Request):
    raise RuntimeError("the application's own error")


ROUTES = [
    Route("/verdict", verdict),
    Route("/page", page),
    Route("/redirect", cookie_redirect),
    Route("/stream", stream),
    Route("/upload", upload, methods=["POST"]),
    Route("/raw", raw, methods=["POST"]),
    Route("/boom", boom),
]


def client(transport=False):
    app = Starlette(routes=ROUTES)
    app.add_middleware(BotscentMiddleware, transport=transport)
    return TestClient(app)


def test_the_request_verdict_is_on_request_state():
    c = client()
    assert c.get("/verdict", headers={"user-agent": "Mozilla/5.0 Chrome/141"}).json() == {
        "type": "human",
        "reasons": [],
    }
    assert c.get("/verdict", headers={"user-agent": AGENT_UA}).json() == {
        "type": "agent",
        "agent_name": "chatgpt-user",
        "reasons": ["ua.declared-agent-token"],
    }


def test_status_cookies_and_redirects_are_kept():
    r = client(transport=True).get("/redirect", headers=NAVIGATION, follow_redirects=False)
    assert r.status_code == 303
    assert r.headers["location"] == "/elsewhere"
    assert "session=abc" in r.headers["set-cookie"]


def test_streaming_responses_pass_through():
    with client(transport=True).stream("GET", "/stream", headers=NAVIGATION) as r:
        assert list(r.iter_lines()) == ["chunk 0", "chunk 1", "chunk 2"]


def test_request_bodies_are_untouched():
    c = client(transport=True)
    r = c.post("/upload", data={"name": "n"}, files={"file": ("a.txt", b"x" * 100_000)}, headers=NAVIGATION)
    assert r.json() == {"name": "n", "file": "x" * 100_000, "size": 100_000}
    body = bytes(range(256)) * 64
    assert c.post("/raw", content=body, headers=NAVIGATION).content == body


def test_the_applications_exceptions_propagate():
    with pytest.raises(RuntimeError, match="the application's own error"):
        client(transport=True).get("/boom", headers=NAVIGATION)


def test_inherited_entries_are_removed_for_everyone_and_others_kept():
    r = client().get("/page", headers={"sec-fetch-dest": "document", "user-agent": "Mozilla/5.0 Chrome/141"})
    assert r.headers["server-timing"] == "db;dur=12"
    assert "cache-control" not in r.headers


def test_the_transport_is_off_by_default_at_the_origin():
    r = client().get("/page", headers=NAVIGATION)
    assert r.headers["server-timing"] == "db;dur=12"


def test_with_the_transport_on_an_agent_navigation_gets_one_entry_and_no_store():
    r = client(transport=True).get("/page", headers=NAVIGATION)
    timing = r.headers["server-timing"]
    assert timing.startswith('db;dur=12, botscent;desc="1;chatgpt-user;')
    assert timing.endswith(';ua.declared-agent-token"')
    assert timing.count("botscent") == 1
    assert r.headers["cache-control"] == "no-store"


def test_not_for_people_and_not_for_api_requests():
    c = client(transport=True)
    person = c.get("/page", headers={"sec-fetch-dest": "document", "user-agent": "Mozilla/5.0 Chrome/141"})
    api = c.get("/page", headers={"sec-fetch-dest": "empty", "user-agent": AGENT_UA})
    for r in (person, api):
        assert r.headers["server-timing"] == "db;dur=12"
        assert "cache-control" not in r.headers
