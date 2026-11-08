"""The closer reads what is open at the cut from justhtml's tree builder (#1577).

Each shape left by #1576 inside a `foreignObject`, then a CDATA section that needs `]]>` only
where the tree builder has left foreign content open. The fuzz cuts pages at every offset and
asks justhtml whether the link script still parses as a script.
"""

import pytest
from justhtml import Comment, Element, JustHTML, Text

from kasten_backend import html_closer
from kasten_backend.html_page import LINKS_OUT, PAGE_SCRIPT, serve_page

DOCTYPE = b"<!doctype html>"
POINT = b"<svg><foreignObject>"
CDATA = b"</foreignObject><![CDATA[x"


def served_closer(end: bytes) -> bytes:
    page = DOCTYPE + b"<p>a</p>" + end
    served, _ = serve_page(page, None, None)
    head = DOCTYPE + PAGE_SCRIPT + page[len(DOCTYPE) :]
    assert served.startswith(head)
    assert served.endswith(LINKS_OUT)
    return served[len(head) : -len(LINKS_OUT)]


@pytest.mark.parametrize(
    ("end", "closer"),
    [
        *(
            pytest.param(POINT + b"<" + name + b">" + CDATA, b"]]></svg>", id=f"{name.decode()}")
            for name in (b"caption", b"colgroup", b"tbody", b"td", b"tfoot", b"th", b"thead", b"tr")
        ),
        pytest.param(POINT + b"<table><td>" + CDATA, b"></svg>", id="td-in-a-table-is-a-cell"),
        pytest.param(
            POINT + b"<table><tr><td></table>" + CDATA,
            b"]]></svg>",
            id="table-end-closes-its-cells",
        ),
        pytest.param(
            POINT + b"<ruby><rb><rt></rb></ruby>" + CDATA, b"]]></svg>", id="rt-closes-rb"
        ),
        pytest.param(
            POINT + b"<ruby><rtc><rb></ruby>" + CDATA, b"]]></svg>", id="ruby-end-closes-rtc"
        ),
        pytest.param(POINT + b"<select><input>" + CDATA, b"]]></svg>", id="input-ends-select"),
        pytest.param(
            POINT + b"<select><div></select>" + CDATA, b"]]></svg>", id="select-end-closes-select"
        ),
        pytest.param(
            POINT + b"<a><div></a></div>" + CDATA, b"]]></svg>", id="adoption-agency-on-a-end"
        ),
        pytest.param(
            POINT + b"<b><p></b></p>" + CDATA, b"]]></svg>", id="adoption-agency-on-b-end"
        ),
        pytest.param(POINT + b"<p><b></p>x" + CDATA, b"></svg>", id="text-reopens-b-after-p-end"),
        pytest.param(
            POINT + b"<div><b></div>x" + CDATA, b"></svg>", id="text-reopens-b-after-div-end"
        ),
        pytest.param(
            POINT + b"<div><form></div><form>" + CDATA, b"]]></svg>", id="form-pointer-outlives"
        ),
        pytest.param(
            b"<div><form></div>" + POINT + b"<form>" + CDATA,
            b"]]></svg>",
            id="form-pointer-outlives-before-the-svg",
        ),
        pytest.param(b"<form>" + POINT + b"<form>" + CDATA, b"]]></svg>", id="form-before-the-svg"),
        pytest.param(
            POINT + b"<p><b><b><b><b></p>x</b></b></b>" + CDATA,
            b"]]></svg>",
            id="noahs-ark-reopens-three",
        ),
    ],
)
def test_1577_the_closer_reads_the_tree_builder_inside_a_point(end: bytes, closer: bytes) -> None:
    assert served_closer(end) == closer


@pytest.mark.parametrize(
    ("end", "closer"),
    [
        pytest.param(b"<p><svg", b"></svg>", id="svg"),
        pytest.param(b'<p><math dir="a', b'"></math>', id="math"),
        pytest.param(b"<svg><foreignObject><p><svg x=1", b"></svg></svg>", id="svg-in-a-point"),
    ],
)
def test_1577_a_cut_start_tag_closes_and_then_closes_what_it_opened(
    end: bytes, closer: bytes
) -> None:
    assert served_closer(end) == closer


