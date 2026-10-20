import { Decoration, type EditorView, WidgetType } from "@codemirror/view";
import type { SyntaxNode } from "@lezer/common";
import { HIDDEN, isBlockRevealed, type Walk } from "@/lib/live-preview-hidden";
import { loadKatex } from "@/lib/math";

/**
 * A formula, `$x$` inline or `$$x$$` as a block, drawn by KaTeX.
 *
 * The source stands in the box until KaTeX lands, and a formula KaTeX cannot
 * read stays its source in the warning colour, the parse error on hover,
 * rather than a blank. KaTeX draws the rest in whatever colour it sits in.
 * The box changes size when the drawing lands, so it asks for a measure the
 * way a picture does.
 */
class Formula extends WidgetType {
  private readonly source: string;
  private readonly display: boolean;

  constructor(source: string, display: boolean) {
    super();
    this.source = source;
    this.display = display;
  }

  override eq(other: Formula): boolean {
    return other.source === this.source && other.display === this.display;
  }

  /**
   * A click puts the cursor in the formula, which is what shows the source,
   * as it does in a table. Inline, with vim on, it puts the cursor beside it.
   */
  override ignoreEvent(): boolean {
    return false;
  }

  toDOM(view: EditorView): HTMLElement {
    // A block's space above and below is padding on the box, for the reason
    // the table's is.
    const box = document.createElement(this.display ? "div" : "span");
    box.className = this.display ? "cm-math-block" : "cm-math";
    box.textContent = this.source;
    void loadKatex().then(
      (katex) => {
        katex.render(this.source, box, {
          displayMode: this.display,
          throwOnError: false,
          errorColor: "var(--color-one-warn)",
        });
        view.requestMeasure();
      },
      // A load that failed leaves the source in the box, and the next formula
      // drawn asks for KaTeX again (#637).
      (error: unknown) => {
        if (!(error instanceof Error)) throw error;
      },
    );
    return box;
  }
}

/**
 * A `$$` block, by the table's rule and for the table's reasons: one
 * widget stands for its lines, `j` and `k` step over it, and the cursor
 * in it in any mode shows the source. A read-only view draws it.
 */
export function drawBlockMath(walk: Walk, node: SyntaxNode): false | undefined {
  const { state, decorations } = walk;
  const first = state.doc.lineAt(node.from);
  const end = state.doc.lineAt(node.to).to;
  const inside = isBlockRevealed(state, node.from, end);
  if (!inside && node.from === first.from) {
    const source = state.doc.sliceString(node.from + 2, node.to - 2).trim();
    const widget = new Formula(source, true);
    decorations.push(Decoration.replace({ widget, block: true }).range(node.from, end));
    return false;
  }
  // On to the `>` of a block in a quote, which shows its source.
  return;
}

/**
 * Drawn in place of `$x$` and hidden as an image is, so the cursor in
 * normal mode steps over the formula rather than onto a hidden `$`.
 */
export function drawInlineMath(walk: Walk, from: number, to: number, revealed: boolean): void {
  const { state, decorations, hidden } = walk;
  if (revealed) return;
  const widget = new Formula(state.doc.sliceString(from + 1, to - 1), false);
  decorations.push(Decoration.replace({ widget }).range(from, to));
  hidden.push(HIDDEN.range(from, to));
}
