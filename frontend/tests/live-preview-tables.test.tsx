import { render, waitFor } from "@testing-library/react";
import { Editor } from "@/components/editor";
import { NotePreview } from "@/components/note-preview";
import { content, liveHooks, renderEditor } from "./live-preview-fixture";

liveHooks();

describe("live preview", () => {
  it("draws a table as a table, alignment and cell marks included", () => {
    // A line above it, the cursor starting at the top of the note and a cursor
    // in a table being what shows its source.
    const lines = ["before", "", "| a | **b** | c |", "| :-- | :-: | --: |", "| 1 |  | 3 |"];
    const { container } = renderEditor(<Editor initialDoc={lines.join("\n")} />);

    const table = container.querySelector(".cm-table-grid") as HTMLTableElement;
    expect(table).not.toBeNull();
    expect(table.querySelectorAll("th")).toHaveLength(3);
    // The middle body cell is empty and carries no node of its own, so a row
    // read off its cells rather than its walls would lose the column.
    const body = [...table.querySelectorAll("tbody td")].map((cell) => cell.textContent);
    expect(body).toEqual(["1", "", "3"]);
    expect(table.querySelector(".cm-strong")?.textContent).toBe("b");
    expect([...table.querySelectorAll("th")].map((cell) => cell.style.textAlign)).toEqual([
      "left",
      "center",
      "right",
    ]);
    // No pipe anywhere: the source is off the screen, widget and all.
    expect(content(container)).not.toContain("|");
  });

  it("draws a link with an alias in a cell as the alias", () => {
    // A bare bar would end the cell, so a table escapes it, as Obsidian does.
    const lines = ["before", "", "| who |", "| --- |", "| [[borges#Life\\|Jorge]] |"];
    const { container } = renderEditor(
      <Editor initialDoc={lines.join("\n")} paths={["borges.md"]} />,
    );

    const table = container.querySelector(".cm-table-grid") as HTMLTableElement;
    expect(table.querySelector("tbody .cm-wikilink")?.textContent).toBe("Jorge");
    expect(table.querySelector(".cm-wikilink-dead")).toBeNull();
  });

  it("leaves the prose under a table out of it", () => {
    // GFM ends a table at a blank line, so a paragraph written straight under
    // one parses as rows of a single cell. The cursor starts on line one, so
    // the table is drawn only when the prose is not part of it.
    const lines = ["| a | b |", "| - | - |", "| 1 | 2 |", "after the table `code`"];
    const { container } = render(<NotePreview text={lines.join("\n")} />);

    const table = container.querySelector(".cm-table-grid") as HTMLTableElement;
    expect(table).not.toBeNull();
    expect(table.querySelectorAll("tbody tr")).toHaveLength(1);
    expect(table.textContent).not.toContain("after the table");
    expect(content(container)).toContain("after the table");
    // The prose is still prose, marks hidden and inline code drawn.
    expect(content(container)).not.toContain("`");
    expect(container.querySelector(".cm-inline-code")?.textContent).toBe("code");
  });

  it("shows a table's source when the cursor is in it, whatever the mode", async () => {
    // The cursor starts at offset zero, which is inside a note that is nothing
    // but a table, so this one is revealed from the first render and in normal
    // mode. `j` and `k` step over the widget, so waiting for insert mode would
    // leave a table nothing could open.
    const lines = ["| a | b |", "| - | - |", "| 1 | 2 |"];
    const { container } = renderEditor(<Editor initialDoc={lines.join("\n")} />);

    await waitFor(() => expect(content(container)).toContain("| a | b |"));
    expect(container.querySelector(".cm-table-grid")).toBeNull();
    expect(container.querySelectorAll(".cm-table")).toHaveLength(3);
  });

  it("draws a table in a pane with no cursor in it", () => {
    // The preview panes mount the same rendering read-only. Their selection
    // sits at offset zero because nothing has moved it, and a note that opens
    // with a table would otherwise be a pane full of pipes.
    const lines = ["| a | b |", "| - | - |", "| 1 | 2 |"];
    const { container } = render(<NotePreview text={lines.join("\n")} />);

    expect(container.querySelector(".cm-table-grid")).not.toBeNull();
    expect(content(container)).not.toContain("|");
  });
});
