"""One side of an Anki card rendered over its note's fields: the template language a card needs.

The part of Anki's template language a card needs to come out the same: field
replacements, filters, and conditional sections. Nothing here reads a
collection; `anki_collection` hands each template's text and the note's fields.
"""

import re
from dataclasses import dataclass

_FURIGANA = re.compile(r" ?([^ >{}:]+?)\[(.+?)\]")
"""Anki's furigana pattern: ` 漢字[かんじ]`, the space before the base saying where it starts.

Anki fills the furigana in after the cloze, by which time a mark is a tag
whose `>` stops the base. Read off the raw field here, the braces and colons
of `{{c1::` stop it instead.
"""
_READING = {"furigana": r"<ruby>\1<rt>\2</rt></ruby>", "kanji": r"\1", "kana": r"\2"}
"""What each of Anki's three furigana filters makes of a `_FURIGANA` match."""
_TOKEN = re.compile(r"\{\{(.*?)\}\}|<!--.*?-->", re.DOTALL)
"""A handlebar or an HTML comment: Anki lexes the comment whole, so a field inside it is not one."""
_EMPTY = re.compile(r"(?:\s|</?(?:br|div) ?/?>)*", re.IGNORECASE)
"""Anki's own test for an empty field: an editor leaves `<br>` and `<div>` behind."""


@dataclass(frozen=True)
class _Field:
    key: str
    filters: list[str]


@dataclass(frozen=True)
class _Section:
    key: str
    negated: bool
    children: list[_Node]


type _Node = str | _Field | _Section


def render(template: str, fields: dict[str, str], *, question: bool) -> tuple[str, bool]:
    """The side `template` makes over `fields`, and whether a non-empty field went into it."""
    return _render(_parse(template), fields, question=question)


def _parse(template: str) -> list[_Node]:
    """`template` as a tree of text, field replacements and conditional sections.

    One pass over the template, never over a field's value: a value holding
    `{{Back}}` is text, the way Anki shows it. A section left open runs to the
    end and a stray close is ignored, so a broken template still gives a card.
    """
    root: list[_Node] = []
    stack = [root]
    start = 0
    for match in _TOKEN.finditer(template):
        stack[-1].append(template[start : match.start()])
        start = match.end()
        if match.group(1) is None:
            # A comment, which Anki hands to the browser to hide; a markdown
            # line would show it, so it goes.
            continue
        # `{{{Front}}}` is a slip Anki forgives: the handlebar ends at the first
        # `}}`, the extra `{` is dropped, and the last `}` stays as text.
        tag = match.group(1).lstrip("{").strip()
        if tag.startswith(("#", "^")):
            section = _Section(tag[1:].strip(), tag[0] == "^", [])
            stack[-1].append(section)
            stack.append(section.children)
        elif tag.startswith("/"):
            if len(stack) > 1:
                stack.pop()
        else:
            *filters, key = tag.split(":")
            stack[-1].append(_Field(key.strip(), [f.strip() for f in filters]))
    stack[-1].append(template[start:])
    return root


def _render(nodes: list[_Node], fields: dict[str, str], *, question: bool) -> tuple[str, bool]:
    """`nodes` rendered over `fields`, and whether a non-empty field went into it.

    That second answer is Anki's test for making a card at all: a front of
    literal text and nothing else is still an empty front.
    """
    parts: list[str] = []
    filled = False
    for node in nodes:
        if isinstance(node, str):
            parts.append(node)
        elif isinstance(node, _Section):
            if _empty(fields.get(node.key, "")) != node.negated:
                continue
            text, inner = _render(node.children, fields, question=question)
            parts.append(text)
            filled = filled or inner
        else:
            value = _replacement(node, fields, question=question)
            parts.append(value)
            filled = filled or not _empty(value)
    return "".join(parts), filled


def _replacement(node: _Field, fields: dict[str, str], *, question: bool) -> str:
    """What one `{{...}}` shows.

    `FrontSide`, the special fields and a field the note type lacks all show
    nothing: the back would otherwise repeat the question, and the rest are
    Anki's view of the card rather than anything the author wrote.
    """
    # `type:` asks for typed input on the front and shows the field on the back;
    # `tts` reads it aloud. Neither has text a markdown line could carry.
    if any(f == "tts" or f.startswith("tts ") for f in node.filters):
        return ""
    if question and "type" in node.filters:
        return ""
    value = fields.get(node.key, "")
    # Innermost first, the filter by the field's name being the first applied.
    # The rest, `text:` and `hint:` among them, give the field as it is.
    for name in reversed(node.filters):
        if name in _READING:
            # Anki's own first step: its editor puts `&nbsp;` between words,
            # which would otherwise join the base of the reading after it.
            value = value.replace("&nbsp;", " ")
            value = _FURIGANA.sub(lambda match, name=name: _reading(match, name), value)
    return value


def _reading(match: re.Match[str], name: str) -> str:
    """What the furigana filter `name` makes of one `_FURIGANA` match, a sound left as it is."""
    if match[2].startswith("sound:"):
        return match[0]
    return match.expand(_READING[name])


def _empty(value: str) -> bool:
    return _EMPTY.fullmatch(value) is not None
