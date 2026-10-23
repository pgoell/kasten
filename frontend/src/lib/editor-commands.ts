import { type Extension, Facet } from "@codemirror/state";
import { ViewPlugin } from "@codemirror/view";
import { type CodeMirrorV, getCM, Vim } from "@replit/codemirror-vim";
import { FORMAT, LEADER_EDITS } from "@/lib/buffer-keys";
import { toggleMark } from "@/lib/format-commands";
import type { EditorCommands } from "@/lib/key-bindings";
import { LEADER, TAB_KEYS } from "@/lib/leader-keys";
import { beginLeader, editorOpener } from "@/lib/which-key";

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

/**
 * Each one calls `get` when the key runs rather than closing over the prop, so
 * a re-render never has to rebuild the view to refresh a callback.
 */
export function forwardCommands(get: () => EditorCommands | undefined): Extension {
  return editorCommands.of({
    toggleTree: () => get()?.toggleTree(),
    toggleArchive: () => get()?.toggleArchive(),
    togglePreview: () => get()?.togglePreview(),
    closeNote: () => get()?.closeNote(),
    showHelp: () => get()?.showHelp(),
    openPalette: () => get()?.openPalette(),
    focusTree: () => get()?.focusTree(),
    revealTree: () => get()?.revealTree(),
    createNote: (startPath) => get()?.createNote(startPath),
    // No path: the editor holds one note, and the route already knows
    // which. The tree is the caller that names one.
    renameNote: (startPath) => get()?.renameNote(startPath),
    deleteNote: (startPath) => get()?.deleteNote(startPath),
    restoreDeleted: () => get()?.restoreDeleted(),
    findNote: () => get()?.findNote(),
    searchNotes: () => get()?.searchNotes(),
    findTodos: () => get()?.findTodos(),
    findBook: () => get()?.findBook(),
    openTodos: () => get()?.openTodos(),
    openLog: () => get()?.openLog(),
    showBacklinks: () => get()?.showBacklinks(),
    showLinksOut: () => get()?.showLinksOut(),
    openDaily: () => get()?.openDaily(),
    logDrink: (line) => get()?.logDrink(line),
    logFood: () => get()?.logFood(),
    openWeekly: () => get()?.openWeekly(),
    openMonthly: () => get()?.openMonthly(),
    openQuarterly: () => get()?.openQuarterly(),
    openYearly: () => get()?.openYearly(),
    openBook: () => get()?.openBook(),
    openReadingBook: () => get()?.openReadingBook(),
    openPerson: () => get()?.openPerson(),
    openHistory: () => get()?.openHistory(),
    openGraph: () => get()?.openGraph(),
    openLocalGraph: () => get()?.openLocalGraph(),
    openVideo: () => get()?.openVideo(),
    toggleVideo: () => get()?.toggleVideo(),
    uploadBook: () => get()?.uploadBook(),
    importNotes: () => get()?.importNotes(),
    exportNote: () => get()?.exportNote(),
    openExam: () => get()?.openExam(),
    openReview: () => get()?.openReview(),
    createTab: () => get()?.createTab(),
    openTerminal: () => get()?.openTerminal(),
    openChat: () => get()?.openChat(),
    importPage: () => get()?.importPage(),
    captureDump: () => get()?.captureDump(),
    splitRight: () => get()?.splitRight(),
    splitDown: () => get()?.splitDown(),
    nextPane: () => get()?.nextPane(),
    paneLeft: () => get()?.paneLeft(),
    paneDown: () => get()?.paneDown(),
    paneUp: () => get()?.paneUp(),
    paneRight: () => get()?.paneRight(),
    movePaneLeft: () => get()?.movePaneLeft(),
    movePaneDown: () => get()?.movePaneDown(),
    movePaneUp: () => get()?.movePaneUp(),
    movePaneRight: () => get()?.movePaneRight(),
    zoomPane: () => get()?.zoomPane(),
    nextTab: () => get()?.nextTab(),
    prevTab: () => get()?.prevTab(),
    goToTab: (index) => get()?.goToTab(index),
  });
}

/**
 * Space opens the which-key panel from a note, ahead of vim reading it.
 *
 * Vim reads its keys in a plugin's keydown, and a plugin's handlers run before
 * any `domEventHandlers` facet, so a `Prec.highest` one would hear the space
 * only after vim had started `<Space>…` with it. A capture listener on the
 * editor's own element is the one place that comes first. It stands down while
 * vim is partway through a command, so `f<Space>`, `r<Space>`, `d<Space>`,
 * `3<Space>` and `"a<Space>` are still vim's, and in insert and visual mode.
 */
export const leaderPanel = ViewPlugin.define((view) => {
  function onKeyDown(event: KeyboardEvent) {
    if (event.key !== " " || event.ctrlKey || event.altKey || event.metaKey || event.shiftKey) {
      return;
    }
    // Vim's `:` and `/` prompts are panels inside `view.dom`, with their own input,
    // and a space typed into one is the prompt's text, not the leader.
    if (!view.contentDOM.contains(event.target as Node)) return;
    const vim = getCM(view)?.state.vim;
    if (!vim || vim.insertMode || vim.visualMode) return;
    const input = vim.inputState;
    if (
      input.keyBuffer.length > 0 ||
      input.operator ||
      input.prefixRepeat.length > 0 ||
      input.motionRepeat.length > 0 ||
      input.registerName
    ) {
      return;
    }
    const commands = view.state.facet(editorCommands);
    if (commands === undefined || !beginLeader(editorOpener(view, commands))) return;
    // Stopped here, so neither vim nor anything above the editor takes the space.
    event.preventDefault();
    event.stopPropagation();
  }

  view.dom.addEventListener("keydown", onKeyDown, true);
  return { destroy: () => view.dom.removeEventListener("keydown", onKeyDown, true) };
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

// Their own loop, because these write to the buffer rather than reaching a
// command on the route, so what they need is the view the key was typed into.
for (const { key, run } of LEADER_EDITS) {
  const name = `kastenEdit:${key}`;
  Vim.defineAction(name, (cm: CodeMirrorV) => {
    run(cm.cm6);
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
