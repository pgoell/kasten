import { Facet, type Line, MapMode, StateEffect, StateField } from "@codemirror/state";
import { Decoration, EditorView, WidgetType } from "@codemirror/view";
import type { SyntaxNode } from "@lezer/common";
import { parseCallout } from "@/lib/callout";
import { FOLDED, HIDDEN, isNodeRevealed, type Walk } from "@/lib/live/live-preview-hidden";

/** Flips the fold of the callout whose `>` sits at this position. */
export const toggleFold = StateEffect.define<number>();

/**
 * Positions a callout folded shut by its `-` opens for.
 *
 * The search pane marks the line a hit sits on, and a hit inside a shut body
 * would mark a line nobody can see. A click still shuts it again.
 */
export const opensFor = Facet.define<number>();

/**
 * A click on a written title flips the fold, as one on the chevron does.
 * Otherwise a cursor in the title would show the callout's source, not open it.
 */
function foldingTitle(target: EventTarget | null): Element | null {
  if (!(target instanceof Element) || target.closest(".cm-link, .cm-wikilink")) return null;
  return target.closest("[data-fold]");
}

export const foldClicks = EditorView.domEventHandlers({
  mousedown(event) {
    if (foldingTitle(event.target) === null) return false;
    event.preventDefault();
    return true;
  },
  click(event, view) {
    const title = foldingTitle(event.target);
    if (title === null) return false;
    view.dispatch({ effects: toggleFold.of(Number(title.getAttribute("data-fold"))) });
    return true;
  },
});

/**
 * The callouts a click has folded against their sign, kept by their `>`.
 * View state, not text, so undo never takes a click back.
 */
export const folds = StateField.define<readonly number[]>({
  create: () => [],
  update(value, tr) {
    let next = value;
    if (tr.docChanged) {
      next = next.flatMap((at) => {
        const mapped = tr.changes.mapPos(at, 1, MapMode.TrackDel);
        return mapped === null ? [] : [mapped];
      });
    }
    for (const effect of tr.effects) {
      if (!effect.is(toggleFold)) continue;
      const at = effect.value;
      next = next.includes(at) ? next.filter((other) => other !== at) : [...next, at];
    }
    return next;
  },
});

/**
 * Makes `dom` flip the fold of the callout at `from`.
 * The press must not reach CodeMirror, or a cursor here shows the source.
 */
function flipsFold(dom: HTMLElement, view: EditorView, from: number): void {
  dom.addEventListener("mousedown", (event) => event.preventDefault());
  dom.addEventListener("click", (event) => {
    event.preventDefault();
    view.dispatch({ effects: toggleFold.of(from) });
  });
}

/** The chevron, its glyph in CSS and turned by the class when open. */
function chevron(open: boolean): HTMLElement {
  const span = document.createElement("span");
  span.className = open ? "cm-callout-fold cm-callout-fold-open" : "cm-callout-fold";
  return span;
}

/**
 * What stands in for `> [!type]-`: the icon and, when none is written, the
 * title made from the type, with the chevron after it on a callout that folds.
 *
 * The icon's glyph and colour are in CSS, read off the kind class on the line.
 */
class CalloutHead extends WidgetType {
  private readonly title: string | null;
  /** The callout's `>`, or null for one that does not fold. */
  private readonly fold: number | null;
  private readonly open: boolean;

  constructor(title: string | null, fold: number | null, open: boolean) {
    super();
    this.title = title;
    this.fold = fold;
    this.open = open;
  }

  override eq(other: CalloutHead): boolean {
    return other.title === this.title && other.fold === this.fold && other.open === this.open;
  }

