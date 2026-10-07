"""Botscent: tells your site if an AI agent is browsing it, and which agent.

import botscent
verdict = botscent.inspect(request)   # {"type": "agent" | "human", "agent_name"?: str, "reasons": [...]}
"""

from ._core import Verdict, combine, is_verified, read_report
from ._generated import VERSION
from ._server import inspect

__all__ = ["VERSION", "Verdict", "combine", "inspect", "is_verified", "read_report"]
