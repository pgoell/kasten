"""The Garmin sync: walks, runs and rides from Garmin Connect as training lines in the daily note.

Reads through Garmin's Personal API with the owner's own key.
docs/reference/training/garmin-sync.md has the rest.
"""

from kasten_jobs.garmin.job import Settings, main, run
from kasten_jobs.garmin.lines import Activity, activity_of, line_of

__all__ = ["Activity", "Settings", "activity_of", "line_of", "main", "run"]
