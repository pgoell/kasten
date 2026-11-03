import type { Text } from "@codemirror/state";
import { Decoration, WidgetType } from "@codemirror/view";
import type { SyntaxNode } from "@lezer/common";
import { isBlockRevealed, type Walk } from "@/lib/live/live-preview-hidden";
import { sanitizeSvg } from "@/lib/live/svg-sanitize";

/** A whole `<svg>` element, open tag to close tag, and nothing after it but space. */
const SVG_BLOCK = /^<svg[\s>][\s\S]*<\/svg>\s*$/i;
/** What a saved .svg file may hold above its `<svg>`: an xml prelude, comments and a doctype (#1183). */
const HEAD = /(?:\s*(?:<\?xml[\s\S]*?\?>|<!--[\s\S]*?-->|<!doctype[^>]*>))*\s*/iy;
// How far a head or a run of blank lines is read: a note of cards has a comment on every card.
const REACH = 2000;
// What a node that may start an svg opens with: the svg itself or one of HEAD's parts.
const STARTS = ["<svg", "<?xml", "<!--", "<!doc"];
const OPENS = /<svg[\s>/]/gi;
const CLOSES = /<\/svg\s*>/gi;

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

/** How many more svgs `text` opens than it closes, so a nested `</svg>` does not end the block. */
function nesting(text: string): number {
  return (text.match(OPENS)?.length ?? 0) - (text.match(CLOSES)?.length ?? 0);
}

/**
 * Where the svg that a file's head or a blank line splits starts and ends, or null.
 * After a blank line only a line opening with `<` reads on, so an unclosed svg swallows no prose.
 */
function spannedSvg(doc: Text, from: number): { svg: number; to: number } | null {
  HEAD.lastIndex = 0;
  const svg = from + (HEAD.exec(doc.sliceString(from, from + REACH))?.[0].length ?? 0);
  if (!/^<svg[\s>]/i.test(doc.sliceString(svg, svg + 5))) return null;
  // An svg indented on its own line is code or a list's, not a file's body.
  if (/^[ \t]+$/.test(doc.sliceString(doc.lineAt(svg).from, svg))) return null;
  let depth = 0;
  for (let line = doc.lineAt(svg); ; line = doc.line(line.number + 1)) {
    depth += nesting(doc.sliceString(Math.max(svg, line.from), line.to));
    if (line.number === doc.lines) return depth <= 0 ? { svg, to: line.to } : null;
    const next = doc.line(line.number + 1).text;
    if (next.trim() !== "") continue;
    if (depth <= 0) return { svg, to: line.to };
    const start = doc.line(line.number + 1).to;
    const after = doc.sliceString(start, start + REACH).match(/\S/);
    if (after?.[0] !== "<") return null;
  }
}

/** The svg's start and the block's end when `node` starts a whole svg, else null. */
function svgRange(walk: Walk, node: SyntaxNode): { svg: number; to: number } | null {
  const { doc } = walk.state;
  // Every paragraph comes through here, so its first characters are read before the whole of it.
  const head = doc.sliceString(node.from, node.from + 5).toLowerCase();
  if (!STARTS.some((start) => head.startsWith(start))) return null;
  if (node.from !== doc.lineAt(node.from).from) return null;
  // One block that is the whole svg reads as before; otherwise a head or a blank line splits it.
  const whole = node.to === doc.lineAt(node.to).to;
  if (whole && SVG_BLOCK.test(doc.sliceString(node.from, node.to))) {
    return { svg: node.from, to: node.to };
  }
  return spannedSvg(doc, node.from);
}

/**
 * A paragraph or HTML block that starts one whole `<svg>` element, drawn as its
 * picture. Only a whole line counts: an svg in a list item, a quote or the middle
 * of a sentence stays source, as a diagram in those places does.
 */
export function drawSvg(walk: Walk, node: SyntaxNode): false | undefined {
  const { state, decorations } = walk;
  const range = svgRange(walk, node);
  if (range === null) return undefined;
  // Only the svg reaches the sanitiser: it takes one element, and the head would be a second.
  const source = state.doc.sliceString(range.svg, range.to);
  if (!SVG_BLOCK.test(source)) return undefined;
  if (isBlockRevealed(state, node.from, range.to)) {
    // The blocks past this one are part of the same source, so none of them draws on its own.
    if (range.to > node.to) walk.drawn = range.to;
    return undefined;
  }
  decorations.push(
    Decoration.replace({ widget: new SvgBlock(source), block: true }).range(node.from, range.to),
  );
  walk.drawn = range.to;
  return false;
}
