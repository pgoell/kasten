import { EditorSelection } from "@codemirror/state";
import { vim } from "@replit/codemirror-vim";
import { fireEvent, waitFor } from "@testing-library/react";
import { vimKeys } from "@/lib/notes/editor/vim-mode";
import { BYTE_CAP, ROW_CAP } from "@/lib/notes/embeds/csv";
import { EMBED_DEPTH, embedSource } from "@/lib/notes/embeds/embed";
import { imagePaths } from "@/lib/notes/embeds/image";
import { vaultPaths } from "@/lib/notes/links/wikilink";
import { livePreview } from "@/lib/notes/live/live-preview";
import {
  ABOVE,
  embedded,
  fakeVault,
  liveHooks,
  mount,
  mounted,
  parsed,
  plain,
  stalled,
} from "./live-preview-fixture";

liveHooks();

describe("an embed", () => {
  it("draws the note's body in place, frontmatter left out", () => {
    const vault = fakeVault({ "b.md": "---\nid: b1\n---\nbody of b" });
    const view = mount(`${ABOVE}![[b]]`, plain(vault.source));

    expect(embedded(view)).toBe("body of b");
    expect(view.contentDOM.textContent).not.toContain("![[");
    expect(view.contentDOM.textContent).not.toContain("b1");
  });

  it("draws one section, through its lower headings, up to the next of its level", () => {
    const note = "# B\nintro of b\n## Two\ntwo body\n### Sub\nsub body\n## Three\nthree body";
    const vault = fakeVault({ "b.md": note });
    const view = mount(`${ABOVE}![[b# two ]]`, plain(vault.source));

    expect(embedded(view)).toContain("two body");
    expect(embedded(view)).toContain("sub body");
    expect(embedded(view)).not.toContain("intro of b");
    expect(embedded(view)).not.toContain("three body");
  });

  it("finds its note by the wikilink rule", () => {
    const vault = fakeVault({ "reading/borges.md": "the aleph" });
    const view = mount(`${ABOVE}![[Borges]]`, plain(vault.source, ["reading/borges.md"]));

    expect(vault.watched).toEqual(["reading/borges.md"]);
    expect(embedded(view)).toBe("the aleph");
  });

  it("draws the same embed under an alias", () => {
    const vault = fakeVault({ "b.md": "# B\ntop\n## Two\ntwo body" });

    expect(embedded(stalled(() => mount(`${ABOVE}![[b#Two|see b]]`, plain(vault.source))))).toBe(
      embedded(stalled(() => mount(`${ABOVE}![[b#Two]]`, plain(vault.source)))),
    );
    expect(embedded(stalled(() => mount(`${ABOVE}![[b|see b]]`, plain(vault.source))))).toBe(
      "BtopTwotwo body",
    );
  });

  it("draws an image the vault holds as the picture", () => {
    const vault = fakeVault({});
    const view = mount(`${ABOVE}![[my shot.png]]`, plain(vault.source));

    expect(view.dom.querySelector("img.cm-image")?.getAttribute("src")).toBe(
      "/api/assets/99%20Misc/my%20shot.png",
    );
    expect(view.dom.querySelector(".cm-embed")).toBeNull();
    expect(vault.watched).toEqual([]);
  });

  it("loads an image whose name holds ?", () => {
    // `?` and not `#`: `![[plan #2.png]]` embeds the heading `2.png` of `plan `.
    // Ahead of `plain`'s own listing, the facet taking the first it is given.
    const view = mount(`${ABOVE}![[plan?.png]]`, [
      imagePaths.of(["99 Misc/plan?.png"]),
      ...plain(fakeVault({}).source),
    ]);

    expect(view.dom.querySelector("img.cm-image")?.getAttribute("src")).toBe(
      "/api/assets/99%20Misc/plan%3F.png",
    );
  });

  it("says so where the note or the heading is missing", () => {
    const vault = fakeVault({ "b.md": "# B\nbody" });

    const note = mount(`${ABOVE}![[nope]]`, plain(vault.source));
    expect(note.dom.querySelector(".cm-embed-missing")?.textContent).toBe("Not found: nope");

    const heading = mount(`${ABOVE}![[b#nope|alias]]`, plain(vault.source));
    expect(heading.dom.querySelector(".cm-embed-missing")?.textContent).toBe("Not found: b#nope");
  });

  it("goes missing when the source stops answering", () => {
    const vault = fakeVault({ "b.md": "body" });
    const view = mount(`${ABOVE}![[b]]`, plain(vault.source));

    vault.push("b.md", null);

    expect(view.dom.querySelector(".cm-embed-missing")?.textContent).toBe("Not found: b");
    expect(view.dom.querySelector(".cm-embed .cm-content")).toBeNull();
  });

  it("redraws when its note changes, without remounting", () => {
    const vault = fakeVault({ "b.md": "first" });
    const view = mount(`${ABOVE}![[b]]`, plain(vault.source));
    const box = view.dom.querySelector(".cm-embed");

    // The edit's parse may run out of time under load; the box must still be
    // the one drawn before it once the parse is done.
    stalled(() => view.dispatch({ changes: { from: 0, insert: "more " } }));
    parsed(view);
    vault.push("b.md", "second");

    expect(view.dom.querySelector(".cm-embed")).toBe(box);
    expect(embedded(view)).toBe("second");
    expect(vault.watched).toEqual(["b.md"]);
  });

  it("keeps its box through a cursor move before the edit's parse lands", () => {
    const vault = fakeVault({ "b.md": "first" });
    const view = mount(`${ABOVE}![[b]]`, plain(vault.source));
    const box = view.dom.querySelector(".cm-embed");

    stalled(() => view.dispatch({ changes: { from: 0, insert: "more " } }));
    view.dispatch({ selection: EditorSelection.cursor(1) });
    parsed(view);

    expect(view.dom.querySelector(".cm-embed")).toBe(box);
  });

  it("keeps its box through a second edit whose parse runs out too", () => {
    const vault = fakeVault({ "b.md": "first" });
    const view = mount(`${ABOVE}![[b]]`, plain(vault.source));
    const box = view.dom.querySelector(".cm-embed");

    stalled(() => view.dispatch({ changes: { from: 0, insert: "more " } }));
    stalled(() => view.dispatch({ changes: { from: 0, insert: "and " } }));
    parsed(view);

    expect(view.dom.querySelector(".cm-embed")).toBe(box);
  });

  it("opens its note on ctrl or cmd and a click, and not on a plain click", () => {
    const vault = fakeVault({ "b.md": "body" });
    const view = mount(`${ABOVE}![[b]]`, plain(vault.source));
    const box = view.dom.querySelector(".cm-embed") as HTMLElement;

    fireEvent.mouseDown(box);
    fireEvent.click(box);
    expect(vault.opened).toEqual([]);

    fireEvent.mouseDown(box, { ctrlKey: true });
    fireEvent.mouseDown(box, { metaKey: true });
    expect(vault.opened).toEqual([
      ["b.md", undefined],
      ["b.md", undefined],
    ]);
  });

  it("opens a section at its heading's line, counted with the frontmatter", () => {
    const vault = fakeVault({ "b.md": "---\nid: b1\n---\n# B\n\n## Two\nbody" });
    const view = mount(`${ABOVE}![[b#two]]`, plain(vault.source));

    fireEvent.mouseDown(view.dom.querySelector(".cm-embed") as HTMLElement, { ctrlKey: true });

    expect(vault.opened).toEqual([["b.md", 6]]);
  });

  it("opens its note on a tap, and not on a touch the browser took for a scroll", () => {
    const vault = fakeVault({ "b.md": "body" });
    const view = mount(`${ABOVE}![[b]]`, plain(vault.source));
    const box = view.dom.querySelector(".cm-embed") as HTMLElement;

    fireEvent.pointerDown(box, { pointerType: "touch" });
    fireEvent.pointerCancel(box, { pointerType: "touch" });
    fireEvent.click(box);
    fireEvent.pointerDown(box, { pointerType: "mouse" });
    fireEvent.click(box);
    expect(vault.opened).toEqual([]);

    fireEvent.pointerDown(box, { pointerType: "touch" });
    fireEvent.click(box);
    expect(vault.opened).toEqual([["b.md", undefined]]);
  });

  it("opens only the inner note on ctrl or cmd and a click inside a note embed", () => {
    const vault = fakeVault({ "b.md": "b\n\n![[c]]", "c.md": "body of c" });
    const view = stalled(() => mount(`${ABOVE}![[b]]`, plain(vault.source, ["b.md", "c.md"])));
    const inner = view.dom.querySelector(".cm-embed .cm-embed");
    expect(inner).not.toBeNull();

    fireEvent.mouseDown(inner as HTMLElement, { ctrlKey: true });
    fireEvent.mouseDown(inner as HTMLElement, { metaKey: true });

    expect(vault.opened).toEqual([
      ["c.md", undefined],
      ["c.md", undefined],
    ]);
  });

  it("opens only the inner note on a tap inside a note embed", () => {
    const vault = fakeVault({ "b.md": "![[c]]", "c.md": "body of c" });
    const view = mount(`${ABOVE}![[b]]`, plain(vault.source, ["b.md", "c.md"]));
    const inner = view.dom.querySelector(".cm-embed .cm-embed") as HTMLElement;

    fireEvent.pointerDown(inner, { pointerType: "touch" });
    fireEvent.click(inner);

    expect(vault.opened).toEqual([["c.md", undefined]]);
  });

  it("opens only the inner note on ctrl and a click inside a note embed, vim on", () => {
    const vault = fakeVault({ "b.md": "![[c]]", "c.md": "body of c" });
    const view = mount(`${ABOVE}![[b]]`, [
      vim(),
      livePreview(),
      vaultPaths.of(["b.md", "c.md"]),
      imagePaths.of([]),
      embedSource.of(vault.source),
    ]);
    const inner = view.dom.querySelector(".cm-embed .cm-embed") as HTMLElement;

    fireEvent.mouseDown(inner, { ctrlKey: true });

    expect(vault.opened).toEqual([["c.md", undefined]]);
  });

  it("still opens the outer note on ctrl and a click outside the inner one", () => {
    const vault = fakeVault({ "b.md": "above c\n\n![[c]]", "c.md": "body of c" });
    const view = mount(`${ABOVE}![[b]]`, plain(vault.source, ["b.md", "c.md"]));
    const outer = view.dom.querySelector(".cm-embed") as HTMLElement;

    fireEvent.mouseDown(outer, { ctrlKey: true });

    expect(vault.opened).toEqual([["b.md", undefined]]);
  });

  it("shows its source with the cursor on the line, vim off", () => {
    const vault = fakeVault({ "b.md": "body" });
    const view = mount(`${ABOVE}![[b]]`, plain(vault.source));
    expect(view.dom.querySelector(".cm-embed")).not.toBeNull();

    view.dispatch({ selection: EditorSelection.cursor(view.state.doc.length) });

    expect(view.dom.querySelector(".cm-embed")).toBeNull();
    expect(view.contentDOM.textContent).toContain("![[b]]");
  });

  it("shows the source of a line an edit moves the cursor onto, before the parse lands", () => {
    const doc = "intro\n\n**a**\nx";
    const view = mount(doc, plain(fakeVault({}).source), doc.length);
    expect(view.contentDOM.textContent).not.toContain("**a**");

    stalled(() =>
      view.dispatch({
        changes: { from: doc.length - 2, to: doc.length },
        selection: EditorSelection.cursor(doc.length - 2),
      }),
    );

    expect(view.contentDOM.textContent).toContain("**a**");
  });

  it("shows the source of a drawn range an edit cuts into, before the parse lands", () => {
    const view = mount("intro\n\n**a** and more", plain(fakeVault({}).source));

    stalled(() => view.dispatch({ changes: { from: 7, to: 8 } }));

    expect(view.contentDOM.textContent).toContain("*a**");
  });

  it("shows its source in insert mode on the line, vim on", async () => {
    const vault = fakeVault({ "b.md": "body" });
    const view = mount("![[b]]\nplain", [
      vim(),
      livePreview(),
      vaultPaths.of(["b.md"]),
      imagePaths.of([]),
      embedSource.of(vault.source),
    ]);
    expect(view.dom.querySelector(".cm-embed")).not.toBeNull();

    fireEvent.keyDown(view.contentDOM, { key: "i" });

    await waitFor(() => expect(view.contentDOM.textContent).toContain("![[b]]"));
    expect(view.dom.querySelector(".cm-embed")).toBeNull();
  });

  it("keeps the cursor out of the source it hides", () => {
    const vault = fakeVault({ "b.md": "body" });
    const view = mount(
      "![[b]]\nplain",
      [
        vim(),
        livePreview(),
        vaultPaths.of(["b.md"]),
        imagePaths.of([]),
        embedSource.of(vault.source),
      ],
      7,
    );

    view.dispatch({ selection: EditorSelection.cursor(2) });

    expect(view.state.selection.main.head).toBe("![[b]]".length);
  });

  it("stops at the depth cap where two notes embed each other", () => {
    const vault = fakeVault({ "a.md": "a\n\n![[b]]", "b.md": "b\n\n![[a]]" });
    const view = stalled(() => mount(`${ABOVE}![[a]]`, plain(vault.source, ["a.md", "b.md"])));

    expect([
      view.dom.querySelectorAll(".cm-embed").length,
      view.dom.querySelectorAll(".cm-embed-stub").length,
    ]).toEqual([EMBED_DEPTH, 1]);
  });

  it("stops at the depth cap where a note embeds itself", () => {
    const vault = fakeVault({ "a.md": "a\n\n![[a]]" });
    const view = stalled(() => mount(`${ABOVE}![[a]]`, plain(vault.source, ["a.md"])));

    expect([
      view.dom.querySelectorAll(".cm-embed").length,
      view.dom.querySelectorAll(".cm-embed-stub").length,
    ]).toEqual([EMBED_DEPTH, 1]);
  });

  it("stays its source where nobody said how to read the vault", () => {
    const view = mount(`${ABOVE}![[b]]`, plain(null));

    expect(view.contentDOM.textContent).toContain("![[b]]");
    expect(view.dom.querySelector(".cm-embed, .cm-embed-missing, .cm-embed-stub")).toBeNull();
  });

  it("stays its source until the vault listing lands", () => {
    const vault = fakeVault({ "x/b.md": "body" });
    const view = mount(`${ABOVE}![[b]]`, [
      vimKeys.of(false),
      livePreview(),
      embedSource.of(vault.source),
    ]);

    expect(view.contentDOM.textContent).toContain("![[b]]");
    expect(view.dom.querySelector(".cm-embed, .cm-embed-missing, .cm-embed-stub")).toBeNull();
    expect(vault.watched).toEqual([]);
  });

  it("stays its source until the image listing lands", () => {
    const vault = fakeVault({});
    const view = mount(`${ABOVE}![[shot.png]]`, [
      vimKeys.of(false),
      livePreview(),
      vaultPaths.of(["b.md"]),
      embedSource.of(vault.source),
    ]);

    expect(view.contentDOM.textContent).toContain("![[shot.png]]");
    expect(vault.watched).toEqual([]);
  });

  it("draws a note without waiting on the image listing", () => {
    const vault = fakeVault({ "b.md": "body" });
    const view = mount(`${ABOVE}![[b]]`, [
      vimKeys.of(false),
      livePreview(),
      vaultPaths.of(["b.md"]),
      embedSource.of(vault.source),
    ]);

    expect(view.dom.querySelector(".cm-embed")?.textContent).toBe("body");
  });

  it("draws the note read-only, rendered, and told what the vault holds", () => {
    const vault = fakeVault({ "b.md": "# B\nsee [[ghost]]" });
    const view = stalled(() => mount(`${ABOVE}![[b]]`, plain(vault.source)));
    const nested = view.dom.querySelector(".cm-embed .cm-content") as HTMLElement;
    expect(nested).not.toBeNull();

    expect({
      editable: nested.getAttribute("contenteditable"),
      text: nested.textContent,
      dead: nested.querySelector(".cm-wikilink-dead")?.textContent,
    }).toEqual({ editable: "false", text: "Bsee ghost", dead: "ghost" });
  });

  it("stops listening when it leaves the screen", () => {
    const vault = fakeVault({ "b.md": "body", "c.md": "other" });
    const view = mount(`${ABOVE}![[b]]`, plain(vault.source, ["b.md", "c.md"]));

    // A parse that runs out of time under load must not stop the embed's
    // listener from being dropped once the note is parsed.
    stalled(() =>
      view.dispatch({
        changes: { from: view.state.doc.length - 3, to: view.state.doc.length - 2, insert: "c" },
      }),
    );
    parsed(view);
    expect(vault.listening("b.md")).toBe(0);
    expect(vault.listening("c.md")).toBe(1);

    mounted.splice(mounted.indexOf(view), 1);
    view.destroy();
    expect(vault.listening("c.md")).toBe(0);
  });
});

