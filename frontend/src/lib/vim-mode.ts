import { type Extension, StateEffect, StateField } from "@codemirror/state";
import { type EditorView, ViewPlugin } from "@codemirror/view";
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
    private readonly cm: ReturnType<typeof getCM>;
    private readonly onChange: (event: { mode: string }) => void;

    constructor(view: EditorView) {
      this.cm = getCM(view);
      this.onChange = ({ mode }) => {
        if (MODES.includes(mode)) {
          view.dispatch({ effects: setVimMode.of(mode as VimMode) });
        }
      };
      this.cm?.on("vim-mode-change", this.onChange);
    }

    destroy() {
      this.cm?.off("vim-mode-change", this.onChange);
    }
  },
);

export function vimModeState(): Extension {
  return [vimModeField, bridge];
}
