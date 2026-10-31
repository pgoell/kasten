import type { EditorState } from "@codemirror/state";
import { Decoration, type EditorView, WidgetType } from "@codemirror/view";
import type { SyntaxNode } from "@lezer/common";
import { type Align, alignsOf, isRow } from "@/lib/editor/table";
import { isBlockRevealed, isLineRevealed, type Walk } from "@/lib/live/live-preview-hidden";
import { pictureElement } from "@/lib/live/live-preview-images";
import { INLINE } from "@/lib/live/live-preview-inline";
import { rowSpans, type Span } from "@/lib/live/live-preview-table-cells";
import { isCodeToken, isDashes, isNumericColumn } from "@/lib/live/table-kinds";
import { repeats } from "@/lib/presses";
import { notePath } from "@/lib/todo/todo-commands";

/**
 * The scroll place of each drawn table, kept per editor, note and table start.
 * A rebuilt widget would otherwise scroll back to the start each time the cursor enters the table.
 */
const scrolled = new WeakMap<EditorView, Map<string, number>>();
/**
 * The observer each drawn table holds, and the place its scroll goes back to,
 * kept so `destroy` can let the observer go and save the scroll.
 */
const watching = new WeakMap<
  HTMLElement,
  { observer: ResizeObserver; place: Map<string, number>; key: string }
>();

/** The text a cell shows, or null for a cell that holds a picture, which is never a number or code. */
function textOf(spans: Span[]): string | null {
  if (spans.some((span) => span.image)) return null;
  return spans.map((span) => span.text).join("");
}

/**
 * Keeps the edge shadows and the sticky first column true to the scroller.
 * Read off the scroll and the box, so resizes and scrolls land on the same numbers.
 */
function watchTable(
  block: HTMLElement,
  scroller: HTMLElement,
  place: Map<string, number>,
  key: string,
): void {
  let restore = place.get(key);
  const measure = (): void => {
    const { scrollLeft, scrollWidth, clientWidth } = scroller;
    block.toggleAttribute("data-shadow-left", scrollLeft > 0);
    block.toggleAttribute("data-shadow-right", scrollLeft + clientWidth < scrollWidth - 1);
    // A first column wider than half the box would leave the scroll nothing to
    // show, so it scrolls with the rest rather than sticking.
    const first = scroller.querySelector<HTMLElement>("tr > :first-child");
    const width = first?.offsetWidth ?? 0;
    const wide = width * 2 > clientWidth;
    block.toggleAttribute("data-first-wide", wide);
    block.style.setProperty("--k-table-first", wide ? "0px" : `${width}px`);
  };
  // Set once the table has a layout, as a widget is not yet on the page when
  // it is built and a scroll set before then does nothing.
  const observer = new ResizeObserver(() => {
    if (restore !== undefined) {
      scroller.scrollLeft = restore;
      restore = undefined;
    }
    measure();
  });
  observer.observe(scroller);
  observer.observe(scroller.firstElementChild as Element);
  scroller.addEventListener("scroll", measure, { passive: true });
  watching.set(block, { observer, place, key });
}

function alignCell(cell: HTMLElement, explicit: Align, numeric: boolean): void {
  const align = explicit !== "none" ? explicit : numeric ? "right" : "none";
  if (align !== "none") cell.style.textAlign = align;
  if (numeric) cell.classList.add("cm-table-numeric");
}

function markBodyCell(cell: HTMLElement, spans: Span[]): void {
  // An empty cell draws its dash from the stylesheet, so the dash is in
  // no text and a copy of the cell gets nothing.
  const text = textOf(spans);
  if (text === "") cell.classList.add("cm-table-empty");
  // A dash the writer typed reads as the muted dash of an empty cell.
  if (text !== null && isDashes(text)) cell.classList.add("cm-table-blank");
  // A cell that is one code span, or one token that reads as a code name.
  const wholeCode = spans.length === 1 && spans[0]?.class === INLINE.InlineCode?.class;
  if (wholeCode || (text !== null && isCodeToken(text))) {
    cell.classList.add("cm-table-code");
  }
}

