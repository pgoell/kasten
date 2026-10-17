import { toHtml, toSlack } from "@/lib/copy-as";

describe("toSlack", () => {
  it("spells emphasis the way Slack reads it", () => {
    expect(toSlack("**bold**, *italic*, ~~gone~~ and `code`")).toBe(
      "*bold*, _italic_, ~gone~ and `code`",
    );
  });

  it("turns a heading into a bold line", () => {
    expect(toSlack("## Plan\n\ntext")).toBe("*Plan*\n\ntext");
  });

  it("puts a link's address after its label", () => {
    expect(toSlack("[docs](https://example.com) and https://a.com")).toBe(
      "docs (https://example.com) and https://a.com",
    );
  });

  it("drops the language from a fence and keeps the code as it is", () => {
    expect(toSlack("```python\ndef f(x):\n    return x * 2\n```")).toBe(
      "```\ndef f(x):\n    return x * 2\n```",
    );
  });

  it("draws bullets, numbers and nesting", () => {
    expect(toSlack("- one\n  - inner\n- two\n\n1. first\n2. second")).toBe(
      "• one\n    • inner\n• two\n\n1. first\n2. second",
    );
  });

  it("draws a todo's box", () => {
    expect(toSlack("- [ ] open\n- [x] done")).toBe("• ☐ open\n• ☑ done");
  });

  it("writes a wikilink as the note's name and a highlight as its text", () => {
    expect(toSlack("see [[Some Note]] and ==this==")).toBe("see Some Note and this");
  });

  it("quotes every line of a quote", () => {
    expect(toSlack("> one\n> two")).toBe("> one\n> two");
  });

  it("leaves the frontmatter out", () => {
    expect(toSlack("---\ncreated: 2026-10-02\n---\nbody")).toBe("body");
  });

  it("keeps a table's columns in a code block", () => {
    expect(toSlack("| a | b |\n| - | - |\n| 1 | 2 |")).toBe(
      "```\n| a | b |\n| - | - |\n| 1 | 2 |\n```",
    );
  });
});

describe("toHtml", () => {
  it("renders inline formatting and escapes the text", () => {
    expect(toHtml("**a** <b> & *c* `x<y`")).toBe(
      "<p><strong>a</strong> &lt;b&gt; &amp; <em>c</em> <code>x&lt;y</code></p>",
    );
  });

  it("renders headings, lists and code", () => {
    expect(toHtml("# T\n\n- one\n- [x] two\n\n```js\na < b\n```")).toBe(
      "<h1>T</h1><ul><li>one</li><li>☑ two</li></ul><pre><code>a &lt; b</code></pre>",
    );
  });

  it("renders a link and a wikilink", () => {
    expect(toHtml("[docs](https://example.com) [[Note]]")).toBe(
      '<p><a href="https://example.com">docs</a> Note</p>',
    );
  });

  it("renders a table", () => {
    expect(toHtml("| a | b |\n| - | - |\n| 1 | 2 |")).toBe(
      "<table><tr><th>a</th><th>b</th></tr><tr><td>1</td><td>2</td></tr></table>",
    );
  });
});

describe("a callout", () => {
  it("gives Slack the callout's title as a bold line", () => {
    expect(toSlack("> [!tip] Use jj\n> It keeps history.")).toBe("> *Use jj*\n> It keeps history.");
  });

  it("gives Teams the callout's title as a bold paragraph", () => {
    expect(toHtml("> [!tip] Mind <this>\n> It keeps history.")).toBe(
      "<blockquote><p><strong>Mind &lt;this&gt;</strong></p><p>It keeps history.</p></blockquote>",
    );
  });

  it("titles a callout with no title after its type", () => {
    expect(toSlack("> [!warning]\n> Hot.")).toBe("> *Warning*\n> Hot.");
  });

  it("keeps a callout's fold sign out of the chat", () => {
    expect(toSlack("> [!faq]- Why?\n> Because.")).toBe("> *Why?*\n> Because.");
    expect(toHtml("> [!faq]+ Why?")).toBe("<blockquote><p><strong>Why?</strong></p></blockquote>");
  });

  it("titles a callout nested in a callout", () => {
    expect(toSlack("> [!note] Outer\n> > [!bug] Inner\n> > Body")).toBe(
      "> *Outer*\n> > *Inner*\n> > Body",
    );
  });

  it("renders a callout title's wikilink and emphasis as the chat's own", () => {
    const note = "> [!note] See [[Other|alias]] **now**\n> body";
    expect(toSlack(note)).toBe("> *See alias now*\n> body");
    expect(toHtml(note)).toBe(
      "<blockquote><p><strong>See alias <strong>now</strong></strong></p><p>body</p></blockquote>",
    );
  });

  it("keeps a callout title's literal and code asterisks for Slack", () => {
    expect(toSlack("> [!note] 2 * 3 and `a*b`\n> x")).toBe("> *2 * 3 and `a*b`*\n> x");
  });

  it("prints a callout title that runs onto the next line once", () => {
    expect(toSlack("> [!note] *Title\n> more*\n> body")).toBe("> *Title more*\n> body");
  });

  it("reads a callout only off the quote's first line", () => {
    expect(toSlack(">\n> [!note] T\n> body")).not.toContain("*T*");
  });

  it("leaves a quote that opens no callout as it is", () => {
    expect(toSlack("> plain\n>\n> two")).toBe("> plain\n> \n> two");
    expect(toHtml("> one")).toBe("<blockquote><p>one</p></blockquote>");
  });
});

