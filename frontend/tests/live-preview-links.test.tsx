import { fireEvent, waitFor } from "@testing-library/react";
import { Editor } from "@/components/editor";
import { content, liveHooks, renderEditor } from "./live-preview-fixture";

liveHooks();

describe("live preview", () => {
  it("renders a link as its text alone", () => {
    const { container } = renderEditor(
      <Editor initialDoc="see [the docs](https://example.com) now" />,
    );

    expect(content(container)).toBe("see the docs now");
  });

  it("reveals the whole link with the cursor in it in insert mode", async () => {
    const { container } = renderEditor(
      <Editor initialDoc="see [the docs](https://example.com) now" />,
    );
    const editor = container.querySelector(".cm-content") as HTMLElement;

    // `w` off the first word lands on the link's `[`, which is hidden, so the
    // cursor settles on the first character of its text.
    fireEvent.keyDown(editor, { key: "w" });
    fireEvent.keyDown(editor, { key: "i" });

    await waitFor(() => expect(content(container)).toBe("see [the docs](https://example.com) now"));
  });

  // The parser reads every `[text]` with no `(url)` as a link (#434, #435).
  // The line above keeps the cursor off the line under test.
  it.each([
    [
      "A8 a [!note] under a plain quote line",
      "> plain\n> [!note] not a callout",
      "[!note] not a callout",
    ],
    ["A9 a [text] on a quote line", "> see [text] here", "see [text] here"],
    ["I1 a [text] on a plain line", "see [text] here", "see [text] here"],
    ["I1 a [text][ref] full reference", "see [text][ref] here", "see [text][ref] here"],
  ])("keeps the brackets of %s", (_, doc, shown) => {
    const { container } = renderEditor(<Editor initialDoc={`intro\n\n${doc}`} />);

    expect(content(container)).toContain(shown);
    expect(container.querySelector(".cm-link")).toBeNull();
  });

  it("I1 keeps the brackets of a [text] in a table cell", () => {
    const lines = ["before", "", "| a |", "| - |", "| [text] |"];
    const { container } = renderEditor(<Editor initialDoc={lines.join("\n")} />);

    const table = container.querySelector(".cm-table-grid") as HTMLTableElement;
    expect(table.querySelector("tbody td")?.textContent).toBe("[text]");
    expect(table.querySelector(".cm-link")).toBeNull();
  });

  it("B1 [a]() draws as a link, its marks hidden, in prose and in a cell", () => {
    // CommonMark reads empty parens as a link with an empty address.
    const lines = ["intro", "", "see [a]() here", "", "| x |", "| - |", "| [b]() |"];
    const { container } = renderEditor(<Editor initialDoc={lines.join("\n")} />);

    expect(content(container)).toContain("see a here");
    expect(container.querySelector(".cm-line .cm-link")?.textContent).toBe("a");
    expect(container.querySelector(".cm-table-grid tbody .cm-link")?.textContent).toBe("b");
  });

  it("I3 draws a [text](url) link as its text in cm-link, as before", () => {
    const { container } = renderEditor(
      <Editor initialDoc={"intro\n\n> see [the docs](https://example.com) now"} />,
    );

    expect(content(container)).toContain("see the docs now");
    expect(container.querySelector(".cm-link")?.textContent).toBe("the docs");
  });

  it("renders a wikilink as the note it names", () => {
    const { container } = renderEditor(<Editor initialDoc="see [[reading/borges]] now" />);

    expect(content(container)).toBe("see reading/borges now");
    expect(container.querySelector(".cm-wikilink")?.textContent).toBe("reading/borges");
  });

  it("reveals the brackets with the cursor in the wikilink in insert mode", async () => {
    const { container } = renderEditor(<Editor initialDoc="see [[borges]] now" />);
    const editor = container.querySelector(".cm-content") as HTMLElement;

    fireEvent.keyDown(editor, { key: "w" });
    fireEvent.keyDown(editor, { key: "i" });

    await waitFor(() => expect(content(container)).toBe("see [[borges]] now"));
  });

  it("marks a link to a note the vault does not hold", () => {
    const { container } = renderEditor(
      <Editor initialDoc="[[borges]] and [[ficciones]]" paths={["reading/borges.md"]} />,
    );

    expect(container.querySelectorAll(".cm-wikilink")).toHaveLength(2);
    expect(container.querySelector(".cm-wikilink-dead")?.textContent).toBe("ficciones");
  });

  it("marks nothing dead where the vault is not known, as in a preview pane", () => {
    // No listing is not an empty listing: a view that was told nothing must not
    // call every link in the note broken.
    const { container } = renderEditor(<Editor initialDoc="[[borges]]" />);

    expect(container.querySelector(".cm-wikilink")).not.toBeNull();
    expect(container.querySelector(".cm-wikilink-dead")).toBeNull();
  });

  it("draws a link with an alias as the alias", () => {
    const { container } = renderEditor(
      <Editor
        initialDoc="see [[reading/borges#The Aleph|the story]] now"
        paths={["reading/borges.md"]}
      />,
    );

    expect(content(container)).toBe("see the story now");
    expect(container.querySelector(".cm-wikilink")?.textContent).toBe("the story");
    expect(container.querySelector(".cm-wikilink-dead")).toBeNull();
  });

  it("draws a link to a heading of its own note as alive", () => {
    const { container } = renderEditor(<Editor initialDoc="see [[#The Aleph]]" paths={["a.md"]} />);

    expect(container.querySelector(".cm-wikilink")?.textContent).toBe("#The Aleph");
    expect(container.querySelector(".cm-wikilink-dead")).toBeNull();
  });

  it("marks an alias dead by the note behind it", () => {
    const { container } = renderEditor(
      <Editor initialDoc="[[borges|Jorge]] and [[cortazar|Julio]]" paths={["borges.md"]} />,
    );

    expect(container.querySelector(".cm-wikilink-dead")?.textContent).toBe("Julio");
  });

  it("shows the whole link again with the cursor in it in insert mode", async () => {
    const { container } = renderEditor(<Editor initialDoc="see [[borges|Jorge]] now" />);
    const editor = container.querySelector(".cm-content") as HTMLElement;

    fireEvent.keyDown(editor, { key: "w" });
    fireEvent.keyDown(editor, { key: "i" });

    await waitFor(() => expect(content(container)).toBe("see [[borges|Jorge]] now"));
  });

  it("brings a link back to life when the note it names arrives", () => {
    const { container, rerender } = renderEditor(<Editor initialDoc="[[borges]]" paths={[]} />);
    expect(container.querySelector(".cm-wikilink-dead")).not.toBeNull();

    rerender(<Editor initialDoc="[[borges]]" paths={["borges.md"]} />);

    expect(container.querySelector(".cm-wikilink-dead")).toBeNull();
  });

  // The three below read the class rather than the text: markdown's own
  // shortcut reference link claims a `[bracketed]` run whatever is in it, and
  // hiding those brackets is what this file has always done. What is being
  // asked here is only whether a wikilink opened, and none of the three is one.
  it("makes no wikilink of a bracket pair with no note in it", () => {
    const { container } = renderEditor(<Editor initialDoc="[[]] and [[ ]]" />);

    expect(container.querySelector(".cm-wikilink")).toBeNull();
  });

  it("leaves an unclosed wikilink alone", () => {
    const { container } = renderEditor(<Editor initialDoc="[[borges and more" />);

    expect(content(container)).toBe("[[borges and more");
  });

  it("does not carry a wikilink across a line break", () => {
    const { container } = renderEditor(<Editor initialDoc={"[[borges\nand]] more"} />);

    expect(container.querySelector(".cm-wikilink")).toBeNull();
  });

  it("labels the name in front of a relation", () => {
    const { container } = renderEditor(<Editor initialDoc="depends-on:: [[borges]]" />);

    expect(container.querySelector(".cm-relation")?.textContent).toBe("depends-on::");
  });

  it("draws the relation's target as it draws any other wikilink", () => {
    const { container } = renderEditor(<Editor initialDoc="depends-on:: [[borges]]" />);

    expect(container.querySelector(".cm-wikilink")?.textContent).toBe("borges");
    expect(content(container)).toBe("depends-on:: borges");
  });

  it("labels nothing on a line that is not a relation", () => {
    const { container } = renderEditor(<Editor initialDoc="see [[borges]] and [[ficciones]]" />);

    expect(container.querySelector(".cm-relation")).toBeNull();
  });
});
