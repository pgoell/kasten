import {
  EditorState,
  type Extension,
  Facet,
  StateEffect,
  StateField,
  Transaction,
} from "@codemirror/state";
import { type EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";
import { getCM } from "@replit/codemirror-vim";

export type VimMode = "normal" | "insert" | "visual" | "replace";

/** The four strings vim signals. Anything else is ignored rather than guessed at. */
const MODES: readonly string[] = ["normal", "insert", "visual", "replace"];

export const setVimMode = StateEffect.define<VimMode>();

export const vimModeField = StateField.define<VimMode>({
  create: () => "normal",
  update(value, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setVimMode)) value = effect.value;
    }
    return value;
  },
});

/**
 * Whether the view runs vim at all. Absent means yes, so views written before the setting
 * existed read the field above as they always did.
 */
export const vimKeys = Facet.define<boolean, boolean>({
  combine: (values) => values[0] ?? true,
});

/**
 * The mode live preview goes by. Without vim the editor is always typing, which is insert mode,
 * so the line under the cursor shows its source as it does there.
 */
export function editingMode(state: EditorState): VimMode {
  return state.facet(vimKeys) ? state.field(vimModeField) : "insert";
}

/**
 * Mirrors vim's mode into the editor state. Vim keeps it on a mutable property of its view object,
 * which state-level code cannot see, so each `vim-mode-change` event becomes an effect.
 */
const bridge = ViewPlugin.fromClass(
  class {
    private cm: ReturnType<typeof getCM>;
    private readonly onChange: (event: { mode: string }) => void;
    private destroyed = false;

    constructor(view: EditorView) {
      this.cm = getCM(view);
      this.onChange = ({ mode }) => {
        if (!MODES.includes(mode)) return;
        // Deferred, and this is load bearing. Leaving visual mode signals from
        // inside vim's own dispatch, because `exitVisualMode` moves the cursor
        // before it announces the mode. Dispatching from in there re-enters the
        // update, CodeMirror answers by killing the plugin that did it, and the
        // plugin it kills is vim's: the editor is left with no vim at all. The
        // vim package defers out of its own handlers the same way.
        queueMicrotask(() => {
          if (this.destroyed) return;
          if (view.state.field(vimModeField) === mode) return;
          view.dispatch({ effects: setVimMode.of(mode as VimMode) });
        });
      };
      this.cm?.on("vim-mode-change", this.onChange);
    }

    // Vim can arrive after this plugin did, the setting turning it on in a view
    // that mounted without it, and leave again. Each one is a new instance, and
    // the one held here would otherwise go on being listened to for ever.
    update(update: ViewUpdate) {
      const cm = getCM(update.view);
      if (cm === this.cm) return;
      this.cm?.off("vim-mode-change", this.onChange);
      this.cm = cm;
      this.cm?.on("vim-mode-change", this.onChange);
      // A new vim starts in normal mode and says nothing about it, and the
      // field may still hold the mode the last one was turned off in.
      if (cm) this.onChange({ mode: "normal" });
    }

    destroy() {
      this.destroyed = true;
      this.cm?.off("vim-mode-change", this.onChange);
    }
  },
);

export function vimModeState(): Extension {
  return [vimModeField, bridge];
}

type Insert = { insert: boolean; joins: boolean };

/** Sent as vim enters insert mode, `joins` true when its key already changed the text (`o`, `cw`), and as it leaves. */
const insertMode = StateEffect.define<Insert>();

/** Whether vim is inserting, and whether a typed change joins the last undo event, it being this insert's own. */
const insertField = StateField.define<Insert>({
  create: () => ({ insert: false, joins: false }),
  update(value, tr) {
    for (const effect of tr.effects) {
      if (effect.is(insertMode)) value = effect.value;
    }
    const kept = tr.annotation(Transaction.addToHistory) !== false;
    if (value.insert && !value.joins && tr.docChanged && kept) {
      value = { insert: true, joins: true };
    } else if (value.insert && value.joins && tr.selection && !tr.docChanged) {
      // A cursor moved by a click or a key ends the undo step there, as vim's insert does.
      value = { insert: true, joins: false };
    }
    return value;
  },
});

/**
 * Makes one insert one undo event, as vim does (#1662). `o` moves the cursor after its newline,
 * and the history never joins typing onto an event with a cursor move behind it, nor after a pause.
 * vim's own trick: `input.type.compose` always joins.
 */
const joinTyping = EditorState.transactionFilter.of((tr) => {
  if (!tr.startState.field(insertField).joins) return tr;
  if (!tr.isUserEvent("input.type") || tr.isUserEvent("input.type.compose")) return tr;
  return {
    changes: tr.changes,
    selection: tr.selection,
    effects: tr.effects,
    scrollIntoView: tr.scrollIntoView,
    userEvent: "input.type.compose",
  };
});

/** Tells the field as vim enters and leaves insert mode. */
const insertWatch = ViewPlugin.fromClass(
  class {
    private cm: ReturnType<typeof getCM>;
    // The entering key's change comes before the mode signal, in the same task.
    private changedThisTask = false;
    private destroyed = false;
    private readonly onChange: (event: { mode: string }) => void;

    constructor(view: EditorView) {
      this.cm = getCM(view);
      this.onChange = ({ mode }) => {
        const next = {
          insert: mode === "insert",
          joins: mode === "insert" && this.changedThisTask,
        };
        // Deferred, as in the bridge above: vim signals from inside its own dispatch.
        queueMicrotask(() => {
          if (!this.destroyed) view.dispatch({ effects: insertMode.of(next) });
        });
      };
      this.cm?.on("vim-mode-change", this.onChange);
    }

    update(update: ViewUpdate) {
      if (update.docChanged && !this.changedThisTask) {
        this.changedThisTask = true;
        queueMicrotask(() => {
          this.changedThisTask = false;
        });
      }
      const cm = getCM(update.view);
      if (cm === this.cm) return;
      this.cm?.off("vim-mode-change", this.onChange);
      this.cm = cm;
      this.cm?.on("vim-mode-change", this.onChange);
    }

    destroy() {
      this.destroyed = true;
      this.cm?.off("vim-mode-change", this.onChange);
    }
  },
);

/** One undo event per vim insert. Goes beside `vim()`. */
export function vimInsertUndo(): Extension {
  return [insertField, joinTyping, insertWatch];
}