// The parser reads every `[text]` with no `(url)` as a link (#434).
describe("bracketed text with no address", () => {
  it.each([
    ["A10 in a quote", "> [x] one", "> [x] one", "<blockquote><p>[x] one</p></blockquote>"],
    ["I1 on a plain line", "see [text] here", "see [text] here", "<p>see [text] here</p>"],
    ["I1 as a full reference", "[text][ref] x", "[text][ref] x", "<p>[text][ref] x</p>"],
    ["I1 holding emphasis", "[**a** <b>]", "[*a* <b>]", "<p>[<strong>a</strong> &lt;b&gt;]</p>"],
    ["I7 as a todo's box", "- [/] task", "• [/] task", "<ul><li>[/] task</li></ul>"],
    [
      "A11 in a callout's body, its head still the title",
      "> [!note] T\n> [x] one",
      "> *T*\n> [x] one",
      "<blockquote><p><strong>T</strong></p><p>[x] one</p></blockquote>",
    ],
  ])("keeps its brackets %s", (_, note, slack, html) => {
    expect(toSlack(note)).toBe(slack);
    expect(toHtml(note)).toBe(html);
  });

  it("B1 [a]() copies as its text, a link with an empty address", () => {
    expect(toSlack("see [a]() here")).toBe("see a here");
    expect(toHtml("see [a]() here")).toBe("<p>see a here</p>");
  });

  it("I3 still writes a [text](url) link as before", () => {
    expect(toSlack("> [docs](https://example.com)")).toBe("> docs (https://example.com)");
    expect(toHtml("[docs](https://example.com)")).toBe(
      '<p><a href="https://example.com">docs</a></p>',
    );
  });
});

describe("a wikilink's alias and heading", () => {
  it("writes an aliased wikilink as its alias", () => {
    expect(toSlack("see [[borges|Jorge]]")).toBe("see Jorge");
    expect(toHtml("see [[borges|Jorge]]")).toBe("<p>see Jorge</p>");
  });

  it("writes an aliased wikilink in a table cell as its alias", () => {
    expect(toHtml("| a |\n| - |\n| [[borges\\|Jorge]] |")).toBe(
      "<table><tr><th>a</th></tr><tr><td>Jorge</td></tr></table>",
    );
  });

  it("keeps a heading link without an alias as written", () => {
    expect(toSlack("[[x#H]]")).toBe("x#H");
    expect(toHtml("[[x#H]]")).toBe("<p>x#H</p>");
  });

  it("drops an embed's bang for Slack and Teams", () => {
    expect(toSlack("![[borges]]")).toBe("borges");
    expect(toHtml("![[borges]]")).toBe("<p>borges</p>");
  });

  it("drops the bang of an aliased, image, heading, listed or tabled embed", () => {
    expect(toSlack("![[borges|Borges]]")).toBe("Borges");
    expect(toSlack("![[shot.png]]")).toBe("shot.png");
    expect(toSlack("![[n#h]]")).toBe("n#h");
    expect(toHtml("![[n#h]]")).toBe("<p>n#h</p>");
    expect(toSlack("- see ![[borges]]")).not.toContain("!");
    expect(toHtml("- see ![[borges]]")).not.toContain("!");
    expect(toHtml("| a |\n| - |\n| ![[borges]] |")).toBe(
      "<table><tr><th>a</th></tr><tr><td>borges</td></tr></table>",
    );
  });

  it("writes the link inside an embed as its alias", () => {
    for (const out of [toSlack("![[x|y]]"), toHtml("![[x|y]]")]) {
      expect(out).toContain("y");
      expect(out).not.toContain("x|y");
    }
  });
});
