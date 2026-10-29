"""ORM rows for note pieces: a chunk of a note, its text and its bge-m3 vector.

Migration 0013 makes the tables and the two BM25 indexes. The indexes are not
declared here: no ORM query reads them, and the query names one by its
`to_bm25query` argument, which SQLAlchemy cannot write.
"""

from pgvector.sqlalchemy import Vector
from sqlalchemy import ForeignKey, Integer, Text
from sqlalchemy.orm import Mapped, mapped_column

from kasten_backend.db import Base


class PieceNote(Base):
    """A note the piece index has read, with the digest of its bytes at that read."""

    __tablename__ = "piece_notes"

    path: Mapped[str] = mapped_column(Text, primary_key=True)
    digest: Mapped[str] = mapped_column(Text)


class Piece(Base):
    """One piece of a note: its place in the note, its heading, its text and its vector."""

    __tablename__ = "pieces"

    path: Mapped[str] = mapped_column(
        Text,
        ForeignKey("piece_notes.path", ondelete="CASCADE", onupdate="CASCADE"),
        primary_key=True,
    )
    n: Mapped[int] = mapped_column(Integer, primary_key=True)
    heading: Mapped[str] = mapped_column(Text)
    digest: Mapped[str] = mapped_column(Text)
    text: Mapped[str] = mapped_column(Text)
    embedding: Mapped[list[float]] = mapped_column(Vector(1024))
