import { toHtml, toSlack } from "@/lib/editor/copy-as";

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

describe("a reference link with a definition (#439)", () => {
  const DEFINED = "[docs]: https://example.com";

  it.each([
    ["a shortcut", "see [docs] here", "docs"],
    ["a full", "see [the docs][docs] here", "the docs"],
    ["a collapsed", "see [docs][] here", "docs"],
  ])(
    "A9 gives Slack and Teams %s reference as its link, the definition left out",
    (_, doc, text) => {
      const note = `${doc}\n\n${DEFINED}`;

      expect([toSlack(note), toHtml(note)]).toEqual([
        `see ${text} (https://example.com) here`,
        `<p>see <a href="https://example.com">${text}</a> here</p>`,
      ]);
    },
  );

  it("A7 keeps the brackets of an undefined [text] beside a defined one", () => {
    const slack = toSlack(`[text] and [docs]\n\n${DEFINED}`);
    const html = toHtml(`[text] and [docs]\n\n${DEFINED}`);

    expect(slack.startsWith("[text] and ")).toBe(true);
    expect(html.startsWith("<p>[text] and ")).toBe(true);
    expect([slack, html]).toEqual([
      "[text] and docs (https://example.com)",
      '<p>[text] and <a href="https://example.com">docs</a></p>',
    ]);
  });

  it("A9 resolves a part of a note against the whole note's definitions", () => {
    const note = `see [docs] here\n\n${DEFINED}`;

    expect([toSlack("see [docs] here", note), toHtml("see [docs] here", note)]).toEqual([
      "see docs (https://example.com) here",
      '<p>see <a href="https://example.com">docs</a> here</p>',
    ]);
  });

  it("copies a javascript:, data: or vbscript: address as its text (#549)", () => {
    const note = [
      "[safe] [inline](javascript:alert(1)) [ref] [d] [vb]",
      "",
      "[safe]: https://example.com",
      "",
      "[ref]: JavaScript:alert(1)",
      "",
      "[d]: data:text/html,x",
      "",
      "[vb]: vbscript:x",
    ].join("\n");

    expect(toSlack("[safe]\n\n[safe]: https://example.com")).toBe("safe (https://example.com)");
    expect([toSlack(note), toHtml(note)]).toEqual([
      "safe (https://example.com) inline ref d vb",
      '<p><a href="https://example.com">safe</a> inline ref d vb</p>',
    ]);
  });

  it("A9 keeps a selection's own definitions beside the note's", () => {
    const part = "see [a]\n\n[a]: https://a.example";
    const note = `intro\n\n\`\`\`md\n${part}\n\`\`\``;

    expect(toSlack(part, note)).toBe("see a (https://a.example)");
  });

  it("keeps a footnote as typed though its label is defined", () => {
    const note = `claim[^1] and [docs]\n\n[^1]: https://source.example\n\n${DEFINED}`;

    expect([toSlack(note), toHtml(note)]).toEqual([
      "claim[^1] and docs (https://example.com)",
      '<p>claim[^1] and <a href="https://example.com">docs</a></p>',
    ]);
  });

  it("I6 takes the first of two definitions of one label", () => {
    const note = "[a]\n\n[a]: https://one.example\n\n[A]: https://two.example";

    expect([toSlack(note), toHtml(note)]).toEqual([
      "a (https://one.example)",
      '<p><a href="https://one.example">a</a></p>',
    ]);
  });

  it("I7 resolves a definition with a title to its address", () => {
    const note = '[a]\n\n[a]: https://x.example "Title"';

    expect([toSlack(note), toHtml(note)]).toEqual([
      "a (https://x.example)",
      '<p><a href="https://x.example">a</a></p>',
    ]);
  });
});

