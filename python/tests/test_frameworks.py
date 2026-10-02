"""The Django middleware and the Flask extension: the verdict where each framework
keeps per-request state, the application's behaviour kept, the transport rules."""

import pytest

AGENT = "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; ChatGPT-User/1.0; +https://openai.com/bot"
PERSON = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0"


# --- Django -----------------------------------------------------------------


@pytest.fixture(scope="module")
def django_client():
    import django
    from django.conf import settings

    if not settings.configured:
        settings.configure(
            DEBUG=False,
            SECRET_KEY="test",
            ALLOWED_HOSTS=["*"],
            ROOT_URLCONF=__name__,
            MIDDLEWARE=["botscent.django.BotscentMiddleware"],
            BOTSCENT_TRANSPORT=True,
        )
        django.setup()
    from django.test import Client

    return Client(raise_request_exception=True)


def _django_views():
    from django.http import HttpResponse, HttpResponseRedirect, JsonResponse, StreamingHttpResponse
    from django.urls import path

    def verdict(request):
        return JsonResponse(request.botscent)

    def page(request):
        response = HttpResponse("<p>page</p>")
        response.headers["Server-Timing"] = 'db;dur=12, botscent;desc="1;old;1;stale"'
        return response

    def redirect(request):
        response = HttpResponseRedirect("/elsewhere")
        response.set_cookie("session", "abc")
        return response

    def stream(request):
        return StreamingHttpResponse(f"chunk {i}\n" for i in range(3))

    def echo(request):
        return HttpResponse(request.body, content_type="application/octet-stream")

    def boom(request):
        raise RuntimeError("the application's own error")

    from django.views.decorators.csrf import csrf_exempt

    return [
        path("verdict", verdict),
        path("page", page),
        path("redirect", redirect),
        path("stream", stream),
        path("echo", csrf_exempt(echo)),
        path("boom", boom),
    ]


urlpatterns = []


def test_django(django_client):
    urlpatterns[:] = _django_views()
    c = django_client
    assert c.get("/verdict", HTTP_USER_AGENT=AGENT).json() == {
        "type": "agent",
        "agent_name": "chatgpt-user",
        "reasons": ["ua.declared-agent-token"],
    }
    person = c.get("/page", HTTP_USER_AGENT=PERSON, HTTP_SEC_FETCH_DEST="document")
    assert person.headers["Server-Timing"] == "db;dur=12"
    agent = c.get("/page", HTTP_USER_AGENT=AGENT, HTTP_SEC_FETCH_DEST="document")
    assert agent.headers["Server-Timing"].startswith('db;dur=12, botscent;desc="1;chatgpt-user;')
    assert agent.headers["Cache-Control"] == "no-store"
    api = c.get("/page", HTTP_USER_AGENT=AGENT, HTTP_SEC_FETCH_DEST="empty")
    assert api.headers["Server-Timing"] == "db;dur=12"
    r = c.get("/redirect", HTTP_USER_AGENT=AGENT, HTTP_SEC_FETCH_DEST="document")
    assert r.status_code == 302 and r.headers["Location"] == "/elsewhere" and r.cookies["session"].value == "abc"
    s = c.get("/stream", HTTP_USER_AGENT=AGENT, HTTP_SEC_FETCH_DEST="document")
    assert s.streaming and b"".join(s.streaming_content) == b"chunk 0\nchunk 1\nchunk 2\n"
    body = bytes(range(256)) * 512
    assert c.post("/echo", body, content_type="application/octet-stream", HTTP_USER_AGENT=AGENT).content == body
    with pytest.raises(RuntimeError, match="the application's own error"):
        c.get("/boom", HTTP_USER_AGENT=AGENT)


def test_django_async_stack(django_client):
    """In an async middleware stack the middleware runs as a coroutine."""
    import asyncio

    from asgiref.sync import iscoroutinefunction

    from botscent.django import BotscentMiddleware

    class Request:
        def __init__(self):
            self.headers = {"user-agent": AGENT, "sec-fetch-dest": "document"}
            self.method = "GET"

        def get_full_path(self):
            return "/"

    class Response:
        def __init__(self):
            self.headers = {}

    async def get_response(request):
        return Response()

    from django.test import override_settings

    for setting, written in ((False, False), (True, True)):
        with override_settings(BOTSCENT_TRANSPORT=setting):
            middleware = BotscentMiddleware(get_response)
        assert iscoroutinefunction(middleware)
        request = Request()
        response = asyncio.run(middleware(request))
        assert request.botscent["agent_name"] == "chatgpt-user"
        assert ("Server-Timing" in response.headers) is written, f"BOTSCENT_TRANSPORT={setting}"


# --- Flask ------------------------------------------------------------------