function spanElement(view: EditorView, span: Span): Node {
  if (span.image) {
    const image = pictureElement(view, span.image);
    if (span.address !== undefined) image.dataset.address = span.address;
    return image;
  }
  if (span.class === null) return document.createTextNode(span.text);
  const marked = document.createElement("span");
  marked.className = span.class;
  marked.textContent = span.text;
  if (span.address !== undefined) marked.dataset.address = span.address;
  if (span.target !== undefined) marked.dataset.target = span.target;
  return marked;
}

/**
 * A table, drawn as a table.
 * Cells arrive as spans, not source, since cutting them is a reading of the syntax tree.
 */
class TableGrid extends WidgetType {
  private readonly rows: Span[][][];
  private readonly aligns: Align[];
  /** Where the table starts, the key its scroll place is kept under. */
  private readonly from: number;
  /** What `eq` compares, the rows being a fresh array on every build. */
  private readonly key: string;

  constructor(rows: Span[][][], aligns: Align[], from: number) {
    super();
    this.rows = rows;
    this.aligns = aligns;
    this.from = from;
    this.key = JSON.stringify([rows, aligns]);
  }

  override destroy(dom: HTMLElement): void {
    const scroller = dom.querySelector<HTMLElement>(".cm-table-scroll");
    const drawn = watching.get(dom);
    if (drawn !== undefined && scroller !== null) {
      drawn.place.set(drawn.key, scroller.scrollLeft);
    }
    drawn?.observer.disconnect();
    watching.delete(dom);
  }

  override eq(other: TableGrid): boolean {
    return other.key === this.key;
  }

  /**
   * A click in the table puts the cursor in it, which shows the source.
   * Swallowing the press would leave the mouse no way in.
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
    // The sideways scroll is on the inner box, so the block keeps the listeners
    // and the shadows, which sit at its edges outside the scroll.
    const scroller = block.appendChild(document.createElement("div"));
    scroller.className = "cm-table-scroll";
    const table = scroller.appendChild(document.createElement("table"));
    table.className = "cm-table-grid";
    const head = table.createTHead();
    const body = table.createTBody();

    // A column is numeric when its body says so. The head is left out, as it
    // is words in every column, and an explicit colon in the dashes wins.
    const width = Math.max(0, ...this.rows.map((cells) => cells.length));
    const numeric = Array.from({ length: width }, (_, column) =>
      isNumericColumn(this.rows.slice(1).map((cells) => textOf(cells[column] ?? []) ?? "")),
    );

    this.rows.forEach((cells, index) => {
      const row = (index === 0 ? head : body).insertRow();
      cells.forEach((spans, column) => {
        const cell = row.appendChild(document.createElement(index === 0 ? "th" : "td"));
        alignCell(cell, this.aligns[column] ?? "none", numeric[column] === true);
        if (index > 0) markBodyCell(cell, spans);
        for (const span of spans) cell.append(spanElement(view, span));
      });
    });
    const place = scrolled.get(view) ?? new Map<string, number>();
    scrolled.set(view, place);
    watchTable(block, scroller, place, `${view.state.facet(notePath) ?? ""}:${this.from}`);
    return block;
  }
}

/**
 * Where the table stops, which is not always where the parser says it does.
 * GFM ends a table at a blank line, but a paragraph under it parses as a row. A row is a line with a `|`.
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
  return new TableGrid(rows, aligns, table.from);
}

/**
 * The caption under a table: a line starting `Table: ` straight under its last row.
 * The prefix is hidden where drawn and shown as written while the cursor is on the line.
 */
const CAPTION = "Table: ";

function drawCaption(walk: Walk, last: number): void {
  const { state, decorations } = walk;
  if (last >= state.doc.lines) return;
  const line = state.doc.line(last + 1);
  if (!line.text.startsWith(CAPTION)) return;
  decorations.push(Decoration.line({ class: "cm-table-caption" }).range(line.from));
  if (!isLineRevealed(state, line)) walk.hide(line.from, line.from + CAPTION.length);
}

/**
 * Drawn as a table, and shown as source while the cursor is in it.
 * One widget stands in for every line, so a table is never half shown.
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
  drawCaption(walk, last.number);

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
