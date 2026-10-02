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
