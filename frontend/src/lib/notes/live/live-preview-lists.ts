import type { Line } from "@codemirror/state";
import { Decoration, WidgetType } from "@codemirror/view";
import type { SyntaxNode } from "@lezer/common";
import { readClock } from "@/lib/core/clock";
import { LETTER_MARK } from "@/lib/notes/editor/format-commands";
import type { Walk } from "@/lib/notes/live/live-preview-hidden";
import { masked, parseTodo } from "@/lib/todo/todo";
import { DUE } from "@/lib/todo/todo-fields";
import { descendants, noteTree, type Placed, progressOf, treeOf } from "@/lib/todo/todo-view";

/** How far one level of list nesting shifts an item, in `em`. The hang in `live-preview-lists.css` matches it. */
const BULLET_INDENT = 1.6;

/** A line opening `a)` or `b.`, which CommonMark reads as text and kasten draws as a list item. */
const LETTER = new RegExp(`^(\\s*)(${LETTER_MARK.source})( +|$)`);

/**
 * Today, read once when the module loads.
 * ponytail: a tab open across midnight keeps yesterday's date until it reloads.
 */
const TODAY = readClock(new Date()).date;

/** How far past the list mark a box reaches: ` [s]`, whatever the indent is. */
const BOX_WIDTH = 4;

/**
 * How many lists a list item sits inside.
 * The nesting spaces are hidden, so the indent is drawn from this depth.
 */
function listDepth(node: SyntaxNode): number {
  let depth = 0;
  for (let parent = node.parent; parent; parent = parent.parent) {
    if (parent.name === "BulletList" || parent.name === "OrderedList") depth++;
  }
  return depth;
}

/**
 * `3/5` drawn after a parent's line.
 * A widget, since the count is read off the lines below and sits in no text.
 */
class Progress extends WidgetType {
  private readonly label: string;

  // Written out rather than as a parameter property, which `erasableSyntaxOnly`
  // does not allow: that syntax is the one piece of TypeScript that emits code.
  constructor(label: string) {
    super();
    this.label = label;
  }

  override eq(other: Progress): boolean {
    return other.label === this.label;
  }

  toDOM(): HTMLElement {
    const span = document.createElement("span");
    span.className = "cm-todo-progress";
    span.textContent = this.label;
    return span;
  }
}

/**
 * The todo lines of one walk: each bullet is read as it goes by, and the counts
 * of the parents are drawn once the whole note has gone by.
 */
export class Lists {
  /** Every todo line, gathered as the bullets go by, for the counts below. */
  private readonly placed: Placed[] = [];

  /**
   * The dot is drawn in CSS, so it goes when the `-` it stands in for returns.
   * A number is content, so it stays, hung where the dot would be.
   */
  item(walk: Walk, node: SyntaxNode, line: Line, revealed: boolean): void {
    if (node.parent?.parent?.name === "OrderedList") {
      hang(walk, line, node.from, node.to, listDepth(node));
      return;
    }
    const { decorations } = walk;
    // The state is read off the line rather than off a node: the parser
    // emits `TaskMarker` for `[ ]` and `[x]` and for nothing else, so five
    // of the seven states have no node to hang a rendering on. Reading it
    // through `parseTodo` is also what stops the drawing and the writes
    // disagreeing about what counts as a todo.
    const todo = parseTodo(line.text);
    // `parseTodo`'s own regex on its own mask, so the red cannot drift from
    // what counts as due again (#414) or read one inside a link or code
    // span (#415). The mask keeps the length, so the offsets fit the line.
    const due = todo === null ? null : DUE.exec(masked(line.text));

    // Inside the branch that already parsed the line, so no line is read
    // twice and no second pass over the document is added.
    if (todo !== null) this.placed.push({ line: line.number, todo });

    // Red on the date itself, so unlike everything below it this stays
    // while the line shows its source: it colours text that is on the
    // screen either way rather than standing in for characters.
    if (due && due[1] !== undefined && due[1] < TODAY) {
      const at = line.from + due.index;
      decorations.push(Decoration.mark({ class: "cm-todo-overdue" }).range(at, at + due[0].length));
    }

    // The source mark hangs in the padding the dot hung in, so the text stays at its level.
    if (revealed) {
      hang(walk, line, node.from, node.to, listDepth(node));
      return;
    }
    decorations.push(
      Decoration.line({
        class: todo === null ? "cm-bullet" : `cm-todo cm-todo-${todo.state}`,
        attributes: { style: `padding-left: ${BULLET_INDENT * listDepth(node)}em` },
      }).range(line.from),
    );
    // From the start of the line, not the mark: the spaces that nest the
    // item go too, their job now done by the padding above. On a todo the
    // box goes with them, the symbol standing in for the whole of it.
    walk.hideLeader(line.from, todo === null ? node.to : node.to + BOX_WIDTH, line);
  }

  /** The `a)` lines of a paragraph, laid out as a numbered item one list deeper than the paragraph. */
  letters(walk: Walk, paragraph: SyntaxNode): void {
    const { doc } = walk.state;
    const depth = listDepth(paragraph) + 1;
    for (let n = doc.lineAt(paragraph.from).number; n <= doc.lineAt(paragraph.to).number; n++) {
      const line = doc.line(n);
      const letter = LETTER.exec(line.text);
      if (!letter) continue;
      const from = line.from + (letter[1]?.length ?? 0);
      hang(walk, line, from, from + 2, depth);
    }
  }

  /**
   * After the walk, since a parent's count is the lines under it.
   * `Decoration.set` sorts, so pushing out of order is safe.
   */
  finish(walk: Walk): void {
    const { state, decorations } = walk;
    // Only an indented todo can be a part (#1445), so a flat note skips the second read.
    const nested = this.placed.some((entry) => entry.todo.indent > 0);
    const roots = nested ? noteTree(state.doc.toString().split("\n")) : treeOf(this.placed);
    for (const root of roots) {
      for (const node of [root, ...descendants(root)]) {
        const progress = progressOf(node);
        if (progress === null) continue;
        decorations.push(
          Decoration.widget({
            widget: new Progress(`${progress.closed}/${progress.total}`),
            side: 1,
          }).range(state.doc.line(node.line).to),
        );
      }
    }
  }
}

/**
 * Puts a list line's text at its level with the source mark hanging left of it, as a drawn dot hangs.
 * The nesting spaces go: in a proportional face their width says nothing about the level.
 */
function hang(walk: Walk, line: Line, markFrom: number, markTo: number, depth: number): void {
  let to = markTo;
  while (to < line.to && walk.state.doc.sliceString(to, to + 1) === " ") to++;
  walk.decorations.push(
    Decoration.line({
      class: "cm-list-line",
      attributes: { style: `padding-left: ${BULLET_INDENT * depth}em` },
    }).range(line.from),
  );
  if (markFrom > line.from) walk.hide(line.from, markFrom);
  walk.decorations.push(Decoration.mark({ class: "cm-list-mark" }).range(markFrom, to));
}
