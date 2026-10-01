"""Botscent: tells a website when software rather than a person is operating a visit.

import botscent
verdict = botscent.inspect(request)   # {"type": "agent" | "human", "agent_name"?: str, "reasons": [...]}
"""

from ._core import Verdict, combine, is_verified, read_report
from ._generated import VERSION
from ._server import inspect

__all__ = ["VERSION", "Verdict", "combine", "inspect", "is_verified", "read_report"]
