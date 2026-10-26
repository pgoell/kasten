"""What the order mail parsers share: mail HTML as lines of text, amounts and German dates."""

import re
from datetime import date
from decimal import ROUND_HALF_UP, Decimal
from html.parser import HTMLParser

CENT = Decimal("0.01")

MONTHS = {
    name: number
    for number, name in enumerate(
        (
            "januar",
            "februar",
            "märz",
            "april",
            "mai",
            "juni",
            "juli",
            "august",
            "september",
            "oktober",
            "november",
            "dezember",
        ),
        start=1,
    )
}

_BREAKS = {"br", "p", "div", "tr", "td", "th", "li", "h1", "h2", "h3", "h4", "table"}
_HIDDEN = {"style", "script", "head", "title"}


class _Text(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.parts: list[str] = []
        self.hidden = 0

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        del attrs
        if tag in _HIDDEN:
            self.hidden += 1
        if tag in _BREAKS:
            self.parts.append("\n")

    def handle_endtag(self, tag: str) -> None:
        if tag in _HIDDEN:
            self.hidden = max(0, self.hidden - 1)
        if tag in _BREAKS:
            self.parts.append("\n")

    def handle_data(self, data: str) -> None:
        if not self.hidden:
            # A line break in the source is a space to a reader, as a browser shows it.
            self.parts.append(re.sub(r"\s+", " ", data))


def lines_of(text: str) -> list[str]:
    """The lines of a text that hold something, each trimmed and its runs of space made one."""
    # Amazon wraps a quantity in invisible isolates, and both pad with zero-width spaces.
    lines = (
        re.sub(r"[\s\u200b\u200c\u2068\u2069]+", " ", line).strip() for line in text.split("\n")
    )
    return [line for line in lines if line]


def html_lines(html: str) -> list[str]:
    """A mail's HTML as the lines of text a reader sees, tables broken cell by cell."""
    parser = _Text()
    parser.feed(html)
    return lines_of("".join(parser.parts))


def cents(value: Decimal) -> Decimal:
    """To the cent, half up: Amazon writes a sum such as 23.979999999999997."""
    return value.quantize(CENT, rounding=ROUND_HALF_UP)


def english_amount(text: str) -> Decimal:
    """`1,299.00`, `9.97` or `19` as euros."""
    return cents(Decimal(text.replace(",", "")))


def german_amount(text: str) -> Decimal:
    """`1.234,56` or `-0,00` as euros."""
    return cents(Decimal(text.replace(".", "").replace(",", ".")))


def german_date(text: str) -> date | None:
    """`9. Oktober 2026` or `17.10.2026` as a date, or None."""
    if found := re.search(r"(\d{1,2})\.(\d{1,2})\.(\d{4})", text):
        day, month, year = (int(g) for g in found.groups())
        return date(year, month, day)
    if found := re.search(r"(\d{1,2})\. ([A-Za-zä]+) (\d{4})", text):
        month = MONTHS.get(found.group(2).lower())
        if month is not None:
            return date(int(found.group(3)), month, int(found.group(1)))
    return None
