"""Routes that reach past the vault to the internet: a web page, a transcript and the weather.

`route` and `transcripts` are exported so tests patch the names they look up.
"""

from kasten_backend.web import route, transcripts
from kasten_backend.web.route import router

__all__ = ["route", "router", "transcripts"]
