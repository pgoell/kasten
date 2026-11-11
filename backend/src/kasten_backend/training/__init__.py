"""Training read off the `## Training` lines of the daily note: sets, cardio and mobility tests.

`lines` parses one line, `route` serves the days. The format is `docs/reference/training/training-format.md`.
"""

from kasten_backend.training.lines import TrainingEntry, parse_line
from kasten_backend.training.route import router

__all__ = ["TrainingEntry", "parse_line", "router"]