def test_1577_a_plaintext_after_a_crlf_takes_the_scripts_ahead_of_it() -> None:
    head = DOCTYPE + b"<p>a</p>\r\n<svg>\r\n</svg>\r\n"

    served, _ = serve_page(head + b"<plaintext>b\r\n", None, None)

    assert served == DOCTYPE + PAGE_SCRIPT + head[len(DOCTYPE) :] + LINKS_OUT + b"<plaintext>b\r\n"


HTML_POINT = b"</math><annotation-xml encoding=text/html><foreignObject><svg><object><a><!-- c -->"
BEHIND = b"<a></a></foreignObject><![CDATA[x"


@pytest.mark.parametrize(
    ("end", "closer"),
    [
        pytest.param(HTML_POINT + b"</foreignObject", b"></svg>", id="seed-11-end-tag-cut"),
        pytest.param(HTML_POINT + b"</foreignObject>", b"</svg>", id="seed-11-end-tag"),
        pytest.param(
            HTML_POINT + b"</foreignObject><svg><![CDATA[<i>",
            b"]]></svg></svg>",
            id="seed-11-cdata",
        ),
        pytest.param(
            b"</math><foreignObject><svg><a></FOREIGNOBJECT ><![CDATA[x",
            b"]]></svg>",
            id="upper-case-end-tag",
        ),
        pytest.param(b"<a>" + POINT + BEHIND, b"]]></svg>", id="a-behind-foreign-object"),
        pytest.param(b"<a><svg><desc><a></a></desc><![CDATA[x", b"]]></svg>", id="a-behind-desc"),
        pytest.param(
            b"<a><svg><title><a></a></title><![CDATA[x", b"]]></svg>", id="a-behind-title"
        ),
        pytest.param(b"<a><math><mi><a></a></mi><![CDATA[x", b"]]></math>", id="a-behind-mi"),
        pytest.param(
            b"<a><math><mtext><a></a></mtext><![CDATA[x", b"]]></math>", id="a-behind-mtext"
        ),
        pytest.param(
            b"<a><math><annotation-xml encoding=text/html><a></a></annotation-xml><![CDATA[x",
            b"]]></math>",
            id="a-behind-annotation-xml",
        ),
        pytest.param(b"<A>" + POINT + BEHIND, b"]]></svg>", id="upper-case-a"),
        pytest.param(b'<a href=x"y>' + POINT + BEHIND, b"]]></svg>", id="a-with-a-stray-quote"),
        pytest.param(
            b'<a href=/s?q="x>' + POINT + BEHIND, b"]]></svg>", id="a-with-an-equals-quote"
        ),
        pytest.param(
            b"<a>" + POINT + b"<!-- </a> -->" + BEHIND, b"]]></svg>", id="end-a-in-a-comment"
        ),
        pytest.param(
            b"<a><svg><title>x<a></a></title><![CDATA[x", b"]]></svg>", id="a-after-svg-title-text"
        ),
        *(
            pytest.param(b"<a>" + POINT + end + BEHIND, b"]]></svg>", id=name)
            for name, end in (
                ("comment-ends-at-gt", b"<!-->"),
                ("comment-ends-at-dash-gt", b"<!--->"),
                ("comment-ends-at-bang", b"<!-- c --!>"),
            )
        ),
        pytest.param(
            b"<a>" + POINT + b"<!-- <a> -->" + BEHIND, b"]]></svg>", id="start-a-in-a-comment"
        ),
        pytest.param(
            b"<a>" + POINT + b'<script>"</a>"</script>' + BEHIND,
            b"]]></svg>",
            id="end-a-in-a-script",
        ),
        pytest.param(
            b"<a>" + POINT + b'<br title="</a>">' + BEHIND, b"]]></svg>", id="end-a-in-an-attribute"
        ),
        pytest.param(b'<a title="x>y">' + POINT + BEHIND, b"]]></svg>", id="a-with-a-quoted-gt"),
        pytest.param(b"\r\n<a>\r\n" + POINT + BEHIND, b"]]></svg>", id="crlf-before-a"),
        pytest.param(b"<p><a></p>q" + POINT + BEHIND, b"]]></svg>", id="reopened-outer-a"),
        pytest.param(
            b"<a>" + POINT + b"<object><a></a></object></foreignObject><![CDATA[x",
            b"]]></svg>",
            id="object-marker-between",
        ),
        pytest.param(
            b"<a>" + POINT + b"<table><tr><td><a></a></td></tr></table></foreignObject><![CDATA[x",
            b"]]></svg>",
            id="td-marker-between",
        ),
        pytest.param(b"<svg><image><![CDATA[x", b"]]></svg>", id="svg-image"),
        pytest.param(b"<svg><image/><![CDATA[x", b"]]></svg>", id="svg-image-self-closing"),
        pytest.param(b"<p>\r\n</p>" + POINT + b"<image><![CDATA[x", b"]]></svg>", id="crlf-image"),
        pytest.param(POINT + b"<image-x><![CDATA[x", b"></svg>", id="image-x-is-no-image"),
        pytest.param(b"<p><![cdata[x", b">", id="lowercase-cdata-in-html"),
        pytest.param(b"<svg><![CDATA[a > b", b"]]></svg>", id="exact-cdata"),
        pytest.param(
            b"<foreignObject><p></foreignObject><svg><![CDATA[x",
            b"]]></svg>",
            id="html-foreign-object-closes",
        ),
        pytest.param(
            b"<a>" + POINT + b"<abbr></abbr></foreignObject><![CDATA[x", b"]]></svg>", id="abbr"
        ),
        pytest.param(
            b"<a>" + POINT + b'<script>"<a>"</script></foreignObject><![CDATA[x',
            b"]]></svg>",
            id="a-in-a-script",
        ),
        pytest.param(
            b"<a>" + POINT + b"<!-- <a> --></foreignObject><![CDATA[x",
            b"]]></svg>",
            id="a-in-a-comment",
        ),
        pytest.param(
            b"<a>" + POINT + b'<p title="<a>"></p></foreignObject><![CDATA[x',
            b"]]></svg>",
            id="a-in-an-attribute",
        ),
        pytest.param(b"<b>" + POINT + b"</b><![CDATA[x", b"]]></svg>", id="b-end-behind-a-point"),
    ],
)
def test_1652_the_closer_gives_what_chrome_needs(end: bytes, closer: bytes) -> None:
    assert served_closer(end) == closer