  toDOM(view: EditorView): HTMLElement {
    const head = document.createElement("span");
    head.className = "cm-callout-header";
    head.appendChild(document.createElement("span")).className = "cm-callout-icon";
    if (this.title !== null) {
      const title = head.appendChild(document.createElement("span"));
      title.className = "cm-callout-title";
      title.textContent = this.title;
      // Here rather than at the end of the line: a widget there would sit at
      // the edge of this one's range, and of the folded body's.
      if (this.fold !== null) head.append(chevron(this.open));
    }
    if (this.fold !== null) flipsFold(head, view, this.fold);
    return head;
  }
}

/** The chevron after a written title, which is text and so cannot take the click. */
class FoldToggle extends WidgetType {
  private readonly from: number;
  private readonly open: boolean;

  constructor(from: number, open: boolean) {
    super();
    this.from = from;
    this.open = open;
  }

  override eq(other: FoldToggle): boolean {
    return other.from === this.from && other.open === this.open;
  }

  toDOM(view: EditorView): HTMLElement {
    const toggle = chevron(this.open);
    flipsFold(toggle, view, this.from);
    return toggle;
  }
}

/** A callout the walk found, by line number, for the line pass after it. */
interface Box {
  first: number;
  last: number;
  /** The last line on the screen, the title alone when the body is folded. */
  shown: number;
  kind: string;
  /** Whether it shows its source, the cursor being in it. */
  revealed: boolean;
  /** What the head widget covers, its `>` and `[!type]`, when drawn. */
  head: { from: number; to: number } | null;
}

/**
 * The callout state of one walk: what the walk has found and what it has to
 * settle once the whole note has gone by.
 */
export class Callouts {
  /** Every callout, an outer one before those inside it. */
  private readonly callouts: Box[] = [];
  /**
   * Every `>`, hidden and classed after the walk.
   * A line's marks come before the callout that owns it, as in `> > [!tip]`.
   */
  private readonly quotes: { from: number; to: number; line: Line; revealed: boolean }[] = [];
  /** The `[!type]` of the callout last entered, which the parser reads as a link. */
  private header = { from: -1, to: -1 };
  /** The body of the callout last folded shut, which nothing draws. */
  private folded = { from: -1, to: -1 };
  /** How far a callout showing its source reaches. One inside it shows its own. */
  private sourceTo = -1;

  /** Whether the walk has already drawn this node, as a callout's head or folded body. */
  covers(from: number, to: number): boolean {
    return (
      (from >= this.folded.from && to <= this.folded.to) ||
      (from >= this.header.from && to <= this.header.to)
    );
  }

  /**
   * A quote whose first line opens with `[!type]` is a callout, drawn as a box.
   * Read at the quote, so the first line decides for every line under it.
   */
  enter(walk: Walk, node: SyntaxNode): void {
    const { state, decorations, hidden } = walk;
    const mark = node.firstChild;
    if (mark?.name !== "QuoteMark") return;
    const line = state.doc.lineAt(node.from);
    let at = mark.to;
    if (state.doc.sliceString(at, at + 1) === " ") at++;
    const callout = parseCallout(state.doc.sliceString(at, line.to));
    if (callout === null) return;
    let last = state.doc.lineAt(node.to);
    if (last.from === node.to && last.number > line.number) {
      last = state.doc.line(last.number - 1);
    }
    this.header = { from: at, to: at + callout.length };

    // The whole callout at once, as a fenced block is: a box whose title
    // is drawn from text you cannot see is no place to edit that text.
    const revealed = node.from < this.sourceTo || isNodeRevealed(state, node.from, last.to);
    const box: Box = {
      first: line.number,
      last: last.number,
      shown: last.number,
      kind: callout.kind,
      revealed,
      head: null,
    };
    this.callouts.push(box);
    if (revealed) {
      this.sourceTo = Math.max(this.sourceTo, last.to);
      return;
    }

    const folding = callout.fold !== "";
    const shownAt = state.facet(opensFor).some((at) => at >= node.from && at <= last.to);
    const shut = callout.fold === "-" && !shownAt;
    const open = !shut !== state.field(folds).includes(node.from);
    box.head = { from: node.from, to: this.header.to };
    const widget = new CalloutHead(
      callout.titled ? null : callout.title,
      folding ? node.from : null,
      open,
    );
    decorations.push(Decoration.replace({ widget }).range(node.from, this.header.to));
    hidden.push(HIDDEN.range(node.from, this.header.to));
    if (callout.titled) {
      const end = this.header.to + callout.title.length;
      // The callout's `>` on a title that folds, for `foldClicks` to read.
      const attributes = folding ? { "data-fold": String(node.from) } : undefined;
      decorations.push(
        Decoration.mark({ class: "cm-callout-title", attributes }).range(this.header.to, end),
      );
      if (folding) {
        decorations.push(
          Decoration.widget({ widget: new FoldToggle(node.from, open), side: -1 }).range(line.to),
        );
      }
    }

    // Shut, the body falls into the title line, the way CodeMirror's own
    // folding hides a range. `FOLDED` tells `skipHidden` where the cursor
    // goes instead: see there.
    if (folding && !open && last.number > line.number) {
      const body = state.doc.line(line.number + 1);
      decorations.push(HIDDEN.range(line.to, last.to));
      hidden.push(FOLDED.range(line.to, last.to));
      this.folded = { from: body.from, to: last.to };
      box.shown = line.number;
    }
  }

