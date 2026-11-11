"""The exercise import: one note per exercise in the vault's exercise folder, never one overwritten.

Sources are wger, free-exercise-db and the vault's mobility programme. See
docs/reference/training/exercise-import.md.
"""

from kasten_jobs.exercises.job import main

__all__ = ["main"]
