import { Facet } from "@codemirror/state";
import { type CodeMirrorV, Vim } from "@replit/codemirror-vim";
import { toggleMark } from "@/lib/format-commands";
import { type EditorCommands, FORMAT, LEADER, TAB_KEYS } from "@/lib/key-bindings";

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
  Vim.defineAction(name, (cm: CodeMirrorV) => {
    cm.cm6.state.facet(editorCommands)?.[command]();
  });
  Vim.mapCommand(`<Space>${key}`, "action", name, {}, { context: "normal" });
}

// Their own loop, because the commands above take nothing and this one takes
// the tab to go to. Folding the number into `LEADER` would mean every action
// in that loop being called with an argument all but ten of them ignore.
TAB_KEYS.forEach((key, index) => {
  const name = `kastenTab:${index}`;
  Vim.defineAction(name, (cm: CodeMirrorV) => {
    cm.cm6.state.facet(editorCommands)?.goToTab(index);
  });
  Vim.mapCommand(`<Space>${key}`, "action", name, {}, { context: "normal" });
});

for (const { key, spec } of FORMAT) {
  const name = `kastenFormat:${spec.node}`;
  Vim.defineAction(name, (cm: CodeMirrorV, _args, vim) => {
    toggleMark(cm.cm6, spec);
    // An operator applied to a selection ends the selection. Formatting is an
    // action rather than an operator, so it has to say so itself.
    if (vim.visualMode) Vim.exitVisualMode(cm);
  });
  for (const context of ["insert", "visual"]) {
    Vim.mapCommand(key, "action", name, {}, { context });
  }
}
