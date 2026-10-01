"""botscent.flask: the server half as a Flask extension.

    from botscent.flask import Botscent
    Botscent(app)                     # flask.g.botscent in every view

The request verdict goes on ``flask.g.botscent``. An inherited ``botscent``
Server-Timing entry is removed from every response; with ``transport=True`` (only
where no shared cache stores the site's HTML), an agent's document navigation also
gets the entry with ``Cache-Control: no-store``. Never reads a body.
"""

from __future__ import annotations

import time

from ._server import inspect, is_navigation, log, transport


class Botscent:
    def __init__(self, app=None, *, transport: bool = False):
        self.transport = transport
        if app is not None:
            self.init_app(app)

    def init_app(self, app):
        app.before_request(self._before)
        app.after_request(self._after)

    @staticmethod
    def _before():
        from flask import g, request

        g.botscent = inspect(request)

    def _after(self, response):
        from flask import g, request

        try:
            verdict = g.get("botscent")
            if verdict is None:
                return response
            navigation = is_navigation(lambda name: request.headers.get(name), request.method)
            value, no_store = transport(
                response.headers.get("Server-Timing"), verdict, navigation, self.transport, time.time() * 1000
            )
            if value is None:
                response.headers.pop("Server-Timing", None)
            else:
                response.headers["Server-Timing"] = value
            if no_store:
                response.headers["Cache-Control"] = "no-store"
        except Exception:  # noqa: BLE001 - the extension's own failure never reaches the app
            log.debug("transport: failed; response passed unchanged")
        return response
