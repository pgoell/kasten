BOOK = b"PK\x03\x04 not really a book"
"""Enough bytes to tell one response from another. Nothing on this path opens one."""

PDF = b"%PDF-1.7 not really a book either"
"""The other format the vault reads, and the one the epub's zip magic misses."""

PNG = b"\x89PNG\r\n\x1a\x0a not really an image"
"""The eight bytes a png starts with, which is the longest magic in the table."""

MP4 = b"\x00\x00\x00\x1cftypisom\x00\x00\x02\x00isomiso2mp41" + bytes(range(256)) * 8
"""An mp4's ftyp box as ffmpeg writes it, then enough bytes for a range to cut into."""

WEBM = b"\x1aE\xdf\xa3\x9fB\x86\x81\x01B\xf7\x81\x01B\xf2\x81\x04B\xf3\x81\x08B\x82\x84webm"
WEBM += bytes(64)
"""A webm's EBML head as ffmpeg writes it, DocType webm, then filler."""
