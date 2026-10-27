"""Hand-made pdf and epub bytes, for the tests of the text that search reads out of them.

Written here rather than checked in, so the text a test expects is in the test and
not in a binary file nobody can read in a diff.
"""

import io
import zipfile


def _literal(text: str) -> str:
    """The text as a PDF string body, with the three characters a string cannot hold escaped."""
    return text.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")


def pdf(pages: list[list[str]]) -> bytes:
    """A pdf with one page per list, each line of text set in Helvetica, top to bottom.

    The xref is computed, so the file reads the way a real one does, and the
    text is a plain `Tj` per line, which pdfium reads back as the same lines.
    """
    count = len(pages)
    kids = " ".join(f"{4 + 2 * index} 0 R" for index in range(count))
    objects: list[bytes] = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        f"<< /Type /Pages /Kids [{kids}] /Count {count} >>".encode(),
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    ]
    for index, lines in enumerate(pages):
        page_number = 4 + 2 * index
        content_number = page_number + 1
        objects.append(
            (
                f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 300] "
                f"/Contents {content_number} 0 R "
                f"/Resources << /Font << /F1 3 0 R >> >> >>"
            ).encode()
        )
        # The first Td is absolute, each later one moves the line down by 16 points.
        shows = [f"({_literal(line)}) Tj" for line in lines]
        stream = "BT /F1 12 Tf 20 270 Td " + " 0 -16 Td ".join(shows) + " ET"
        data = stream.encode("latin-1")
        objects.append(b"<< /Length %d >>\nstream\n%s\nendstream" % (len(data), data))

    out = bytearray(b"%PDF-1.4\n")
    offsets: list[int] = []
    for number, body in enumerate(objects, 1):
        offsets.append(len(out))
        out += f"{number} 0 obj\n".encode() + body + b"\nendobj\n"
    xref = len(out)
    out += f"xref\n0 {len(objects) + 1}\n0000000000 65535 f \n".encode()
    for offset in offsets:
        out += f"{offset:010d} 00000 n \n".encode()
    out += (
        f"trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n"
    ).encode()
    return bytes(out)


def xhtml(body: str, title: str = "") -> str:
    """One chapter's XHTML document, with a title in its head when one is given."""
    head = f"<head><title>{title}</title></head>" if title else "<head/>"
    return (
        '<?xml version="1.0" encoding="utf-8"?>'
        '<html xmlns="http://www.w3.org/1999/xhtml">'
        f"{head}<body>{body}</body></html>"
    )


def epub(chapters: list[str]) -> bytes:
    """An epub whose spine is the given XHTML chapters, in order, the way a reader opens one."""
    manifest = "".join(
        f'<item id="c{index}" href="text/c{index}.xhtml" media-type="application/xhtml+xml"/>'
        for index in range(len(chapters))
    )
    spine = "".join(f'<itemref idref="c{index}"/>' for index in range(len(chapters)))
    opf = (
        '<?xml version="1.0" encoding="utf-8"?>'
        '<package xmlns="http://www.idpf.org/2007/opf" version="3.0">'
        "<metadata/>"
        f"<manifest>{manifest}</manifest><spine>{spine}</spine></package>"
    )
    container = (
        '<?xml version="1.0" encoding="UTF-8"?>'
        '<container version="1.0" '
        'xmlns="urn:oasis:names:tc:opendocument:xmlns:container">'
        '<rootfiles><rootfile full-path="OEBPS/content.opf" '
        'media-type="application/oebps-package+xml"/></rootfiles></container>'
    )
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as book:
        book.writestr("mimetype", "application/epub+zip")
        book.writestr("META-INF/container.xml", container)
        book.writestr("OEBPS/content.opf", opf)
        for index, chapter in enumerate(chapters):
            book.writestr(f"OEBPS/text/c{index}.xhtml", chapter)
    return buffer.getvalue()
