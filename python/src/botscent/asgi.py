"""botscent.asgi: the server half as ASGI middleware, for FastAPI, Starlette and
other ASGI frameworks.

    from botscent.asgi import BotscentMiddleware
    app.add_middleware(BotscentMiddleware)      # request.state.botscent

It inspects each HTTP request, puts the verdict on ``request.state.botscent``
(``scope["state"]["botscent"]``), and applies the transport rules to the response
headers as they start: an inherited ``botscent`` Server-Timing entry is always
removed, and, when ``transport=True``, an agent's document navigation gets the
entry with ``Cache-Control: no-store``. An origin cannot see whether a CDN in front
of it stores HTML, so the transport is off unless the developer turns it on. The
middleware never reads or buffers a body: requests and streaming responses pass
through unchanged.
"""

from __future__ import annotations

import time

from ._server import inspect, is_navigation, log, transport


class _ScopeRequest:
    """inspect's view of an ASGI scope."""

    def __init__(self, scope):
        self.headers = {}
        for name, value in scope.get("headers") or []:
            key = name.decode("latin-1").lower()
            value = value.decode("latin-1")
            self.headers[key] = f"{self.headers[key]}, {value}" if key in self.headers else value
        self.method = scope.get("method", "GET")
        host = self.headers.get("host")
        path = scope.get("raw_path")
        path = path.decode("latin-1") if isinstance(path, bytes) else scope.get("path", "/")
        query = scope.get("query_string") or b""
        self.url = (
            f"{scope.get('scheme', 'https')}://{host}{path}" + (f"?{query.decode('latin-1')}" if query else "")
            if host
            else None
        )


def _apply_transport(raw_headers, verdict, navigation: bool, send: bool, now_ms: float):
    """The response's header list with the transport rules applied (contract section 10)."""
    values = [value.decode("latin-1") for name, value in raw_headers if name.lower() == b"server-timing"]
    current = ", ".join(values) if values else None
    value, no_store = transport(current, verdict, navigation, send, now_ms)
    if value == current and not no_store:
        return list(raw_headers)
    drop = (b"server-timing", b"cache-control") if no_store else (b"server-timing",)
    headers = [(n, v) for n, v in raw_headers if n.lower() not in drop]
    if value is not None:
        headers.append((b"server-timing", value.encode("latin-1")))
    if no_store:
        headers.append((b"cache-control", b"no-store"))
    return headers


class BotscentMiddleware:
    def __init__(self, app, *, transport: bool = False):
        self.app = app
        self.transport = transport

    async def __call__(self, scope, receive, send):
        if scope.get("type") != "http":
            await self.app(scope, receive, send)
            return
        request = _ScopeRequest(scope)
        verdict = inspect(request)
        scope.setdefault("state", {})["botscent"] = verdict
        navigation = is_navigation(lambda name: request.headers.get(name), request.method)

        async def send_wrapper(message):
            if message.get("type") == "http.response.start":
                try:
                    message = {
                        **message,
                        "headers": _apply_transport(
                            message.get("headers") or [], verdict, navigation, self.transport, time.time() * 1000
                        ),
                    }
                except Exception:  # noqa: BLE001 - the middleware's own failure never reaches the app
                    log.debug("transport: failed; response passed unchanged")
            await send(message)

        await self.app(scope, receive, send_wrapper)
