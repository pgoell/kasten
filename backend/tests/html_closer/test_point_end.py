"""A point's own end tag with an html element as the current node leaves the point open (#1670).

The in-body rules stop at the point, a special element, so Chrome ignores the tag; justhtml pops
the point. Each close here went through Chrome's DOMParser with a neutral marker after it.
"""

import pytest

from kasten_backend import html_closer
from kasten_backend.html_page import LINKS_OUT, PAGE_SCRIPT, serve_page

DOCTYPE = b"<!doctype html>"


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
        pytest.param(b"<svg><desc><b></desc>x", b"</svg>", id="issue-step-1"),
        pytest.param(b"<svg><desc><b></desc><![CDATA[x", b"></svg>", id="issue-step-2"),
        pytest.param(b"<svg><title><b></title><![CDATA[x", b"></svg>", id="point-title"),
        pytest.param(b"<math><mi><b></mi><![CDATA[x", b"></math>", id="point-mi"),
        pytest.param(b"<math><mo><b></mo><![CDATA[x", b"></math>", id="point-mo"),
        pytest.param(b"<math><mn><b></mn><![CDATA[x", b"></math>", id="point-mn"),
        pytest.param(b"<math><ms><b></ms><![CDATA[x", b"></math>", id="point-ms"),
        pytest.param(b"<math><mtext><b></mtext><![CDATA[x", b"></math>", id="point-mtext"),
        pytest.param(
            b"<math><annotation-xml encoding=text/html><b></annotation-xml><![CDATA[x",
            b"></math>",
            id="point-annotation-xml",
        ),
        pytest.param(
            b"<svg><foreignObject><b></foreignObject><![CDATA[x",
            b"></svg>",
            id="point-foreignObject",
        ),
        pytest.param(b"<svg><title><b></title>x", b"</svg>", id="point-title-text"),
        pytest.param(b"<math><mi><b></mi>x", b"</math>", id="point-mi-text"),
        pytest.param(b"<svg><desc><i></desc><![CDATA[x", b"></svg>", id="element-i"),
        pytest.param(b"<svg><desc><a></desc><![CDATA[x", b"></svg>", id="element-a"),
        pytest.param(b"<svg><desc><nobr></desc><![CDATA[x", b"></svg>", id="element-nobr"),
        pytest.param(b"<svg><desc><font></desc><![CDATA[x", b"></svg>", id="element-font"),
        pytest.param(b"<svg><desc><em></desc><![CDATA[x", b"></svg>", id="element-em"),
        pytest.param(b"<svg><desc><strong></desc><![CDATA[x", b"></svg>", id="element-strong"),
        pytest.param(b"<svg><desc><s></desc><![CDATA[x", b"></svg>", id="element-s"),
        pytest.param(b"<svg><desc><small></desc><![CDATA[x", b"></svg>", id="element-small"),
        pytest.param(b"<svg><desc><big></desc><![CDATA[x", b"></svg>", id="element-big"),
        pytest.param(b"<svg><desc><tt></desc><![CDATA[x", b"></svg>", id="element-tt"),
        pytest.param(b"<svg><desc><u></desc><![CDATA[x", b"></svg>", id="element-u"),
        pytest.param(b"<svg><desc><code></desc><![CDATA[x", b"></svg>", id="element-code"),
        pytest.param(b"<svg><desc><span></desc><![CDATA[x", b"></svg>", id="element-span"),
        pytest.param(b"<svg><desc><x-tag></desc><![CDATA[x", b"></svg>", id="element-x-tag"),
        pytest.param(b"<svg><desc><ruby><rt></desc><![CDATA[x", b"></svg>", id="element-ruby-rt"),
        pytest.param(b"<svg><desc><b></DESC\n><![CDATA[x", b"></svg>", id="upper-case-newline"),
        pytest.param(b"<svg><desc><b></desc></desc><![CDATA[x", b"></svg>", id="twice"),
        pytest.param(b"<svg><desc>t</desc><![CDATA[x", b"]]></svg>", id="point-is-current"),
        pytest.param(
            b"<svg><desc><b>t</b></desc><![CDATA[x", b"]]></svg>", id="point-is-current-after-b"
        ),
        pytest.param(b"<svg><desc><div></desc><![CDATA[x", b"></svg>", id="div-between"),
        pytest.param(
            b"<svg><desc><b><desc></desc></desc><![CDATA[x", b"></svg>", id="html-desc-inside"
        ),
        pytest.param(
            b"<svg><desc><desc><svg><title><b></desc><![CDATA[x",
            b"></svg></svg>",
            id="html-desc-under-a-point",
        ),
        pytest.param(b"<svg><desc><b><svg><desc><i></desc>x", b"</svg></svg>", id="nested-inner"),
        pytest.param(b"<svg><title><b><svg><desc><i></title>x", b"</svg></svg>", id="nested-outer"),
        pytest.param(
            b"<svg><desc><math><mi><b></mi><![CDATA[x", b"></math></svg>", id="math-in-svg"
        ),
        pytest.param(
            b"<svg><desc><b></desc></desc></desc></desc></desc></desc></desc></desc></desc></desc></desc></desc></desc></desc></desc></desc></desc></desc></desc></desc><![CDATA[x",
            b"></svg>",
            id="more-than-rewrites",
        ),
        pytest.param(b"<svg><desc><b></desc></b></desc><![CDATA[x", b"]]></svg>", id="then-closed"),
        pytest.param(b"<a><svg><desc><a></desc><![CDATA[x", b"></svg>", id="with-a"),
        pytest.param(b"<nobr><svg><desc><nobr></desc><![CDATA[x", b"></svg>", id="with-nobr"),
    ],
)
def test_1670_a_points_own_end_tag_behind_html_leaves_the_point_open(
    end: bytes, closer: bytes
) -> None:
    assert served_closer(end) == closer


def test_1670_a_point_holding_only_text_pays_no_prefix_parse(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    calls = []
    real = html_closer._open
    monkeypatch.setattr(html_closer, "_open", lambda prefix: calls.append(prefix) or real(prefix))

    closer = served_closer(b"<svg><title>t</title></svg>" * 50 + b"<svg><desc><b></desc>x")

    assert (closer, len(calls)) == (b"</svg>", 1)
