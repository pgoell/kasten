// biome-ignore-all lint/suspicious/noTemplateCurlyInString: `${}` is CodeMirror snippet syntax, not a template placeholder.
import { type CompletionContext, type CompletionResult, snippet } from "@codemirror/autocomplete";
import { Facet } from "@codemirror/state";
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
  TAB_KEYS,
} from "@/lib/key-bindings";
import { toggleVim } from "@/lib/vim-setting";

/**
 * The commands you reach by name rather than by key: the palette behind
 * `<leader>:`, and the `/` menu while writing.
 *
 * Nothing here is a second list of commands. Every row is read from the tables
 * in `key-bindings.ts`, plus `INSERTS` below, which no key reaches, and `EX`
 * and the vim toggle, which no leader key does, so a new leader binding shows
 * up in both places with no edit here.
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

export type CopyFormat = "md" | "slack" | "teams";

/**
 * What vim's own keys reach on a view: the ex prompt's commands and `gf`.
 *
 * `editor.tsx` holds the handlers these run and provides this, because it
 * reads this module for the `/` menu and an import back would be a circle.
 * Absent on a view that is not a note's editor, which lists none of them.
 */
export interface ViewCommands {
  write(view: EditorView): void;
  /** `force` is the bang: throw away unsaved text. */
  reload(view: EditorView, force: boolean): void;
  follow(view: EditorView): void;
  /** The selection when there is one, or else the whole note. */
  copy(view: EditorView, format: CopyFormat): void;
}

export const viewCommands = Facet.define<ViewCommands, ViewCommands | undefined>({
  combine: (handlers) => handlers[0],
});

/**
 * The commands vim spells at its prompt or with a key of its own, by name.
 *
 * With vim off there is no prompt and no normal mode, and the palette is the
 * one way left to each of these.
 */
const EX: readonly {
  keys: string;
  label: string;
  run: (commands: ViewCommands, view: EditorView) => void;
}[] = [
  { keys: ":w", label: "Write the note", run: (commands, view) => commands.write(view) },
  {
    keys: ":e",
    label: "Read the note off the vault again",
    run: (commands, view) => commands.reload(view, false),
  },
  {
    keys: ":e!",
    label: "Read the note off the vault again, throwing away unsaved text",
    run: (commands, view) => commands.reload(view, true),
  },
  {
    keys: "gf",
    label: "Open what the wikilink or highlight under the cursor names",
    run: (commands, view) => commands.follow(view),
  },
  {
    keys: ":copy md",
    label: "Copy as markdown",
    run: (commands, view) => commands.copy(view, "md"),
  },
  {
    keys: ":copy slack",
    label: "Copy for Slack",
    run: (commands, view) => commands.copy(view, "slack"),
  },
  {
    keys: ":copy teams",
    label: "Copy for Teams",
    run: (commands, view) => commands.copy(view, "teams"),
  },
];

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
  const routed: PaletteEntry[] = [
    ...LEADER.filter(({ command }) => command !== "openPalette").map(({ key, label, command }) => ({
      label,
      keys: spelled(key),
      run: () => commands[command](),
    })),
    ...TAB_KEYS.map((key, index) => ({
      label: `Go to tab ${index + 1}`,
      keys: spelled(key),
      run: () => commands.goToTab(index),
    })),
    // No key: a leader sequence is a vim mapping, and one that turned vim off
    // could not turn it back on.
    { label: "Toggle vim keys", run: toggleVim },
  ];
  if (view === null) return routed;

  const onView = view.state.facet(viewCommands);

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
    ...(onView === undefined
      ? []
      : EX.map(({ keys, label, run }) => ({ label, keys, run: () => run(onView, view) }))),
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
