"""botscent.django: the server half as Django middleware.

    MIDDLEWARE = [..., "botscent.django.BotscentMiddleware"]   # request.botscent

The request verdict goes on ``request.botscent``. An inherited ``botscent``
Server-Timing entry is removed from every response; with ``BOTSCENT_TRANSPORT =
True`` in settings (only where no shared cache stores the site's HTML), an agent's
document navigation also gets the entry with ``Cache-Control: no-store``. Works in
sync and async middleware stacks; never reads a body.
"""

from __future__ import annotations

import time

from asgiref.sync import iscoroutinefunction, markcoroutinefunction

from ._server import inspect, is_navigation, log, transport


class BotscentMiddleware:
    sync_capable = True
    async_capable = True

    def __init__(self, get_response):
        from django.conf import settings

        self.get_response = get_response
        self.transport = bool(getattr(settings, "BOTSCENT_TRANSPORT", False))
        if iscoroutinefunction(get_response):
            markcoroutinefunction(self)

    def __call__(self, request):
        if iscoroutinefunction(self):
            return self.__acall__(request)
        request.botscent = inspect(request)
        return self._finish(request, self.get_response(request))

    async def __acall__(self, request):
        request.botscent = inspect(request)
        return self._finish(request, await self.get_response(request))

    def _finish(self, request, response):
        try:
            navigation = is_navigation(lambda name: request.headers.get(name), request.method)
            value, no_store = transport(
                response.headers.get("Server-Timing"),
                request.botscent,
                navigation,
                self.transport,
                time.time() * 1000,
            )
            if value is None:
                response.headers.pop("Server-Timing", None)
            else:
                response.headers["Server-Timing"] = value
            if no_store:
                response.headers["Cache-Control"] = "no-store"
        except Exception:  # noqa: BLE001 - the middleware's own failure never reaches the app
            log.debug("transport: failed; response passed unchanged")
        return response
