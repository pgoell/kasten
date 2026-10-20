BOOK = b"PK\x03\x04 not really a book"
"""Enough bytes to tell one response from another. Nothing on this path opens one."""

PDF = b"%PDF-1.7 not really a book either"
"""The other format the vault reads, and the one the epub's zip magic misses."""

PNG = b"\x89PNG\r\n\x1a\x0a not really an image"
"""The eight bytes a png starts with, which is the longest magic in the table."""