describe("an image with no address, and an address in angle brackets", () => {
  it("#442 gives Slack ![alt] as written", () => {
    expect(toSlack("see ![alt] here")).toBe("see ![alt] here");
  });

  it("#442 gives Teams ![alt] as written", () => {
    expect(toHtml("see ![alt] here")).toBe("<p>see ![alt] here</p>");
  });

  it("#443 gives Slack [a](<>) as its text", () => {
    expect(toSlack("see [a](<>) here")).toBe("see a here");
  });

  it("#443 gives Teams [a](<>) as its text", () => {
    expect(toHtml("see [a](<>) here")).toBe("<p>see a here</p>");
  });

  it("I6 drops the angle brackets around a link's address", () => {
    expect(toSlack("[a](<https://x.y>)")).toBe("a (https://x.y)");
    expect(toHtml("[a](<https://x.y>)")).toBe('<p><a href="https://x.y">a</a></p>');
  });

  it("I7 keeps ![alt][ref] as written", () => {
    expect(toSlack("![alt][ref] x")).toBe("![alt][ref] x");
    expect(toHtml("![alt][ref] x")).toBe("<p>![alt][ref] x</p>");
  });

  it("I7 gives ![alt](<>) as its text", () => {
    expect(toSlack("![alt](<>)")).toBe("alt");
    expect(toHtml("![alt](<>)")).toBe("<p>alt</p>");
  });

  it("I7 guard: gives ![alt]() as its text", () => {
    expect(toSlack("![alt]()")).toBe("alt");
    expect(toHtml("![alt]()")).toBe("<p>alt</p>");
  });

  it("I7 guard: writes ![alt](u) as before", () => {
    expect(toSlack("![alt](u)")).toBe("alt (u)");
    expect(toHtml("![alt](u)")).toBe('<p><a href="u">alt</a></p>');
  });
});

describe("a reference image and an escaped address (#547, #447)", () => {
  it("A3 gives Slack and Teams [a](<x\\>y>) the address x>y", () => {
    expect([toSlack("[a](<x\\>y>)"), toHtml("[a](<x\\>y>)")]).toEqual([
      "a (x>y)",
      '<p><a href="x&gt;y">a</a></p>',
    ]);
  });

  it("A8 gives Slack and Teams ![cat][pic] what ![cat](url) gives", () => {
    const url = "https://example.com/cat.png";

    expect([toSlack(`![cat](${url})`), toHtml(`![cat](${url})`)]).toEqual([
      `cat (${url})`,
      `<p><a href="${url}">cat</a></p>`,
    ]);
    const note = `![cat][pic]\n\n[pic]: ${url}`;
    expect([toSlack(note), toHtml(note)]).toEqual([
      `cat (${url})`,
      `<p><a href="${url}">cat</a></p>`,
    ]);
  });

  it("I2 keeps ![alt][ref] with no definition as typed, and gives a defined one as its link", () => {
    expect([toSlack("![alt][ref]"), toHtml("![alt][ref]")]).toEqual([
      "![alt][ref]",
      "<p>![alt][ref]</p>",
    ]);
    const note = "![alt][ref]\n\n[ref]: https://x.y/a.png";
    expect([toSlack(note), toHtml(note)]).toEqual([
      "alt (https://x.y/a.png)",
      '<p><a href="https://x.y/a.png">alt</a></p>',
    ]);
  });

  it("I4 undoes a backslash escape in a definition's <address> and in a bare (address)", () => {
    expect([toSlack("[a]\n\n[a]: <https://x.y/a\\>b>"), toSlack("[a](https://x.y/a\\)b)")]).toEqual(
      ["a (https://x.y/a>b)", "a (https://x.y/a)b)"],
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

describe("math", () => {
  it("A9 keeps inline math as its source, its stars no emphasis", () => {
    expect(toSlack("so $a*b*c$ holds")).toBe("so `$a*b*c$` holds");
    expect(toHtml("so $a<b*c*$ holds")).toBe("<p>so <code>$a&lt;b*c*$</code> holds</p>");
  });

  it("A9 keeps a math block as its source", () => {
    const note = "before\n\n$$\na_1 * b_2 * c\n$$\n\nafter";
    expect(toSlack(note)).toBe("before\n\n```\n$$\na_1 * b_2 * c\n$$\n```\n\nafter");
    expect(toHtml(note)).toBe(
      "<p>before</p><pre><code>$$\na_1 * b_2 * c\n$$</code></pre><p>after</p>",
    );
  });

  it("R2 keeps one quote mark on each line of a math block in a callout", () => {
    expect(toSlack("> [!note]\n> $$\n> x^2\n> $$")).toBe(
      "> *Note*\n> ```\n> $$\n> x^2\n> $$\n> ```",
    );
  });

  it("R3 keeps one indent on each line of a math block in a list", () => {
    expect(toSlack("- item\n  $$\n  x\n  $$")).toBe(
      "• item\n    ```\n    $$\n    x\n    $$\n    ```",
    );
  });

  it("R4 leaves a lazy line opening with two dollars in its list item", () => {
    expect(toSlack("- item\n$$ lazy\n- next")).toBe("• item\n    $$ lazy\n• next");
  });

  it("R5 opens no formula that would cut through a wikilink", () => {
    expect(toSlack("costs $5 per [[Item]], x$ each")).toBe("costs $5 per Item, x$ each");
  });
});
