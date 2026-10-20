import type { Extension } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { vim } from "@replit/codemirror-vim";
import { act, render } from "@testing-library/react";
import { NotePreview } from "@/components/note-preview";
import { imagePaths } from "@/lib/image";
import { livePreview } from "@/lib/live-preview";
import { vaultPaths } from "@/lib/wikilink";
import { liveHooks, mount, plain } from "./live-preview-fixture";

liveHooks();

describe("an escape in a table cell (#512)", () => {
  /** A line above the table, so the cursor at offset zero is off it. */
  function table(...rows: string[]): string {
    return ["intro", "", ...rows].join("\n");
  }

  function lit(vimOn: boolean): Extension[] {
    return vimOn ? [vim(), livePreview(), vaultPaths.of([]), imagePaths.of([])] : plain(null);
  }

  function cells(view: EditorView): HTMLElement[] {
    return [...view.dom.querySelectorAll<HTMLElement>(".cm-table-grid tbody td")];
  }

  /** The cursor put in the cell holding `source`, which the table then shows as written. */
  function expectSourceInCell(view: EditorView, doc: string, source: string): void {
    act(() => view.dispatch({ selection: { anchor: doc.indexOf(source) } }));
    expect(view.dom.querySelector(".cm-table-grid")).toBeNull();
    expect(view.contentDOM.textContent).toContain(source);
  }

  const MODES = [
    ["vim off", false],
    ["vim on", true],
  ] as const;

  // Named in words, as `-t` reads a test's name as a pattern.
  const ESCAPES = [
    ["star", "\\*", "*"],
    ["underscore", "\\_", "_"],
    ["bracket", "\\[", "["],
  ] as const;

  it.each(MODES.map(([mode, vimOn]) => ["A1", mode, vimOn] as const))(
    "%s draws an escaped bar in a cell as the bar alone, %s",
    (_, __, vimOn) => {
      const doc = table("| h |", "| - |", "| a \\| b |");
      const view = mount(doc, lit(vimOn));

      expect(cells(view)[0]?.textContent).toBe("a | b");
      expectSourceInCell(view, doc, "a \\| b");
    },
  );

  it.each(MODES.map(([mode, vimOn]) => ["A2", mode, vimOn] as const))(
    "%s draws an escaped bar in bold in a cell as bold text with the bar alone, %s",
    (_, __, vimOn) => {
      const doc = table("| h |", "| - |", "| **a \\| b** |");
      const view = mount(doc, lit(vimOn));

      const [cell] = cells(view);
      expect(
        [...(cell?.querySelectorAll(".cm-strong") ?? [])].map((s) => s.textContent).join(""),
      ).toBe("a | b");
      expect(cell?.textContent).toBe("a | b");
      expectSourceInCell(view, doc, "**a \\| b**");
    },
  );

  it.each(
    ESCAPES.flatMap(([name, written, char]) =>
      MODES.map(([mode, vimOn]) => ["A3", name, mode, written, char, vimOn] as const),
    ),
  )(
    "%s draws an escaped %s in a cell as the character alone, %s",
    (_, __, ___, written, char, vimOn) => {
      const doc = table("| h |", "| - |", `| a ${written} b |`);
      const view = mount(doc, lit(vimOn));

      expect(cells(view)[0]?.textContent).toBe(`a ${char} b`);
      expectSourceInCell(view, doc, `a ${written} b`);
    },
  );

  // A guard: off a table an escape already showed its character alone.
  it.each(
    [...ESCAPES, ["bar", "\\|", "|"] as const].flatMap(([name, written, char]) =>
      MODES.map(([mode, vimOn]) => ["A4", name, mode, written, char, vimOn] as const),
    ),
  )(
    "%s guard: draws an escaped %s on a plain line as the character alone, %s",
    (_, __, ___, written, char, vimOn) => {
      const view = mount(`intro\n\na ${written} b`, lit(vimOn));

      expect([...view.contentDOM.querySelectorAll(".cm-line")].at(-1)?.textContent).toBe(
        `a ${char} b`,
      );
    },
  );

  it.each(MODES.map(([mode, vimOn]) => ["I1", mode, vimOn] as const))(
    "%s draws an escaped backslash in a cell as one backslash, %s",
    (_, __, vimOn) => {
      const view = mount(table("| h |", "| - |", "| a \\\\ b |"), lit(vimOn));

      expect(cells(view)[0]?.textContent).toBe("a \\ b");
    },
  );

  it.each(MODES.map(([mode, vimOn]) => ["I2", mode, vimOn] as const))(
    "%s draws an escape inside link text and emphasis in a cell as the character alone, %s",
    (_, __, vimOn) => {
      const view = mount(
        table("| h | i |", "| - | - |", "| [a \\* b](https://x.y) | *a \\_ b* |"),
        lit(vimOn),
      );

      // An escape cuts the run into spans, each wearing the class.
      const worn = (cell: HTMLElement | undefined, selector: string) =>
        [...(cell?.querySelectorAll(selector) ?? [])].map((s) => s.textContent).join("");
      const [link, soft] = cells(view);
      expect(worn(link, ".cm-link")).toBe("a * b");
      expect(worn(soft, ".cm-emphasis")).toBe("a _ b");
    },
  );

  it("I3 draws an escaped bar in a cell of a reading pane as the bar alone", () => {
    const { container } = render(<NotePreview text={"| h |\n| - |\n| a \\| b |"} />);

    expect(container.querySelector(".cm-table-grid tbody td")?.textContent).toBe("a | b");
  });
});

