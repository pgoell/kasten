import { Facet } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { type CM5EditorInterface, Vim } from "@replit/codemirror-vim";
import { takeVaultText } from "@/lib/editor/buffer-writes";
import { toHtml, toSlack } from "@/lib/editor/copy-as";
import { follow } from "@/lib/editor/editor-follow";
import { lineUpEdited } from "@/lib/editor/table-lineup";
import { noticeHandler } from "@/lib/image";
import { type CopyFormat, viewCommands } from "@/lib/palette";

type SaveHandler = (doc: string) => void;
/** Answers with the vault's text, or with null when the reload was refused. */
type ReloadHandler = (force: boolean) => Promise<string | null>;

/**
 * Carries the save callback. `Vim.defineEx` registers `:w` once for the module, so the
 * handler is reached from the view the key was typed into.
 */
export const saveHandler = Facet.define<SaveHandler, SaveHandler | undefined>({
  combine: (handlers) => handlers[0],
});

export function save(view: EditorView): boolean {
  // Before the text is read, so what is saved is the table as lined up.
  lineUpEdited(view);
  view.state.facet(saveHandler)?.(view.state.doc.toString());
  return true;
}

Vim.defineEx("write", "w", (cm: { cm6: EditorView }) => save(cm.cm6));

/**
 * Carries the reload callback. The one holding unsaved text decides whether `:e` may
 * discard it, so the answer comes back from one call.
 */
export const reloadHandler = Facet.define<ReloadHandler, ReloadHandler | undefined>({
  combine: (handlers) => handlers[0],
});

/**
 * Reads the note off the vault again, vim's `:e`. The bang arrives in the argument, not the name,
 * and is what lets `:e!` discard unsaved text that plain `:e` declines to.
 */
function edit(view: EditorView, params: { argString?: string }): boolean {
  // Trimmed, because the argument holds everything typed after the word and
  // `:e! ` is still `:e!`. Losing the bang to a trailing space would turn the
  // command into the one that declines, without a word about why.
  const argument = params.argString?.trim() ?? "";
  // Those two spellings are the whole of the command. Vim opens the file an
  // argument names; this editor holds the note its pane holds, so rereading
  // that one would be the wrong note answering to the right command. Nothing
  // happens instead, which is at least not a lie.
  if (argument !== "" && argument !== "!") return false;

  const reload = view.state.facet(reloadHandler);
  if (reload === undefined) return false;

  void reload(argument === "!").then(
    (text) => {
      // Null is the refusal, and there is nothing to put in. Nothing asks
      // `allowReload` on the way in either: what that guard stands over is the
      // text waiting to be written, and the answer above came from the holder
      // of that text, who dropped it before handing this back. Dispatching into
      // a view destroyed while the read was in flight is safe, CodeMirror
      // keeping the state and doing nothing else with it.
      if (text !== null) takeVaultText(view, text);
    },
    () => {
      // The vault could not be read. Nothing was discarded, the discard waiting
      // on the text, so the buffer and the status bar stand as they were.
    },
  );
  return true;
}

Vim.defineEx("edit", "e", (cm: { cm6: EditorView }, params: { argString?: string }) =>
  edit(cm.cm6, params),
);

/**
 * A yank also lands on the system clipboard, as `clipboard=unnamedplus` has it.
 * Wrapped, since vim offers no hook on a yank.
 */
const registers = Vim.getRegisterController();
const pushText = registers.pushText.bind(registers);
registers.pushText = (name, operator, text, linewise, blockwise) => {
  pushText(name, operator, text, linewise, blockwise);
  // `"+y` writes the clipboard already, and `"_y` writes nowhere.
  if (operator !== "yank" || name === "+" || name === "_") return;
  // Absent outside a secure context, which a test's document is.
  void navigator.clipboard?.writeText(linewise && !text.endsWith("\n") ? `${text}\n` : text);
};

const COPY_FORMATS: Record<CopyFormat, string> = { md: "markdown", slack: "Slack", teams: "Teams" };

/**
 * What `:copy` takes: the visual selection it was typed from, to the
 * character, the lines of a range typed by hand, or else the whole note.
 */
function copySource(
  cm: CM5EditorInterface,
  params: { input: string; line?: number; lineEnd?: number },
) {
  const doc = cm.cm6.state.doc;
  if (params.line === undefined) return doc.toString();

  const vim = cm.state.vim;
  const from = vim?.marks["<"]?.find();
  const to = vim?.marks[">"]?.find();
  const charwise =
    vim?.lastSelection && !vim.lastSelection.visualLine && !vim.lastSelection.visualBlock;
  if (params.input.startsWith("'<,'>") && charwise && from && to) {
    // `>` sits on the last selected character rather than after it.
    const end = Math.min(cm.indexFromPos(to) + 1, doc.line(to.line + 1).to);
    return doc.sliceString(cm.indexFromPos(from), end);
  }
  return doc.sliceString(
    doc.line(params.line + 1).from,
    doc.line((params.lineEnd ?? params.line) + 1).to,
  );
}

/** Put `source` on the clipboard, rewritten for where it is going. */
function copyAs(view: EditorView, format: CopyFormat, source: string): void {
  const notice = view.state.facet(noticeHandler);
  // A part of the note links to definitions anywhere in it.
  const note = view.state.doc.toString();
  // Teams keeps the formatting of pasted HTML and reads no markup out of
  // text, so it gets HTML, with the markdown for anywhere that takes text.
  const written =
    format === "teams"
      ? navigator.clipboard.write([
          new ClipboardItem({
            "text/html": new Blob([toHtml(source, note)], { type: "text/html" }),
            "text/plain": new Blob([source], { type: "text/plain" }),
          }),
        ])
      : navigator.clipboard.writeText(format === "slack" ? toSlack(source, note) : source);
  written.then(
    () => notice?.(`Copied for ${COPY_FORMATS[format]}`),
    (error: DOMException) => notice?.(`Nothing copied: ${error.message}`),
  );
}

Vim.defineEx("copy", "co", (cm, params) => {
  const format = (params.argString.trim() || "md") as CopyFormat;
  if (!(format in COPY_FORMATS)) {
    cm.cm6.state.facet(noticeHandler)?.(`:copy takes ${Object.keys(COPY_FORMATS).join(", ")}`);
    return;
  }
  copyAs(cm.cm6, format, copySource(cm, params));
});

/**
 * The ex prompt's commands and `gf`, run by name for the palette. With vim off this is the only
 * way to them but the write, and a selection says which part where vim would take a range.
 */
export const byName = viewCommands.of({
  write: save,
  reload: (view, force) => edit(view, { argString: force ? "!" : "" }),
  follow,
  copy: (view, format) => {
    const { from, to } = view.state.selection.main;
    copyAs(view, format, from === to ? view.state.doc.toString() : view.state.sliceDoc(from, to));
  },
});
