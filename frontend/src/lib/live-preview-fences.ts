import { Decoration, type EditorView, WidgetType } from "@codemirror/view";
import type { SyntaxNode } from "@lezer/common";
import { isBlockRevealed, isNodeRevealed, type Walk } from "@/lib/live-preview-hidden";
import { type Drawing, drawMermaid, drawnMermaid } from "@/lib/mermaid";

/**
 * A ```` ```mermaid ```` block, drawn as its diagram.
 *
 * Shown as its source while the cursor is in it, by the rule a table follows,
 * and a click puts the cursor there for the reason it does on a table. A
 * diagram mermaid cannot read shows the message and the source rather than a
 * blank, so a typo is something you can see and fix.
 */
class MermaidBlock extends WidgetType {
  private readonly source: string;

  constructor(source: string) {
    super();
    this.source = source;
  }

  override eq(other: MermaidBlock): boolean {
    return other.source === this.source;
  }

  override ignoreEvent(): boolean {
    return false;
  }

  toDOM(view: EditorView): HTMLElement {
    // Padding on a wrapper rather than a margin, for the reason `TableGrid`
    // gives.
    const block = document.createElement("div");
    block.className = "cm-mermaid-block";
    const known = drawnMermaid(this.source);
    if (known !== undefined) {
      fillDiagram(block, known, this.source);
      return block;
    }
    // The svg lands after CodeMirror has measured the empty box, so the
    // measurement is asked for again, as a picture's load does.
    void drawMermaid(this.source).then((drawing) => {
      fillDiagram(block, drawing, this.source);
      view.requestMeasure();
    });
    return block;
  }
}

function fillDiagram(block: HTMLElement, drawing: Drawing, source: string): void {
  if ("svg" in drawing) {
    // Sanitised by mermaid at its strict level, see `mermaid.ts`.
    block.innerHTML = drawing.svg;
    return;
  }
  const message = block.appendChild(document.createElement("div"));
  message.className = "cm-mermaid-error";
  message.textContent = drawing.error;
  const code = block.appendChild(document.createElement("pre"));
  code.className = "cm-mermaid-source";
  code.textContent = source;
}

/**
 * A fenced code block: its lines get the surface, and its fences go unless the
 * cursor is in it. Every line of the block, so the run reads as one surface with
 * the code in a monospaced face. The backticks and the language go, the surface
 * saying where the block starts and ends better than they did. The code itself
 * is left alone, whichever parser the language named having already highlighted
 * it.
 */
export function drawFence(walk: Walk, node: SyntaxNode): false | undefined {
  const { state, decorations } = walk;
  // A diagram goes by the table's rule, and for its reasons: see there.
  const info = node.getChild("CodeInfo");
  const code = node.getChild("CodeText");
  const isMermaid =
    info !== null &&
    code !== null &&
    state.doc.sliceString(info.from, info.to).toLowerCase() === "mermaid";
  if (isMermaid) {
    const inside = isBlockRevealed(state, node.from, node.to);
    const whole =
      node.from === state.doc.lineAt(node.from).from && node.to === state.doc.lineAt(node.to).to;
    if (!inside && whole) {
      const widget = new MermaidBlock(state.doc.sliceString(code.from, code.to));
      decorations.push(Decoration.replace({ widget, block: true }).range(node.from, node.to));
      walk.drawn = node.to;
      return false;
    }
  }
  const first = state.doc.lineAt(node.from).number;
  const last = state.doc.lineAt(node.to).number;
  // The cursor anywhere in the block hands the fences back, and a fence
  // line is one the cursor cannot reach, so the whole block is the node
  // this asks about.
  const revealed = isNodeRevealed(state, node.from, node.to);
  // A block with no code between its fences keeps them. Hiding both would
  // leave no line on the screen to put the cursor back on, and the two
  // hidden runs would meet inside the one line break they share.
  const fenced = !revealed && last - first > 1;

  const marks = new Set<number>();
  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (child.name === "CodeMark") marks.add(state.doc.lineAt(child.from).number);
  }

  // Where the bottom of the surface hangs. A hidden fence falls into the
  // line of code beside it and CodeMirror draws the pair as one line
  // wearing the upper one's class, so a block of a single line carries
  // both ends on its opening fence.
  let closes = last;
  if (fenced) closes = last - first === 2 ? first : last - 1;

  for (let number = first; number <= last; number++) {
    const line = state.doc.line(number);
    const edge = `${number === first ? " cm-code-open" : ""}${number === closes ? " cm-code-close" : ""}`;
    decorations.push(Decoration.line({ class: `cm-code-block${edge}` }).range(line.from));
    // Hidden with the line break that keeps it off the code: the opening
    // fence takes the one after it and the closing fence the one before,
    // so neither leaves a blank row at the end of the block.
    if (!marks.has(number)) continue;
    // On the screen, so knocked back off the code: the backticks and the
    // language say where the block starts, which is what the surface
    // around them is already saying.
    if (!fenced) {
      decorations.push(Decoration.mark({ class: "cm-code-fence" }).range(line.from, line.to));
      continue;
    }
    if (number === first) walk.hide(line.from, line.to + 1);
    else walk.hide(line.from - 1, line.to);
  }
}
