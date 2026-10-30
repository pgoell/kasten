import { markdownLanguage } from "@codemirror/lang-markdown";
import type { EditorState, Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

/**
 * Markdown ships no closeBrackets data, so this backtick is added to the default set.
 * Copied here because the package does not export it.
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
 * The fence a third backtick opens, or null. closeBrackets would otherwise leave four
 * backticks on the line. Only the bare pair at the end of a line is claimed.
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