@pytest.fixture
def flask_client():
    from flask import Flask, Response, g, jsonify, redirect, request

    from botscent.flask import Botscent

    app = Flask(__name__)
    Botscent(app, transport=True)

    @app.get("/verdict")
    def verdict():
        return jsonify(g.botscent)

    @app.get("/page")
    def page():
        return "<p>page</p>", 200, {"Server-Timing": 'db;dur=12, botscent;desc="1;old;1;stale"'}

    @app.get("/timings")
    def timings():
        response = Response("<p>page</p>")
        response.headers.add("Server-Timing", "db;dur=1")
        response.headers.add("Server-Timing", "app;dur=2")
        return response

    @app.get("/redirect")
    def moved():
        response = redirect("/elsewhere", 303)
        response.set_cookie("session", "abc")
        return response

    @app.get("/stream")
    def stream():
        return Response((f"chunk {i}\n" for i in range(3)), mimetype="text/plain")

    @app.post("/echo")
    def echo():
        return Response(request.get_data(), mimetype="application/octet-stream")

    @app.get("/boom")
    def boom():
        raise RuntimeError("the application's own error")

    app.testing = True
    return app.test_client()


def test_flask(flask_client):
    c = flask_client
    assert c.get("/verdict", headers={"User-Agent": PERSON}).get_json() == {"type": "human", "reasons": []}
    person = c.get("/page", headers={"User-Agent": PERSON, "Sec-Fetch-Dest": "document"})
    assert person.headers["Server-Timing"] == "db;dur=12"
    agent = c.get("/page", headers={"User-Agent": AGENT, "Sec-Fetch-Dest": "document"})
    assert agent.headers["Server-Timing"].startswith('db;dur=12, botscent;desc="1;chatgpt-user;')
    assert agent.headers["Cache-Control"] == "no-store"
    # Separate Server-Timing field lines: kept as they are, or joined when the entry is added.
    person = c.get("/timings", headers={"User-Agent": PERSON, "Sec-Fetch-Dest": "document"})
    assert person.headers.getlist("Server-Timing") == ["db;dur=1", "app;dur=2"]
    agent = c.get("/timings", headers={"User-Agent": AGENT, "Sec-Fetch-Dest": "document"})
    assert agent.headers["Server-Timing"].startswith('db;dur=1, app;dur=2, botscent;desc="1;chatgpt-user;')
    r = c.get("/redirect", headers={"User-Agent": AGENT, "Sec-Fetch-Dest": "document"})
    assert r.status_code == 303 and r.headers["Location"] == "/elsewhere"
    assert "session=abc" in r.headers["Set-Cookie"]
    assert c.get("/stream", headers={"User-Agent": AGENT}).data == b"chunk 0\nchunk 1\nchunk 2\n"
    body = bytes(range(256)) * 512
    assert c.post("/echo", data=body, headers={"User-Agent": AGENT}).data == body
    with pytest.raises(RuntimeError, match="the application's own error"):
        c.get("/boom", headers={"User-Agent": AGENT})


# --- request objects as the frameworks build them ----------------------------------


def test_starlette_request_is_read_by_its_headers():
    """A Starlette request is a mapping of its ASGI scope, not of headers."""
    from starlette.requests import Request

    import botscent
    from botscent._server import view

    scope = {
        "type": "http",
        "method": "GET",
        "scheme": "https",
        "path": "/a/b",
        "raw_path": b"/a%2Fb",
        "query_string": b"x=1",
        "headers": [(b"host", b"example.com"), (b"user-agent", AGENT.encode())],
    }
    request = Request(scope)
    assert botscent.inspect(request) == {
        "type": "agent",
        "agent_name": "chatgpt-user",
        "reasons": ["ua.declared-agent-token"],
    }
    v = view(request)
    assert (v.url, v.target, v.authority) == ("https://example.com/a%2Fb?x=1", "/a%2Fb?x=1", "example.com")


def test_flask_request_target_is_the_one_sent():
    """Werkzeug decodes the path; a signature covers the target as sent, so the view takes the
    server's raw target, and has none when the server does not give it."""
    from flask import Flask, request

    from botscent._server import view

    app = Flask(__name__)
    with app.test_request_context("/a%2Fb?x=1", headers={"Host": "example.com"}):
        assert request.path == "/a/b"
        v = view(request)
        assert (v.url, v.target) == ("http://example.com/a%2Fb?x=1", "/a%2Fb?x=1")
    with app.test_request_context("/a%2Fb", headers={"Host": "example.com"}):
        del request.environ["RAW_URI"], request.environ["REQUEST_URI"]
        v = view(request)
        assert (v.url, v.target, v.authority) == (None, None, "example.com")


def test_http2_authority_wins_over_host():
    from botscent._server import view

    assert view({":authority": "different-origin.example", "host": "example.com"}).authority == (
        "different-origin.example"
    )