describe("a csv embed", () => {
  const PATHS = ["b.md", "data/sales.csv"];
  const ATTACK = '<img src=x onerror="window.ran = 1">';
  const SCRIPT = "<script>window.ran = 2</script>";
  const serve = (body: string, status = 200) => {
    const fetched = vi.fn(async () => new Response(body, { status }));
    vi.stubGlobal("fetch", fetched);
    return fetched;
  };
  const box = (view: { dom: HTMLElement }) => view.dom.querySelector(".cm-embed") as HTMLElement;
  const drawn = (view: { dom: HTMLElement }) =>
    waitFor(() => expect(box(view).matches(":has(table), .cm-embed-missing")).toBe(true));

  afterEach(() => vi.unstubAllGlobals());

  it("draws the csv as a table, every cell as text, with vim on and off", async () => {
    for (const vimOn of [false, true]) {
      const fetched = serve(`name,note\nx,${ATTACK}\ny,${SCRIPT}\n`);
      const source = fakeVault({}).source;
      const view = mount(
        `${ABOVE}![[Sales.csv]]`,
        vimOn
          ? [vim(), livePreview(), vaultPaths.of(PATHS), imagePaths.of([]), embedSource.of(source)]
          : plain(source, PATHS),
      );
      await drawn(view);

      expect(fetched).toHaveBeenCalledWith("/api/assets/data/sales.csv", expect.anything());
      const cells = [...box(view).querySelectorAll("th, td")].map((cell) => cell.textContent);
      expect(cells).toEqual(["name", "note", "x", ATTACK, "y", SCRIPT]);
      expect(box(view).querySelectorAll("img, script")).toHaveLength(0);
      expect((window as { ran?: number }).ran).toBeUndefined();
      expect(view.dom.querySelector("img.cm-image")).toBeNull();
      expect(view.contentDOM.textContent).not.toContain("![[");
    }
  });

  it("says Not found for a csv the vault does not hold, or one that will not load", async () => {
    const fetched = serve("gone", 404);
    const missing = mount(`${ABOVE}![[gone.csv]]`, plain(fakeVault({}).source, PATHS));
    const failed = mount(`${ABOVE}![[sales.csv]]`, plain(fakeVault({}).source, PATHS));
    await drawn(failed);

    expect(box(missing).textContent).toBe("Not found: gone.csv");
    expect(box(failed).textContent).toBe("Not found: sales.csv");
    expect(fetched).toHaveBeenCalledTimes(1);
  });

  it("draws a short row with empty cells and says where it cut a long file", async () => {
    serve(`a,b,c\n1\n${"x,y,z\n".repeat(ROW_CAP + 10)}`);
    const view = mount(`${ABOVE}![[sales.csv]]`, plain(fakeVault({}).source, PATHS));
    await drawn(view);

    const rows = box(view).querySelectorAll("tr");
    expect(rows).toHaveLength(ROW_CAP);
    expect([...(rows[1]?.children ?? [])].map((cell) => cell.textContent)).toEqual(["1", "", ""]);
    expect(box(view).querySelector(".cm-csv-cut")?.textContent).toBe(
      `Showing ${ROW_CAP} of ${ROW_CAP + 12} rows.`,
    );
  });

  it("reads no more than 1 MiB, and drops the row the cut lands in", async () => {
    // Ten whole rows of 100 kB fit under the cap beside the head; the eleventh is cut inside.
    serve(`h\n${`${"x".repeat(99_999)}\n`.repeat(12)}`);
    const view = mount(`${ABOVE}![[sales.csv]]`, plain(fakeVault({}).source, PATHS));
    await drawn(view);

    expect(box(view).querySelectorAll("td")).toHaveLength(10);
    expect(box(view).querySelector("td")?.textContent).toHaveLength(99_999);
    expect(box(view).querySelector(".cm-csv-cut")?.textContent).toBe(
      "Showing the first 11 rows: the file runs past 1 MiB.",
    );
    expect(BYTE_CAP).toBe(1024 * 1024);
  });
});
