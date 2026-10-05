// biome-ignore-all lint/suspicious/noTemplateCurlyInString: `${}` is CodeMirror snippet syntax, not a template placeholder.
import { type CompletionContext, type CompletionResult, snippet } from "@codemirror/autocomplete";
import type { EditorView } from "@codemirror/view";
import { getCM, Vim } from "@replit/codemirror-vim";
import { editorCommands } from "@/lib/editor-commands";
import { toggleMark } from "@/lib/format-commands";
import {
  type EditorCommands,
  FORMAT,
  LEADER,
  LEADER_EDITS,
  readable,
  spelled,
} from "@/lib/key-bindings";

/**
 * The commands you reach by name rather than by key: the palette behind
 * `<leader>:`, and the `/` menu while writing.
 *
 * Nothing here is a second list of commands. Every row is read from the tables
 * in `key-bindings.ts`, plus `INSERTS` below, which no key reaches, so a new
 * leader binding shows up in both places with no edit here.
 */

export interface Insert {
  label: string;
  /** CodeMirror snippet syntax: `${}` is where the cursor lands, `${name}` a field Tab walks to. */
  template: string;
  /** Whether it starts a line of its own, so typed mid-line it begins a new one. */
  block: boolean;
}

/** Markdown the palette and the `/` menu write into the note. */
export const INSERTS: readonly Insert[] = [
  { label: "Heading 1", template: "# ${}", block: true },
  { label: "Heading 2", template: "## ${}", block: true },
  { label: "Heading 3", template: "### ${}", block: true },
  { label: "Todo", template: "- [ ] ${}", block: true },
  { label: "Bullet list", template: "- ${}", block: true },
  { label: "Numbered list", template: "1. ${}", block: true },
  { label: "Quote", template: "> ${}", block: true },
  { label: "Code block", template: "```${language}\n${}\n```", block: true },
  // Two columns and one row, which is the smallest table that reads as one.
  // Tab walks the cells from there, `moveCell` adding rows as it goes.
  {
    label: "Table",
    template: "| ${1:Column} | ${2:Column} |\n| --- | --- |\n| ${3} |  |",
    block: true,
  },
  { label: "Divider", template: "---\n${}", block: true },
  { label: "Wikilink", template: "[[${}]]", block: false },
];

/** Write an insert over `from`..`to`, on a line of its own if it needs one. */
export function writeInsert(view: EditorView, insert: Insert, from: number, to: number): void {
  const line = view.state.doc.lineAt(from);
  const midLine = view.state.sliceDoc(line.from, from).trim() !== "";
  const lead = insert.block && midLine ? "\n" : "";
  snippet(lead + insert.template)(view, null, from, to);
}

export interface PaletteEntry {
  label: string;
  /** The key that does the same, so the palette teaches it. */
  keys?: string;
  run: () => void;
}

/**
 * Everything the palette can run.
 *
 * `view` is the editor the palette opened over, or null when it opened over a
 * pane holding no buffer. Without one, only the route's commands are listed:
 * the rest write into a note and there is none to write into.
 */
export function paletteEntries(commands: EditorCommands, view: EditorView | null): PaletteEntry[] {
  const routed = LEADER.filter(({ command }) => command !== "openPalette").map(
    ({ key, label, command }) => ({ label, keys: spelled(key), run: () => commands[command]() }),
  );
  if (view === null) return routed;

  return [
    ...INSERTS.map((insert) => ({
      label: insert.label,
      run: () => {
        // Insert mode first: a snippet selects its first field, and vim reads a
        // selection made in normal mode as visual mode.
        const cm = getCM(view);
        if (cm && !cm.state.vim?.insertMode) Vim.handleKey(cm, "i", "mapping");
        const at = view.state.selection.main.head;
        writeInsert(view, insert, at, at);
      },
    })),
    ...LEADER_EDITS.map(({ key, label, run }) => ({
      label,
      keys: spelled(key),
      run: () => run(view),
    })),
    ...FORMAT.map(({ key, label, spec }) => ({
      label,
      keys: readable(key),
      run: () => toggleMark(view, spec),
    })),
    ...routed,
  ];
}

/** A `/` at the start of a line or after a space, and the word typed after it. */
const TYPED = /(?:^|\s)\/\w*$/;

/**
 * The `/` menu: every insert, edit and command, offered as you write.
 *
 * Only after whitespace or at a line's start, so a path or a URL typed into the
 * note opens nothing. CodeMirror ranks the labels against what follows the
 * slash, the way it ranks `[[`, and choosing one takes the slash back out.
 *
 * The result starts past the slash, because CodeMirror matches everything from
 * `from` against each label and no label holds a slash. So every `apply` below
 * reaches one character back to take it out.
 */
export function slashCompletions(context: CompletionContext): CompletionResult | null {
  const typed = context.matchBefore(TYPED);
  if (!typed) return null;
  const from = typed.from + typed.text.indexOf("/") + 1;
  const commands = context.state.facet(editorCommands);

  /** Take the `/word` out, then run what was chosen. */
  const then =
    (run: (view: EditorView) => void) =>
    (view: EditorView, _c: unknown, at: number, to: number) => {
      view.dispatch({ changes: { from: at - 1, to } });
      run(view);
    };

  return {
    from,
    options: [
      // Boosted so an empty `/` lists the markdown first, which is what a menu
      // opened mid-sentence is most often for.
      ...INSERTS.map((insert) => ({
        label: insert.label,
        type: "text",
        boost: 1,
        apply: (view: EditorView, _c: unknown, at: number, to: number) =>
          writeInsert(view, insert, at - 1, to),
      })),
      ...LEADER_EDITS.map(({ key, label, run }) => ({
        label,
        detail: spelled(key),
        type: "function",
        apply: then(run),
      })),
      ...FORMAT.map(({ key, label, spec }) => ({
        label,
        detail: readable(key),
        type: "function",
        apply: then((view) => toggleMark(view, spec)),
      })),
      ...(commands === undefined
        ? []
        : LEADER.map(({ key, label, command }) => ({
            label,
            detail: spelled(key),
            type: "function",
            apply: then(() => commands[command]()),
          }))),
    ],
    // Labels carry spaces, so a space narrows rather than ending the menu.
    validFor: /^[\w ]*$/,
  };
}
