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

  it("#792 A4 a numeric column is right-aligned with its head, a word column is not", () => {
    // The price column holds a currency, a sign, a thousands separator and a
    // decimal comma, and its empty cell does not count against it.
    const lines = [
      "before",
      "",
      "| item | qty | price |",
      "| --- | --- | --- |",
      "| WH-07 | 10 | $2.50 |",
      "| tea | -3 |  |",
      "| cake | +1,200 | 4,00 € |",
    ];
    const { container } = renderEditor(<Editor initialDoc={lines.join("\n")} />);

    const table = container.querySelector(".cm-table-grid") as HTMLTableElement;
    expect([...table.querySelectorAll("th")].map((cell) => cell.style.textAlign)).toEqual([
      "",
      "right",
      "right",
    ]);
    const [first] = table.querySelectorAll("tbody tr");
    const [item, qty] = (first as HTMLTableRowElement).querySelectorAll("td");
    expect(qty?.classList.contains("cm-table-numeric")).toBe(true);
    expect(qty?.style.textAlign).toBe("right");
    expect(item?.classList.contains("cm-table-numeric")).toBe(false);
  });

  it("#792 A4 a colon in the dashes wins over the detection", () => {
    // The `:--` says left, so the numbers under it keep their side.
    const lines = ["before", "", "| a | b |", "| :-- | --- |", "| 1 | 2 |"];
    const { container } = renderEditor(<Editor initialDoc={lines.join("\n")} />);

    const table = container.querySelector(".cm-table-grid") as HTMLTableElement;
    const [left, detected] = table.querySelectorAll("th");
    expect(left?.style.textAlign).toBe("left");
    expect(detected?.style.textAlign).toBe("right");
  });

  it("#792 A5 an empty body cell is marked empty and holds no dash in its text", () => {
    const lines = ["before", "", "| a | b | c |", "| - | - | - |", "| 1 |  | 3 |"];
    const { container } = renderEditor(<Editor initialDoc={lines.join("\n")} />);

    const table = container.querySelector(".cm-table-grid") as HTMLTableElement;
    const [, empty] = table.querySelectorAll("tbody td");
    expect(empty?.classList.contains("cm-table-empty")).toBe(true);
    expect(empty?.textContent).toBe("");
    expect(table.querySelectorAll(".cm-table-empty")).toHaveLength(1);
    expect(content(container)).not.toContain("‒");
  });

  it("#792 A5 a cell of a typed dash is drawn muted", () => {
    // The dash is text the writer typed, so it stays as written. Only its colour
    // is the empty cell's, through the class.
    const lines = ["before", "", "| a | b | c |", "| - | - | - |", "| 1 | - | – |"];
    const { container } = renderEditor(<Editor initialDoc={lines.join("\n")} />);

    const table = container.querySelector(".cm-table-grid") as HTMLTableElement;
    const [number, dash, figure] = table.querySelectorAll("tbody td");
    expect(dash?.classList.contains("cm-table-blank")).toBe(true);
    expect(dash?.textContent).toBe("-");
    expect(figure?.classList.contains("cm-table-blank")).toBe(true);
    expect(number?.classList.contains("cm-table-blank")).toBe(false);
  });

  it("#792 A6 a code-like cell is marked code, a word and a date are not", () => {
    const lines = [
      "before",
      "",
      "| id | name | day |",
      "| --- | --- | --- |",
      "| WH-07 | tea | 2026-10-24 |",
      "| `a1b2` | us-east-1 | 2026-10-25 |",
    ];
    const { container } = renderEditor(<Editor initialDoc={lines.join("\n")} />);

    const table = container.querySelector(".cm-table-grid") as HTMLTableElement;
    const [first, second] = [...table.querySelectorAll("tbody tr")].map((row) =>
      row.querySelectorAll("td"),
    );
    expect(first?.[0]?.classList.contains("cm-table-code")).toBe(true);
    expect(first?.[1]?.classList.contains("cm-table-code")).toBe(false);
    expect(first?.[2]?.classList.contains("cm-table-code")).toBe(false);
    expect(second?.[0]?.classList.contains("cm-table-code")).toBe(true);
    expect(second?.[1]?.classList.contains("cm-table-code")).toBe(true);
    expect(second?.[2]?.classList.contains("cm-table-code")).toBe(false);
  });

  it("#792 A7 a caption under the table is drawn as a caption, its prefix hidden", () => {
    // The caption is a row the parser swallows, so the table is drawn and the
    // line after it is the caption, with `Table: ` off the screen.
    const lines = ["before", "", "| a | b |", "| - | - |", "| 1 | 2 |", "Table: Totals in euros"];
    const { container } = renderEditor(<Editor initialDoc={lines.join("\n")} />);

    const caption = container.querySelector(".cm-table-caption");
    expect(caption?.textContent).toBe("Totals in euros");
    expect(content(container)).not.toContain("Table: ");
  });
});
