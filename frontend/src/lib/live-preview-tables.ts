import type { EditorState } from "@codemirror/state";
import { Decoration, type EditorView, WidgetType } from "@codemirror/view";
import type { SyntaxNode } from "@lezer/common";
import { isBlockRevealed, type Walk } from "@/lib/live-preview-hidden";
import { pictureElement } from "@/lib/live-preview-images";
import { rowSpans, type Span } from "@/lib/live-preview-table-cells";
import { repeats } from "@/lib/presses";
import { type Align, alignsOf, isRow } from "@/lib/table";

/**
 * A table, drawn as a table.
 *
 * The cells arrive cut into spans rather than as source, because cutting them
 * is a reading of the syntax tree and a widget has only the DOM. The classes
 * are the ones the inline walk hands out, so a bold cell and a bold word in a
 * paragraph come out the same weight.
 */
class TableGrid extends WidgetType {
  private readonly rows: Span[][][];
  private readonly aligns: Align[];
  /** What `eq` compares, the rows being a fresh array on every build. */
  private readonly key: string;

  constructor(rows: Span[][][], aligns: Align[]) {
    super();
    this.rows = rows;
    this.aligns = aligns;
    this.key = JSON.stringify([rows, aligns]);
  }

  override eq(other: TableGrid): boolean {
    return other.key === this.key;
  }

  /**
   * A click in the table puts the cursor in it, which is what shows the source.
   *
   * The default is to swallow the event, and swallowing it here would leave the
   * mouse no way in. The keys have `w`, a search and a line jump, all of which
   * move by document position; `j` and `k` move by what is on the screen and
   * step over the whole block, which is the fast way past a long table.
   *
   * A wide table's block scrolls sideways with no scrollbar to press on, the
   * stylesheet hiding every one, so no press here is the browser's to keep.
   */
  override ignoreEvent(): boolean {
    return false;
  }

  toDOM(view: EditorView): HTMLElement {
    // A block widget is measured by the box it hands back, and a margin sits
    // outside that box, so the space above and below the table is padding on a
    // wrapper. A margin on the table would leave the gutter counting lines
    // against a height that is short by it.
    const block = document.createElement("div");
    block.className = "cm-table-block";
    // A press in a cell follows a link where it would outside a table (#561): a
    // tap on the link's text or picture, ctrl+click on its text, any click on
    // its picture. `posAtDOM` lands on the block's edge, so the editor's own
    // tap and ctrl+click turn away from a link in a cell, and a press followed
    // here is kept from them.
    let tapped = false;
    // A wikilink is the exception: the editor follows it itself, off the
    // cell's `data-target` (#564), so a tap or ctrl+click on one is left to
    // reach the editor and only kept from opening the table.
    const linked = (event: MouseEvent): boolean =>
      event.target instanceof Element &&
      event.target.closest("[data-target]") !== null &&
      (tapped || event.ctrlKey || event.metaKey);
    // The press's answer, kept for its click: ctrl let go between the two
    // would otherwise open the table under the note just followed.
    let leftToEditor = false;
    const follows = (event: MouseEvent): string | null => {
      const target =
        event.target instanceof Element ? event.target.closest("[data-address]") : null;
      if (!(target instanceof HTMLElement) || target.dataset.address === undefined) return null;
      // A wikilink inside the link wins, as off a table, where the editor
      // reads the wikilink first.
      if (linked(event)) return null;
      const always = tapped || target instanceof HTMLImageElement;
      return always || event.ctrlKey || event.metaKey ? target.dataset.address : null;
    };
    // A finger the browser takes for a scroll cancels instead, and must not
    // leave the next click armed.
    block.addEventListener("pointerdown", (event) => {
      tapped = event.pointerType === "touch";
    });
    block.addEventListener("pointercancel", () => {
      tapped = false;
    });
    // CodeMirror moves the cursor in on a mouse's press, which redraws the
    // table as source and takes this block off the page before the click. A
    // press that follows is kept from it, so the follow happens at the click,
    // where a double-click's second is a repeat and opens no second tab.
    block.addEventListener("mousedown", (event) => {
      // A finger's press would leave the browser to put the caret at the
      // block's edge, which opens the table under the wikilink it follows.
      // Kept from that, it moves no focus either, and the note opens off the
      // focused pane (#361), so this one takes the focus first.
      leftToEditor = linked(event);
      if (tapped && leftToEditor) {
        view.focus();
        event.preventDefault();
        return;
      }
      if (follows(event) === null) return;
      event.preventDefault();
      event.stopPropagation();
    });
    // Anything else opens the table. CodeMirror leaves a touch to the
    // selection the browser makes, and the browser makes none on a picture,
    // so a finger on one would leave the table shut. A mouse got there on its
    // press, and the block is gone by the click.
    block.addEventListener("click", (event) => {
      const address = follows(event);
      const wikilink = leftToEditor || linked(event);
      leftToEditor = false;
      tapped = false;
      if (!block.isConnected || wikilink) return;
      if (address === null) {
        view.dispatch({ selection: { anchor: view.posAtDOM(block) } });
        return;
      }
      event.stopPropagation();
      // A click with `detail` 2 is a repeat only when the press before it
      // followed the same address, as on the picture's own click (#572).
      if (!repeats(event, address)) window.open(address, "_blank", "noopener");
    });
    const table = block.appendChild(document.createElement("table"));
    table.className = "cm-table-grid";
    const head = table.createTHead();
    const body = table.createTBody();

    this.rows.forEach((cells, index) => {
      const row = (index === 0 ? head : body).insertRow();
      cells.forEach((spans, column) => {
        const cell = row.appendChild(document.createElement(index === 0 ? "th" : "td"));
        const align = this.aligns[column] ?? "none";
        if (align !== "none") cell.style.textAlign = align;
        for (const span of spans) {
          if (span.image) {
            const image = cell.appendChild(pictureElement(view, span.image));
            if (span.address !== undefined) image.dataset.address = span.address;
            continue;
          }
          if (span.class === null) {
            cell.append(span.text);
            continue;
          }
          const marked = document.createElement("span");
          marked.className = span.class;
          marked.textContent = span.text;
          if (span.address !== undefined) marked.dataset.address = span.address;
          if (span.target !== undefined) marked.dataset.target = span.target;
          cell.append(marked);
        }
      });
    });
    return block;
  }
}