describe("an escaped bar in a code span in a table cell (#515)", () => {
  /** A line above the table, so the cursor at offset zero is off it. */
  function table(...rows: string[]): string {
    return ["intro", "", ...rows].join("\n");
  }

  function lit(vimOn: boolean): Extension[] {
    return vimOn ? [vim(), livePreview(), vaultPaths.of([]), imagePaths.of([])] : plain(null);
  }

  function cell(view: EditorView): HTMLElement | null {
    return view.dom.querySelector<HTMLElement>(".cm-table-grid tbody td");
  }

  const MODES = [
    ["vim off", false],
    ["vim on", true],
  ] as const;

  it.each(MODES.map(([mode, vimOn]) => ["A5", mode, vimOn] as const))(
    "%s draws an escaped bar in a code span in a cell as the bar alone, %s",
    (_, __, vimOn) => {
      const view = mount(table("| h |", "| - |", "| `a \\| b` |"), lit(vimOn));

      expect(cell(view)?.querySelector(".cm-inline-code")?.textContent).toBe("a | b");
      expect(cell(view)?.textContent).toBe("a | b");
    },
  );

  it("I5 guard: draws an escaped bar beside a code span in a cell as the bar alone", () => {
    const view = mount(table("| h |", "| - |", "| a \\| `b` |"), plain(null));

    expect(cell(view)?.textContent).toBe("a | b");
  });

  it("I5 guard: keeps the backslash of an escaped bar in a code span on a plain line", () => {
    const view = mount("intro\n\nx `a \\| b` y", plain(null));

    expect([...view.contentDOM.querySelectorAll(".cm-line")].at(-1)?.textContent).toContain(
      "a \\| b",
    );
  });

  it("I5 keeps any other escape in a code span in a cell as written", () => {
    const view = mount(table("| h |", "| - |", "| `a\\b` |"), plain(null));

    expect(cell(view)?.textContent).toBe("a\\b");
  });

  it.each(MODES.map(([mode, vimOn]) => ["I6", mode, vimOn] as const))(
    "%s guard: shows an escaped bar in a code span as written with the cursor in the table, %s",
    (_, __, vimOn) => {
      const doc = table("| h |", "| - |", "| `a \\| b` |");
      const view = mount(doc, lit(vimOn));

      act(() => view.dispatch({ selection: { anchor: doc.indexOf("a \\|") } }));
      expect(view.dom.querySelector(".cm-table-grid")).toBeNull();
      expect(view.state.doc.toString()).toBe(doc);
      expect([...view.contentDOM.querySelectorAll(".cm-line")].at(-1)?.textContent).toBe(
        "| `a \\| b` |",
      );
    },
  );
});
