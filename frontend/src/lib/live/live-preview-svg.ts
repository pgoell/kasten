import { Decoration, WidgetType } from "@codemirror/view";
import type { SyntaxNode } from "@lezer/common";
import { isBlockRevealed, type Walk } from "@/lib/live/live-preview-hidden";
import { sanitizeSvg } from "@/lib/live/svg-sanitize";

/** A whole `<svg>` element, open tag to close tag, and nothing after it but space. */
const SVG_BLOCK = /^<svg[\s>][\s\S]*<\/svg>\s*$/i;

/**
 * A raw `<svg>` pasted into a note, drawn as its picture (#952). It is sanitised
 * before it is drawn, and drawn with `currentColor` left to the text colour, so
 * the ink token decides its colour in light and dark alike.
 */
class SvgBlock extends WidgetType {
  private readonly source: string;

  constructor(source: string) {
    super();
    this.source = source;
  }

  override eq(other: SvgBlock): boolean {
    return other.source === this.source;
  }

  // A click puts the cursor in the block, as it does on a diagram.
  override ignoreEvent(): boolean {
    return false;
  }

  toDOM(): HTMLElement {
    const block = document.createElement("div");
    block.className = "cm-svg-block";
    const svg = sanitizeSvg(this.source);
    if (svg !== null) {
      block.appendChild(svg);
      return block;
    }
    // Null when the sanitiser keeps nothing to draw, or keeps more than the one
    // svg (text beside it included). Either way the source shows rather than a
    // blank, as a diagram that will not draw does.
    const message = block.appendChild(document.createElement("div"));
    message.className = "cm-svg-error";
    message.textContent = "This svg cannot be drawn.";
    const code = block.appendChild(document.createElement("pre"));
    code.className = "cm-svg-source";
    code.textContent = this.source;
    return block;
  }
}

/**
 * A paragraph or HTML block that is one whole `<svg>` element, drawn as its
 * picture. Only a whole line counts: an svg in a list item, a quote or the middle
 * of a sentence stays source, as a diagram in those places does.
 */
export function drawSvg(walk: Walk, node: SyntaxNode): false | undefined {
  const { state, decorations } = walk;
  // Every paragraph comes through here, so the first four characters are read
  // before the whole of it is.
  if (state.doc.sliceString(node.from, node.from + 4).toLowerCase() !== "<svg") return undefined;
  const source = state.doc.sliceString(node.from, node.to);
  const whole =
    node.from === state.doc.lineAt(node.from).from && node.to === state.doc.lineAt(node.to).to;
  if (!whole || !SVG_BLOCK.test(source)) return undefined;
  if (isBlockRevealed(state, node.from, node.to)) return undefined;
  decorations.push(
    Decoration.replace({ widget: new SvgBlock(source), block: true }).range(node.from, node.to),
  );
  walk.drawn = node.to;
  return false;
}