/**
 * Where the table stops, which is not always where the parser says it does.
 *
 * GFM ends a table at a blank line, so a paragraph written straight under one
 * is parsed as a row of a single cell. A row is a line carrying a `|`, the same
 * reading `tableAt` walks a table by, and the first line without one ends it.
 */
function tableEndsAt(state: EditorState, table: SyntaxNode): number {
  const first = state.doc.lineAt(table.from).number;
  const last = state.doc.lineAt(table.to).number;
  let number = first;
  while (number < last && isRow(state.doc.line(number + 1).text)) number++;
  return state.doc.line(number).to;
}

/** A `Table` node read into the shape the widget draws, up to where it ends. */
function tableGrid(state: EditorState, table: SyntaxNode, end: number): TableGrid {
  const rows: Span[][][] = [];
  let aligns: Align[] = [];

  for (let child = table.firstChild; child; child = child.nextSibling) {
    if (child.from >= end) break;
    // The one delimiter that is a child of the table rather than of a row is
    // the line of dashes, and nothing else says where a column's text sits.
    if (child.name === "TableDelimiter") {
      aligns = alignsOf(state.doc.sliceString(child.from, child.to));
      continue;
    }
    rows.push(rowSpans(state, child));
  }
  return new TableGrid(rows, aligns);
}

/**
 * Drawn as a table, and shown as its source while the cursor is in it.
 * The only construct here that flips a whole block at once: one widget
 * stands in for every line of it, so there is no half of a table to show.
 */
export function drawTable(walk: Walk, table: SyntaxNode): void {
  const { state, decorations } = walk;
  const end = tableEndsAt(state, table);
  const first = state.doc.lineAt(table.from);
  const last = state.doc.lineAt(end);
  const inside = isBlockRevealed(state, table.from, end);
  // A block widget has to cover whole lines. A table nested in a list is
  // indented past the start of its first one, and shows its source.
  const whole = table.from === first.from;

  if (!inside && whole) {
    decorations.push(
      Decoration.replace({ widget: tableGrid(state, table, end), block: true }).range(
        table.from,
        end,
      ),
    );
    // Not `false`, which would skip the prose the parser swallowed along
    // with the table. The walk goes on into it and `drawn` keeps it out
    // of the rows the widget already stands for.
    walk.drawn = end;
    return;
  }

  // The source, in a face where every character is one width, because the
  // columns are lined up by counting spaces. The walk goes on into the
  // cells and colours them, but `tableEnd` stops it hiding anything
  // there: hiding two marks shortens a cell by two. The head row is the
  // only one the source does not mark.
  walk.tableEnd = end;
  for (let number = first.number; number <= last.number; number++) {
    const at = state.doc.line(number).from;
    const edge = number === first.number ? " cm-table-head" : "";
    decorations.push(Decoration.line({ class: `cm-table${edge}` }).range(at));
  }
}
