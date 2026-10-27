import { pageStyles } from "@/lib/book/book-backing";

const { theme } = vi.hoisted(() => ({ theme: { current: "light" as "light" | "dark" } }));
vi.mock("@/lib/theme", () => ({ currentTheme: () => theme.current }));

const SERIF = '"Newsreader Variable", Georgia, serif';
const MONO = '"JetBrains Mono Variable", ui-monospace, monospace';

/** The app's tokens the page reads, set on the root the way `app.css` sets them. */
function tokens(ink: string, bg: string, highlight: string) {
  const root = document.documentElement.style;
  root.setProperty("--k-ink", ink);
  root.setProperty("--k-bg", bg);
  root.setProperty("--k-link", "#316f90");
  root.setProperty("--k-serif", SERIF);
  root.setProperty("--k-mono", MONO);
  root.setProperty("--k-text-read", "19px");
  root.setProperty("--k-leading-reading", "1.6");
  root.setProperty("--k-highlight", highlight);
}

afterEach(() => {
  for (const name of [
    "--k-ink",
    "--k-bg",
    "--k-link",
    "--k-serif",
    "--k-mono",
    "--k-text-read",
    "--k-leading-reading",
    "--k-highlight",
  ])
    document.documentElement.style.removeProperty(name);
  for (const style of document.head.querySelectorAll("style[data-test-face]")) style.remove();
  theme.current = "light";
});

describe("the book's type in its own page", () => {
  it("sets the body in the app's serif at the reading size and leading", () => {
    tokens("#1c1c1b", "#f6f6f4", "rgba(249,157,27,.22)");

    const css = pageStyles();

    // Soft, so every line of the type is checked in the one run.
    expect.soft(css).toContain(`body:not(#\\#) { font-family: ${SERIF} !important;`);
    expect.soft(css).toContain("font-size: 19px !important;");
    expect.soft(css).toContain("line-height: 1.6 !important;");
  });

  it("sets code, pre, kbd and samp in the app's mono and leaves the rest in the serif", () => {
    tokens("#1c1c1b", "#f6f6f4", "rgba(249,157,27,.22)");

    const css = pageStyles();

    const monoRule = `body:not(#\\#) :is(code, pre, kbd, samp):not(#\\#) { font-family: ${MONO} !important; }`;
    const serifRule = `body:not(#\\#) :not(code, pre, kbd, samp, code *, pre *, kbd *, samp *):not(#\\#) { font-family: ${SERIF} !important; }`;
    expect.soft(css).toContain(monoRule);
    expect.soft(css).toContain(serifRule);
  });

  it("keeps the serif off a span inside code, which keeps the mono it inherits", () => {
    tokens("#1c1c1b", "#f6f6f4", "rgba(249,157,27,.22)");
    // The serif rule's own exclusion, read back out of the stylesheet the page gets:
    // the `:not(...)` on the line that sets the serif on the body's text.
    const line = pageStyles()
      .split("\n")
      .find((rule) => rule.includes(`{ font-family: ${SERIF} `) && rule.includes(":not(code"));
    const exclusion = /:not\(code, pre, kbd, samp[^)]*\)/.exec(line ?? "")?.[0];
    const block = document.createElement("pre");
    const span = document.createElement("span");
    const paragraph = document.createElement("p");
    block.append(span);
    document.body.append(block, paragraph);

    expect(exclusion).toBeDefined();
    // Matched by the page's own selector: the span in a block of code is not one
    // the serif reaches, and a paragraph is.
    expect(span.matches(exclusion ?? "")).toBe(false);
    expect(paragraph.matches(exclusion ?? "")).toBe(true);
    block.remove();
    paragraph.remove();
  });

  it("paints a selection in the highlight token", () => {
    tokens("#1c1c1b", "#f6f6f4", "rgba(249,157,27,.22)");

    expect(pageStyles()).toContain(
      "body:not(#\\#) ::selection { background: rgba(249,157,27,.22) !important; }",
    );
  });

  it("takes the light tokens on the light page and the dark tokens on the dark one", () => {
    tokens("#1c1c1b", "#f6f6f4", "rgba(249,157,27,.22)");
    expect(pageStyles()).toContain("color: #1c1c1b !important;");

    theme.current = "dark";
    tokens("#e8e7e4", "#141414", "rgba(167,212,228,.18)");
    const dark = pageStyles();

    expect(dark).toContain("color: #e8e7e4 !important;");
    expect(dark).toContain("background: #141414 !important;");
    expect(dark).toContain(
      "body:not(#\\#) ::selection { background: rgba(167,212,228,.18) !important; }",
    );
  });

  it("copies the app's own face for the serif across and leaves other families out", () => {
    tokens("#1c1c1b", "#f6f6f4", "rgba(249,157,27,.22)");
    const style = document.createElement("style");
    style.dataset.testFace = "";
    // jsdom's stylesheet parser keeps the family and drops `src`, so the url is
    // checked on its own in `book-font-urls.test.ts` and in the browser.
    style.textContent = [
      `@font-face { font-family: "Newsreader Variable"; }`,
      `@font-face { font-family: "Other Family"; }`,
    ].join("\n");
    document.head.append(style);

    const css = pageStyles();

    expect(css).toMatch(/@font-face \{[^}]*"Newsreader Variable"/);
    expect(css).not.toContain("Other Family");
  });
});