# Chrome ignores `</foreignObject>` with an html element open inside the point (#1652).
NOBR_END = b"</foreignObject><![CDATA[x"


@pytest.mark.parametrize(
    ("end", "closer"),
    [
        pytest.param(b"<nobr>" + POINT + b"<nobr>" + NOBR_END, b"></svg>", id="issue-step"),
        pytest.param(b"<nobr><svg><desc><nobr><![CDATA[x", b"></svg>", id="desc"),
        pytest.param(b"<nobr><svg><title><nobr><![CDATA[x", b"></svg>", id="title"),
        pytest.param(b"<nobr><math><mi><nobr><![CDATA[x", b"></math>", id="mi"),
        pytest.param(b"<nobr><math><mtext><nobr><![CDATA[x", b"></math>", id="mtext"),
        pytest.param(
            b"<nobr><math><annotation-xml encoding=text/html><nobr><![CDATA[x",
            b"></math>",
            id="annotation-xml",
        ),
        pytest.param(b"<NOBR>" + POINT + b"<NOBR>" + NOBR_END, b"></svg>", id="upper-case"),
        pytest.param(
            b'<nobr title="x>y">' + POINT + b'<nobr title="x>y">' + NOBR_END,
            b"></svg>",
            id="quoted-gt",
        ),
        pytest.param(b"\r\n<nobr>\r\n" + POINT + b"\r\n<nobr>" + NOBR_END, b"></svg>", id="crlf"),
        pytest.param(
            b"<nobr>" + POINT + b"<nobr></nobr>" + NOBR_END, b"]]></svg>", id="inner-end-tag"
        ),
        pytest.param(
            b"<nobr>" + POINT + b"<nobr>\r\n</NOBR >" + NOBR_END,
            b"]]></svg>",
            id="inner-end-tag-crlf-upper-case",
        ),
        pytest.param(
            b"<nobr>" + POINT + b"<nobr></nobr></nobr><![CDATA[x",
            b"]]></svg>",
            id="outer-end-tag-ignored",
        ),
        pytest.param(
            b"<nobr>" + POINT + b"<b></nobr><![CDATA[x", b"></svg>", id="outer-end-tag-past-b"
        ),
        pytest.param(b"<nobr>" + POINT + b"<nobr><nobr>" + NOBR_END, b"></svg>", id="third-nobr"),
        pytest.param(
            b"<nobr>" + POINT + b"<nobr><nobr></nobr></nobr>" + NOBR_END,
            b"]]></svg>",
            id="third-nobr-both-end-tags",
        ),
        pytest.param(
            b"<font><nobr>" + POINT + b"<nobr><font></font></nobr>" + NOBR_END,
            b"]]></svg>",
            id="font-of-its-own",
        ),
        pytest.param(b"<nobr><nobr><svg><![CDATA[x", b"]]></svg>", id="nobr-in-scope"),
        pytest.param(
            b"<nobr>" + POINT + b"</foreignObject></svg><nobr><svg><![CDATA[x",
            b"]]></svg>",
            id="nobr-after-the-point",
        ),
        pytest.param(
            b"<nobr>" + POINT + b"<object><nobr></object>" + NOBR_END,
            b"]]></svg>",
            id="object-marker-between",
        ),
    ],
)
def test_1657_a_nobr_behind_a_point_leaves_the_point_open(end: bytes, closer: bytes) -> None:
    assert served_closer(end) == closer


