import {
  type EditorState,
  type Extension,
  Facet,
  StateEffect,
  StateField,
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
 * Whether the view runs vim at all, which the editor says no to by hand.
 *
 * Absent means yes, so every view written before the setting existed reads the
 * field above as it always did.
 */
export const vimKeys = Facet.define<boolean, boolean>({
  combine: (values) => values[0] ?? true,
});

/**
 * The mode live preview goes by. An editor without vim is always being typed
 * into, which is what insert mode is, so the line under the cursor shows its
 * source the way it does there.
 */
export function editingMode(state: EditorState): VimMode {
  return state.facet(vimKeys) ? state.field(vimModeField) : "insert";
}

/**
 * Mirrors vim's mode into the editor state.
 *
 * Vim keeps its mode on `cm.state.vim.mode`, a mutable property of an object
 * hanging off the view. State-level code cannot see it, and both the decoration
 * field and the selection filter need to. The only supported way to observe a
 * change is the `vim-mode-change` event, so this plugin turns each one into an
 * effect.
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