  /** Records a `>` for the pass after the walk, which knows the callouts around it. */
  quote(from: number, to: number, line: Line, revealed: boolean): void {
    this.quotes.push({ from, to, line, revealed });
  }

  /**
   * The callout pass after the walk: the quotes that are not under a callout's
   * head or folded body, then one line class for each line a callout covers.
   */
  finish(walk: Walk): void {
    const { state, decorations } = walk;
    /** The callouts a line sits in, outermost first. */
    const around = (number: number) =>
      this.callouts.filter((c) => c.first <= number && number <= c.last);

    for (const quote of this.quotes) {
      const boxes = around(quote.line.number);
      // Under a folded body, or under the head widget that stands for the mark.
      if (boxes.some((c) => quote.line.number > c.shown)) continue;
      if (boxes.some((c) => c.head && quote.from >= c.head.from && quote.to <= c.head.to)) continue;
      if (quote.revealed || boxes.some((c) => c.revealed)) continue;
      walk.hideLeader(quote.from, quote.to, quote.line);
    }

    // One line class each, so a callout's line does not wear the quote's bar as
    // well. The bar is drawn in CSS, and unlike the bullet it stands in for
    // nothing, so it can stay while the `>` is back on screen. A callout keeps
    // its box while it shows its source, as a code block keeps its surface.
    const lines = new Set(this.quotes.map((quote) => quote.line.number));
    for (const box of this.callouts) {
      for (let number = box.first; number <= box.last; number++) lines.add(number);
    }
    for (const number of lines) {
      const at = state.doc.line(number).from;
      const boxes = around(number);
      const outer = boxes[0];
      const inner = boxes[boxes.length - 1];
      if (outer === undefined || inner === undefined) {
        decorations.push(Decoration.line({ class: "cm-blockquote" }).range(at));
        continue;
      }
      if (boxes.some((c) => number > c.shown)) continue;
      const edge = `${number === outer.first ? " cm-callout-open" : ""}${number === outer.shown ? " cm-callout-close" : ""}${number === inner.first ? " cm-callout-head" : ""}`;
      // A box in a box: the outer one's bar at the edge and the inner one's
      // drawn one step in, the line wearing the inner one's colour.
      const nested = boxes.length > 1;
      decorations.push(
        Decoration.line({
          class: `cm-callout cm-callout-${inner.kind}${edge}${nested ? " cm-callout-nested" : ""}`,
          ...(nested && {
            attributes: {
              style: `--callout-outer: var(--callout-${outer.kind}); --callout-indent: ${boxes.length - 1}em`,
            },
          }),
        }).range(at),
      );
    }
  }
}
