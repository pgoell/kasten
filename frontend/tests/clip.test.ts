import { clipPage } from "@/lib/clip";

const URL = "https://example.com/posts/worry";

/** A page with the shape defuddle reads: metadata in the head, prose in an article. */
function page(head: string, article: string): string {
  return `<!doctype html><html><head>${head}</head><body>
    <nav><a href="/">home</a></nav>
    <article>${article}</article>
    <footer>copyright</footer></body></html>`;
}

const PROSE = `
  <p>First paragraph with a <a href="/inner">relative link</a> and <strong>bold</strong>.</p>
  <h2>Second part</h2>
  <p>More text here, long enough to score. More text here, long enough to score.</p>`;

describe("clipPage", () => {
  it("names the note after the page and puts it in the inbox", () => {
    const { path } = clipPage(page("<title>How I stopped worrying</title>", PROSE), URL);

    expect(path).toBe("00 Inbox/How I stopped worrying.md");
  });

  it("takes the characters a path cannot hold out of the name", () => {
    const { path } = clipPage(page("<title>A/B testing: what * why?</title>", PROSE), URL);

    expect(path).toBe("00 Inbox/A B testing what why.md");
  });

  it("falls back to the site the page came from when it has no title", () => {
    const { path } = clipPage(page("", PROSE), URL);

    expect(path).toBe("00 Inbox/example.com.md");
  });

  it("writes the address it was read from, and says the note is a source", () => {
    const { body } = clipPage(page("<title>Worry</title>", PROSE), URL);
    const lines = body.split("\n");

    expect(body.startsWith("---\n")).toBe(true);
    expect(lines).toContain(`resource: "${URL}"`);
    expect(lines).toContain("type: Source");
    // Whole lines, because `resource:` holds `source:` inside it and a
    // substring check would pass over the field this replaces.
    expect(lines.some((line) => line.startsWith("source:"))).toBe(false);
  });

  it("writes the author and the date the page names", () => {
    const head = `<title>Worry</title>
      <meta name="author" content="Jane Roe">
      <meta property="article:published_time" content="2025-03-04T10:00:00Z">`;

    const { body } = clipPage(page(head, PROSE), URL);

    expect(body).toContain('author: "Jane Roe"');
    expect(body).toContain('published: "2025-03-04T10:00:00Z"');
  });

  it("leaves out the fields the page does not carry", () => {
    const { body } = clipPage(page("<title>Worry</title>", PROSE), URL);

    expect(body).not.toContain("author:");
    expect(body).not.toContain("published:");
  });

  it("quotes what it writes, so a colon in a title cannot break the block", () => {
    const head = `<title>Worry</title><meta name="author" content="Roe: the sequel">`;

    const { body } = clipPage(page(head, PROSE), URL);

    expect(body).toContain('author: "Roe: the sequel"');
  });

  it("heads the note with the page's title", () => {
    const { body } = clipPage(page("<title>How I stopped worrying</title>", PROSE), URL);

    expect(body).toContain("\n# How I stopped worrying\n");
  });

  it("writes the prose as markdown, and not the chrome around it", () => {
    const { body } = clipPage(page("<title>Worry</title>", PROSE), URL);

    expect(body).toContain("**bold**");
    expect(body).toContain("## Second part");
    expect(body).not.toContain("copyright");
    expect(body).not.toContain("<p>");
  });

  it("makes a page's relative links absolute, so they still lead somewhere", () => {
    const { body } = clipPage(page("<title>Worry</title>", PROSE), URL);

    expect(body).toContain("(https://example.com/inner)");
  });
});
