import { Facet } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { Vim } from "@replit/codemirror-vim";
import { type EditorCommands, LEADER } from "@/lib/key-bindings";

/**
 * Carries the app's commands on the editor state.
 *
 * Vim registers its mappings once for the whole module and cannot close over
 * one view's props, so the commands have to be reachable from the view the key
 * was typed into. This is the same trick `saveHandler` plays for `:w`.
 */
export const editorCommands = Facet.define<EditorCommands, EditorCommands | undefined>({
  combine: (handlers) => handlers[0],
});

/** The CodeMirror 5 shim vim hands its actions. `cm6` on it is typed `any`. */
type VimCm = { cm6: EditorView };

// Vim ships `<Space>` bound to `l`, and its dispatcher takes a full match over
// a partial one, so `<Space>b` can never begin a sequence while the built-in
// stands. `unmap` matches on `context === ctx`, and the built-in carries no
// context, so passing none is what removes it. The declared type overstates
// the requirement by demanding a string.
(Vim.unmap as (lhs: string, ctx?: string) => void)("<Space>");
// Visual mode gets its move-right back by hand, the leader being normal only.
Vim.map("<Space>", "l", "visual");

for (const { key, command } of LEADER) {
  const name = `kastenLeader:${command}`;
  Vim.defineAction(name, (cm: VimCm) => {
    cm.cm6.state.facet(editorCommands)?.[command]();
  });
  Vim.mapCommand(`<Space>${key}`, "action", name, {}, { context: "normal" });
}
