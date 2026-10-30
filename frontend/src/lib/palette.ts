// biome-ignore-all lint/suspicious/noTemplateCurlyInString: `${}` is CodeMirror snippet syntax, not a template placeholder.
import { type CompletionContext, type CompletionResult, snippet } from "@codemirror/autocomplete";
import { Facet } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { getCM, Vim } from "@replit/codemirror-vim";
import { FORMAT, LEADER_EDITS, readable } from "@/lib/editor/buffer-keys";
import { editorCommands } from "@/lib/editor/editor-commands";
import { toggleMark } from "@/lib/editor/format-commands";
import { toggleVim } from "@/lib/editor/vim-setting";
import type { EditorCommands } from "@/lib/key-bindings";
import { LEADER, spelled, TAB_KEYS } from "@/lib/leader-keys";
import { askOnCard, openFoodSearch } from "@/lib/log/log-card";
import { DEFAULT_CONFIG, type LogKind, tapLine } from "@/lib/log/log-kinds";
import { logDrinkInView } from "@/lib/log/log-write";
import { pickPalette, toggleTheme } from "@/lib/theme";

/**
 * The commands reached by name, not key: the `<leader>:` palette and the `/` menu. Rows come
 * from `key-bindings.ts`, plus `INSERTS` and `EX`, so a new binding shows up with no edit.
 */

export interface Insert {
  label: string;
  /** CodeMirror snippet syntax: `${}` is the cursor, `${name}` a field Tab walks to. */
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
  // Two columns and one row, the smallest table that reads as one. Tab adds rows via `moveCell`.
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
 * What vim's keys reach on a view: the ex commands and `gf`. `lib/editor/editor-ex.ts` provides
 * these, since importing back here is a cycle. Absent on a view that is no note's editor.
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

/** Commands vim spells at its prompt or on its own key. With vim off, only the palette has them. */
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
 * Everything the palette can run. Without `view` (a pane with no buffer) only the route's
 * commands are listed, since the rest write into a note. `kinds` gives one `Log <name>` row each.
 */
export function paletteEntries(
  commands: EditorCommands,
  view: EditorView | null,
  kinds: readonly LogKind[] = DEFAULT_CONFIG.kinds,
): PaletteEntry[] {
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
    // No key: a leader sequence is a vim mapping, which could not turn vim back on.
    // A drink lands in today's note: its buffer when this editor holds it, else the vault.
    ...kinds.map((kind) => {
      const line = tapLine(kind);
      return {
        label: `Log ${kind.name}`,
        run: () => {
          // No line: the kind keeps its last value. Ask on a daily note's card, else today's note.
          if (line === null) {
            if (view === null || !askOnCard(view, kind.mark)) commands.logWeight?.(kind.mark);
            return;
          }
          if (view !== null && logDrinkInView(view, line)) return;
          commands.logDrink(line);
        },
      };
    }),
    // On a daily note's card the search opens there; elsewhere today's note opens first.
    {
      label: "Log food",
      run: () => {
        if (view !== null && openFoodSearch(view)) return;
        commands.logFood();
      },
    },
    { label: "Toggle vim keys", run: toggleVim },
    { label: "Toggle light and dark mode", run: toggleTheme },
    { label: "Accent palette: Vandar Poel's blue", run: () => pickPalette("poel") },
    { label: "Accent palette: Hay's russet", run: () => pickPalette("russet") },
    { label: "Accent palette: Peach red", run: () => pickPalette("peach") },
    { label: "Accent palette: Pansy purple", run: () => pickPalette("pansy") },
  ];
  if (view === null) return routed;

  const onView = view.state.facet(viewCommands);

  return [
    ...INSERTS.map((insert) => ({
      label: insert.label,
      run: () => {
        // Insert mode first: vim would read a snippet's selected field in normal mode as visual.
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
 * The `/` menu: inserts, edits and commands, offered as you write. Only after whitespace or at a
 * line's start, so a typed path or URL opens nothing.
 * The result starts past the slash, so each `apply` below reaches one character back to remove it.
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
      // Boosted, so a bare `/` lists the markdown first.
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
