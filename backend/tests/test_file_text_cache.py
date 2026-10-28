"""The entry cache behind `place_of`, the lookup that says which page a search hit is on.

An entry is read once and reused until its json changes. Two writes in one mtime tick
can leave jsons of one size, so the json's mtime and size alone cannot tell them apart.
"""

import os
from typing import TYPE_CHECKING

from kasten_backend import file_text
from kasten_backend.file_text import Extracted, Place

if TYPE_CHECKING:
    from pathlib import Path


def test_place_of_reads_the_second_of_two_same_size_writes_in_one_tick(
    tmp_path: Path,
) -> None:
    file_text._load.cache_clear()
    source = tmp_path / "book.pdf"
    source.write_bytes(b"%PDF")
    stat = source.stat()
    cache = tmp_path / "cache"
    json_path = cache / "book.pdf.json"
    tick = 1_700_000_000_000_000_000

    first = Extracted(["one", "two"], [Place("page 1", 1), Place("page 2", 2)])
    file_text._write(cache, "book.pdf", first, stat)
    os.utime(json_path, ns=(tick, tick))
    recorded = json_path.stat()
    assert file_text.place_of(cache, "book.pdf", 1) == Place("page 1", 1)

    # Same lines, pages swapped: the json comes out the same byte count.
    second = Extracted(["one", "two"], [Place("page 2", 2), Place("page 1", 1)])
    file_text._write(cache, "book.pdf", second, stat)
    os.utime(json_path, ns=(tick, tick))
    after = json_path.stat()
    assert (after.st_mtime_ns, after.st_size) == (
        recorded.st_mtime_ns,
        recorded.st_size,
    )

    assert file_text.place_of(cache, "book.pdf", 1) == Place("page 2", 2)


def test_place_of_parses_an_unchanged_entry_once(tmp_path: Path) -> None:
    file_text._load.cache_clear()
    source = tmp_path / "book.pdf"
    source.write_bytes(b"%PDF")
    cache = tmp_path / "cache"
    extracted = Extracted(["one", "two"], [Place("page 1", 1), Place("page 2", 2)])
    file_text._write(cache, "book.pdf", extracted, source.stat())

    file_text.place_of(cache, "book.pdf", 1)
    file_text.place_of(cache, "book.pdf", 2)

    info = file_text._load.cache_info()
    assert info.misses == 1
    assert info.hits >= 1


def test_place_of_answers_none_for_a_dropped_entry(tmp_path: Path) -> None:
    file_text._load.cache_clear()
    source = tmp_path / "book.pdf"
    source.write_bytes(b"%PDF")
    cache = tmp_path / "cache"
    extracted = Extracted(["one"], [Place("page 1", 1)])
    file_text._write(cache, "book.pdf", extracted, source.stat())
    assert file_text.place_of(cache, "book.pdf", 1) is not None

    file_text._drop(cache, "book.pdf")

    assert file_text.place_of(cache, "book.pdf", 1) is None
