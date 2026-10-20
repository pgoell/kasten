from kasten_backend.anki_html import plain


def test_plain_strips_a_tag_it_has_no_markdown_for() -> None:
    # `<span>` leaves no space behind: only the tags that end a line do (#234).
    assert plain('one<span class="x">two</span><font>three</font>') == "onetwothree"


def test_plain_unescapes_entities() -> None:
    assert plain("salt&nbsp;&amp;&nbsp;pepper") == "salt & pepper"


def test_plain_drops_an_image_and_a_sound() -> None:
    assert plain('<img src="cat.jpg"> a cat [sound:meow.mp3] purring') == "a cat purring"


def test_plain_answers_with_one_line() -> None:
    result = plain("first\nsecond  \t third \n")

    assert "\n" not in result
    assert result == "first second third"


def test_plain_drops_script_and_style_blocks() -> None:
    assert plain("<style>.card { color: red }</style>a<SCRIPT>var x = 1;</script>b") == "ab"


def test_plain_writes_breaks_and_paragraphs_as_lines() -> None:
    field = "one<br>two<div>three</div><p>four</p>five"

    assert plain(field) == "one\ntwo\nthree\nfour\nfive"


def test_plain_leaves_no_blank_line_in_a_side() -> None:
    # `srs.ts` ends a `?` card at a blank line, so a run of breaks is one.
    assert plain("a<br><br><br>b<p></p><div><br></div><p>c</p>") == "a\nb\nc"


def test_plain_writes_bold_italic_and_underline_as_bold() -> None:
    field = "<b>a</b> <strong>b</strong> <i>c</i> <em>d</em> <u>e</u> <b> f </b>"

    assert plain(field) == "**a** **b** *c* *d* **e** **f**"


def test_plain_writes_lists_a_line_per_item() -> None:
    field = "<ul><li>one</li><li>two</li></ul><ol><li>first</li><li>second</li></ol>"

    assert plain(field) == "- one\n- two\n1. first\n2. second"


def test_plain_writes_links() -> None:
    field = 'see <a href="https://example.com/a (b)">the site</a> now'

    assert plain(field) == "see [the site](https://example.com/a%20%28b%29) now"


def test_plain_writes_code_and_pre_with_backticks() -> None:
    # No fence: both readers skip every card inside one.
    assert plain("use <code>a*b</code>") == "use `a*b`"
    assert plain("<pre>x = `1`\n  y</pre>") == "`` x = `1` ``\n`  y`"


def test_plain_keeps_ruby_and_drops_its_parentheses() -> None:
    field = "<ruby>漢字<rp>(</rp><rt>かんじ</rt><rp>)</rp></ruby>"

    assert plain(field) == "<ruby>漢字<rt>かんじ</rt></ruby>"


def test_plain_keeps_the_address_of_a_link_over_a_break() -> None:
    assert plain('<a href="https://x.org">a<br>b</a>') == "[a b](https://x.org)"


def test_plain_turns_media_into_links() -> None:
    links = {"cat.png": "d/cat.png", "a&b.png": "d/a&b.png", "meow.mp3": "d/meow.mp3"}
    field = (
        "<img src=\"cat.png\"> <IMG alt=x SRC='a&amp;b.png'> <img src=cat.png>"
        " [sound:meow.mp3] <img src='gone.png'> [sound:gone.mp3]"
    )

    assert plain(field, links) == "![](d/cat.png) ![](d/a&b.png) ![](d/cat.png) ![](d/meow.mp3)"
