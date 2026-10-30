import { type Extension, Facet } from "@codemirror/state";
import { ViewPlugin } from "@codemirror/view";
import { type CodeMirrorV, getCM, Vim } from "@replit/codemirror-vim";
import { FORMAT, LEADER_EDITS } from "@/lib/editor/buffer-keys";
import { toggleMark } from "@/lib/editor/format-commands";
import type { EditorCommands } from "@/lib/key-bindings";
import { LEADER, TAB_KEYS } from "@/lib/leader-keys";
import { beginLeader, editorOpener } from "@/lib/which-key";

/**
 * Vim maps once per module, so the commands ride the editor state instead.
 */
export const editorCommands = Facet.define<EditorCommands, EditorCommands | undefined>({
  combine: (handlers) => handlers[0],
});

/**
 * Each command calls `get` when run, so a re-render never rebuilds the view.
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
    // No path: the route already knows which note the editor holds.
    renameNote: (startPath) => get()?.renameNote(startPath),
    deleteNote: (startPath) => get()?.deleteNote(startPath),
    restoreDeleted: () => get()?.restoreDeleted(),
    findNote: () => get()?.findNote(),
    searchNotes: () => get()?.searchNotes(),
    findTodos: () => get()?.findTodos(),
    findBook: () => get()?.findBook(),
    findMeaning: () => get()?.findMeaning(),
    openTodos: () => get()?.openTodos(),
    openLog: () => get()?.openLog(),
    openOverview: () => get()?.openOverview(),
    openFinance: () => get()?.openFinance(),
    showBacklinks: () => get()?.showBacklinks(),
    showLinksOut: () => get()?.showLinksOut(),
    openDaily: () => get()?.openDaily(),
    logDrink: (line) => get()?.logDrink(line),
    logFood: () => get()?.logFood(),
    logWeight: (mark) => get()?.logWeight?.(mark),
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
    openRsvp: () => get()?.openRsvp(),
    rsvpFromHere: () => get()?.rsvpFromHere(),
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
 * The capture listener runs before vim's keydown and stands down mid-command.
 * So `f<Space>` and `3<Space>` stay vim's, and so do insert and visual mode.
 */
export const leaderPanel = ViewPlugin.define((view) => {
  function onKeyDown(event: KeyboardEvent) {
    if (event.key !== " " || event.ctrlKey || event.altKey || event.metaKey || event.shiftKey) {
      return;
    }
    // A space typed in vim's `:` or `/` prompt is its text, not the leader.
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

// Vim's built-in `<Space>` (bound to `l`) would shadow `<Space>b`. Its context is
// none, so unmapping passes none; the typed signature wrongly demands a string.
(Vim.unmap as (lhs: string, ctx?: string) => void)("<Space>");
// The leader is normal only, so visual mode keeps its move-right here.
Vim.map("<Space>", "l", "visual");

for (const { key, command } of LEADER) {
  const name = `kastenLeader:${command}`;
  Vim.defineAction(name, (cm: CodeMirrorV) => {
    cm.cm6.state.facet(editorCommands)?.[command]();
  });
  Vim.mapCommand(`<Space>${key}`, "action", name, {}, { context: "normal" });
}

// Separate loop: these write to the buffer and need the key's view, not a route command.
for (const { key, run } of LEADER_EDITS) {
  const name = `kastenEdit:${key}`;
  Vim.defineAction(name, (cm: CodeMirrorV) => {
    run(cm.cm6);
  });
  Vim.mapCommand(`<Space>${key}`, "action", name, {}, { context: "normal" });
}

// Separate loop: these take a tab index that the other actions would ignore.
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
    // Operators end a visual selection, but this action is not one, so exit it here.
    if (vim.visualMode) Vim.exitVisualMode(cm);
  });
  for (const context of ["insert", "visual"]) {
    Vim.mapCommand(key, "action", name, {}, { context });
  }
}
