import { StateEffect } from "@codemirror/state";
import { Decoration, type EditorView, ViewPlugin, WidgetType } from "@codemirror/view";
import type { SyntaxNode } from "@lezer/common";
import { isBlockRevealed, isNodeRevealed, type Walk } from "@/lib/live/live-preview-hidden";
import { type Drawing, drawMermaid, drawnMermaid, holdMermaid } from "@/lib/live/mermaid";
import { currentTheme, onThemeChange, type Theme } from "@/lib/theme";

/** Sent on a switch of theme, so a diagram on screen is built again in the new one. */
export const retheme = StateEffect.define<null>();

/**
 * Tells the view of a switch. A widget is asked for only when the decorations
 * are built, so a diagram already on screen would not hear of it otherwise.
 */
export const rethemes = ViewPlugin.define((view) => {
  const stop = onThemeChange(() => view.dispatch({ effects: retheme.of(null) }));
  return { destroy: stop };
});

/**
 * The drawing each block on screen wants now, as `${theme}\n${source}`. A draw
 * that lands after a newer switch, or a newer source, finds its key stale and
 * leaves the block alone.
 */
const wanted = new WeakMap<HTMLElement, string>();

/**
 * The drawing each block holds, so the cache keeps it while the block is on
 * screen. Keyed by the block's DOM: CodeMirror moves a DOM to a new widget
 * without calling `destroy` on the old one.
 */
const holds = new WeakMap<HTMLElement, { key: string; release: () => void }>();

/**
 * Fills `block` with the diagram of `source` in `theme`, at once if it has been
 * drawn and else when it lands. Until then the block keeps what it shows.
 */
function draw(block: HTMLElement, source: string, theme: Theme, view: EditorView): void {
  const key = `${theme}\n${source}`;
  wanted.set(block, key);
  // Held on a cache hit too, or a drawing still on screen could be let go.
  const held = holds.get(block);
  if (held?.key !== key) {
    held?.release();
    holds.set(block, { key, release: holdMermaid(source, theme) });
  }
  const known = drawnMermaid(source, theme);
  if (known !== undefined) {
    fillDiagram(block, known, source);
    return;
  }
  // The svg lands after CodeMirror measured the box, so measure again.
  void drawMermaid(source, theme).then((drawing) => {
    if (wanted.get(block) !== key) return;
    fillDiagram(block, drawing, source);
    view.requestMeasure();
  });
}

/**
 * A ```` ```mermaid ```` block, drawn as its diagram. A diagram mermaid cannot
 * read shows the message and the source, so a typo is easy to find.
 */
class MermaidBlock extends WidgetType {
  private readonly source: string;
  private readonly theme: Theme;

  constructor(source: string, theme: Theme) {
    super();
    this.source = source;
    this.theme = theme;
  }

  override eq(other: MermaidBlock): boolean {
    return other.source === this.source && other.theme === this.theme;
  }

  override ignoreEvent(): boolean {
    return false;
  }

  // CodeMirror may hand over another diagram's block. Only a theme switch on the
  // same source keeps the old drawing; anything else builds fresh.
  override updateDOM(dom: HTMLElement, view: EditorView, from: MermaidBlock): boolean {
    if (from.source !== this.source) return false;
    draw(dom, this.source, this.theme, view);
    view.requestMeasure();
    return true;
  }

  // Let go of the drawing, so the cache can drop it once nothing else holds it.
  override destroy(dom: HTMLElement): void {
    holds.get(dom)?.release();
    holds.delete(dom);
  }

  toDOM(view: EditorView): HTMLElement {
    // Padding on a wrapper, not a margin, for the reason `TableGrid` gives.
    const block = document.createElement("div");
    block.className = "cm-mermaid-block";
    draw(block, this.source, this.theme, view);
    return block;
  }
}

function fillDiagram(block: HTMLElement, drawing: Drawing, source: string): void {
  // The block may hold the drawing of another theme, or an error, so it is
  // emptied rather than added to.
  block.replaceChildren();
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
 * cursor is in it. The code is left alone, whichever parser highlighted it.
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
      const widget = new MermaidBlock(state.doc.sliceString(code.from, code.to), currentTheme());
      decorations.push(Decoration.replace({ widget, block: true }).range(node.from, node.to));
      walk.drawn = node.to;
      return false;
    }
  }
  const first = state.doc.lineAt(node.from).number;
  const last = state.doc.lineAt(node.to).number;
  // The cursor anywhere in the block hands the fences back.
  const revealed = isNodeRevealed(state, node.from, node.to);
  // A block with no code keeps its fences: hiding both leaves no line for the
  // cursor, and the two hidden runs would meet in the one line break they share.
  const fenced = !revealed && last - first > 1;

  const marks = new Set<number>();
  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (child.name === "CodeMark") marks.add(state.doc.lineAt(child.from).number);
  }

  // A hidden fence falls into the code beside it, so a one-line block carries
  // both ends on its opening fence.
  let closes = last;
  if (fenced) closes = last - first === 2 ? first : last - 1;

  for (let number = first; number <= last; number++) {
    const line = state.doc.line(number);
    const edge = `${number === first ? " cm-code-open" : ""}${number === closes ? " cm-code-close" : ""}`;
    decorations.push(Decoration.line({ class: `cm-code-block${edge}` }).range(line.from));
    // Hidden with the line break beside it, so neither fence leaves a blank row.
    if (!marks.has(number)) continue;
    // Muted, as the surface already says where the block starts.
    if (!fenced) {
      decorations.push(Decoration.mark({ class: "cm-code-fence" }).range(line.from, line.to));
      continue;
    }
    if (number === first) walk.hide(line.from, line.to + 1);
    else walk.hide(line.from - 1, line.to);
  }
}
