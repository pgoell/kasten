import { fireEvent, waitFor } from "@testing-library/react";
import { Editor } from "@/components/editor";
import { content, liveHooks, renderEditor } from "./live-preview-fixture";

liveHooks();

describe("live preview", () => {
  it("hides a fence's backticks and language, code and all", () => {
    const lines = ["```js", "const x = 1;", "```"];
    const { container } = renderEditor(<Editor initialDoc={lines.join("\n")} />);

    expect(content(container)).toBe("const x = 1;");
  });

  it("hands the backticks back with the cursor in the block", async () => {
    // The whole block rather than the cursor's line, which is how every other
    // construct here works: a hidden fence line is a line the cursor cannot
    // reach, so a rule waiting for it there would never fire.
    const lines = ["```js", "const x = 1;", "```"];
    const { container } = renderEditor(<Editor initialDoc={lines.join("\n")} />);

    fireEvent.keyDown(container.querySelector(".cm-content") as HTMLElement, { key: "i" });

    await waitFor(() => expect(content(container)).toBe(lines.join("")));
  });

  it("keeps the backticks of a fence with no code in it", () => {
    // Hiding both would leave no line on the screen to put the cursor back on,
    // and the block a third backtick writes starts out empty.
    const { container } = renderEditor(<Editor initialDoc={"```\n```"} />);

    expect(content(container)).toBe("``````");
    // Knocked back off the code, the way a revealed fence is.
    expect(container.querySelectorAll(".cm-code-fence")).toHaveLength(2);
  });

  it("keeps the backticks of an unclosed fence", () => {
    const { container } = renderEditor(<Editor initialDoc={"```js\nconst x = 1;"} />);

    expect(content(container)).toContain("```js");
  });

  it("draws a fenced block as one surface, top and bottom marked", () => {
    const lines = ["before", "```js", "const x = 1;", "const y = 2;", "```", "after"];
    const { container } = renderEditor(<Editor initialDoc={lines.join("\n")} />);

    // Two rows on the screen, each backtick line having fallen into the line
    // of code beside it.
    expect(container.querySelectorAll(".cm-code-block")).toHaveLength(2);
    // The corners are rounded on the outside only, so the run reads as a box.
    expect(container.querySelectorAll(".cm-code-open")).toHaveLength(1);
    expect(container.querySelectorAll(".cm-code-close")).toHaveLength(1);
  });

  it("draws a divider in place of the three dashes", () => {
    const { container } = renderEditor(<Editor initialDoc={"above\n\n---\n\nbelow"} />);

    expect(container.querySelectorAll(".cm-rule")).toHaveLength(1);
    // Drawn rather than typed, so the dashes themselves are off the screen.
    expect(content(container)).toBe("abovebelow");
  });

  it("hands the dashes back on the line being edited", async () => {
    const { container } = renderEditor(<Editor initialDoc={"---\n\nbelow"} />);

    fireEvent.keyDown(container.querySelector(".cm-content") as HTMLElement, { key: "i" });

    // The drawn line goes with them, or the row carries a rule and its source.
    await waitFor(() => expect(content(container)).toContain("---"));
    expect(container.querySelectorAll(".cm-rule")).toHaveLength(0);
  });

  it("leaves a setext underline alone, that being a heading and not a rule", () => {
    const { container } = renderEditor(<Editor initialDoc={"Title\n---\n\nbody"} />);

    expect(container.querySelectorAll(".cm-rule")).toHaveLength(0);
  });

  it("leaves prose outside the fence alone", () => {
    const { container } = renderEditor(<Editor initialDoc={"prose\n```\ncode\n```"} />);
    const first = container.querySelector(".cm-line");

    expect(first?.textContent).toBe("prose");
    expect(first?.classList.contains("cm-code-block")).toBe(false);
  });

  it("leaves a note's frontmatter on screen instead of reading it as markdown", () => {
    // Without a parser for the block, the opening fence is a horizontal rule
    // and the closing one underlines the fields above it into a heading: every
    // note in the vault would open on three lines of dates drawn as a title.
    const { container } = renderEditor(<Editor initialDoc={"---\nid: 1\n---\n# Notes"} />);

    expect(content(container)).toBe("---id: 1---Notes");
  });
});
