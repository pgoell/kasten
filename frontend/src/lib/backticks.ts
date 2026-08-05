import { markdownLanguage } from "@codemirror/lang-markdown";
import type { EditorState, Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

/**
 * The set @codemirror/autocomplete closes by default, with the backtick added.
 *
 * Markdown ships no `closeBrackets` data of its own, so the default set is what
 * the editor was using, and a backtick was not in it. Repeated here rather than
 * imported because the package does not export it.
 */
const BRACKETS = ["(", "[", "{", "'", '"', "`"];

const FENCE = "```";

export interface Fence {
  from: number;
  to: number;
  insert: string;
  /** The empty line between the two fences, where the code goes. */
  cursor: number;
}

/**
 * The fence a third backtick should open, or null when it is not one.
 *
 * `closeBrackets` answers the first backtick with a pair and skips over the
 * second, which leaves the third opening a pair of its own and four backticks
 * sitting on the line. Three backticks means a fenced block, so that keystroke
 * is claimed here and the block written instead.
 *
 * The line has to hold the pair and nothing else, with the cursor at the end of
 * it. That is narrow on purpose: it is the one arrangement the two earlier
 * keystrokes produce, and it cannot be reached by a backtick typed mid-sentence.
 */
export function fenceAt(state: EditorState, pos: number): Fence | null {
  const line = state.doc.lineAt(pos);
  if (line.text !== "``" || pos !== line.to) return null;

  return {
    from: line.from,
    to: line.to,
    insert: `${FENCE}\n\n${FENCE}`,
    cursor: line.from + FENCE.length + 1,
  };
}

/**
 * Backticks that close themselves, singly and in threes.
 *
 * Must be installed ahead of `basicSetup`, whose `closeBrackets` would
 * otherwise answer the third backtick first.
 */
export function backticks(): Extension {
  return [
    markdownLanguage.data.of({ closeBrackets: { brackets: BRACKETS } }),
    EditorView.inputHandler.of((view, from, _to, text) => {
      if (text !== "`") return false;

      const fence = fenceAt(view.state, from);
      if (!fence) return false;

      view.dispatch({
        changes: { from: fence.from, to: fence.to, insert: fence.insert },
        selection: { anchor: fence.cursor },
        userEvent: "input.type",
        scrollIntoView: true,
      });
      return true;
    }),
  ];
}