@pytest.mark.parametrize(
    ("end", "parses"),
    [
        pytest.param(b'<a href="x"><svg><title>t</title></svg></a>' * 50, 0, id="icon-links"),
        pytest.param(
            b"<a><svg>" + b"<title>t</title>" * 50 + b"</svg><a>x", 1, id="titles-share-one-a"
        ),
    ],
)
def test_1652_a_page_pays_one_prefix_parse_per_suspect_tag_at_most(
    end: bytes, parses: int, monkeypatch: pytest.MonkeyPatch
) -> None:
    calls = []
    real = html_closer._open
    monkeypatch.setattr(html_closer, "_open", lambda prefix: calls.append(prefix) or real(prefix))

    served_closer(end)

    assert len(calls) <= parses


FUZZ = (
    '<p class="a">x<!-- c --><svg viewBox="0 0 1 1"><g><![CDATA[a]]><foreignObject><div>'
    "<b>t</div>u<table><tr><td>v</table></foreignObject><title>w</title></svg>",
    "<math><mi>x</mi><annotation-xml encoding='text/html'><p><i>y</p>z</annotation-xml>"
    "<mtext><svg><desc><a><div></a></div></desc></svg></mtext></math><s><script>a<b</script>",
    "<svg><foreignObject><select><option>o<input><ruby><rb>r<rt>t</ruby><form><textarea>q"
    "</textarea></foreignObject><math><![CDATA[c]]></math></svg><style>p{}</style><xmp>&</xmp>",
)
SCRIPT_TEXT = LINKS_OUT.decode()[len("\n<script>") : -len("</script>\n")]


@pytest.mark.parametrize("page", FUZZ, ids=["svg-table", "math-annotation", "select-ruby"])
def test_1577_a_page_cut_anywhere_still_runs_the_link_script(page: str) -> None:
    misses = []
    for at in range(len(page) + 1):
        cut, closer = html_closer.closer(page[:at])
        whole = page[:cut] + closer + LINKS_OUT.decode() + page[cut:at]
        if not any(runs(node) for node in JustHTML(whole, sanitize=False).root.query("script")):
            misses.append(page[:at])

    assert misses == []


def runs(script: Element | Comment) -> bool:
    if not isinstance(script, Element):
        return False
    text = "".join(node.data for node in script.children if isinstance(node, Text))
    return script.namespace == "html" and text == SCRIPT_TEXT
