import type { EditorCommands } from "@/lib/key-bindings";

/**
 * An `EditorCommands` that records every call and does nothing.
 *
 * The pane tests hand one to a component rather than pressing keys into an
 * editor, so they need the whole interface and care about two of its members.
 */
export function stubCommands() {
  return {
    toggleTree: vi.fn(),
    toggleArchive: vi.fn(),
    togglePreview: vi.fn(),
    closeNote: vi.fn(),
    showHelp: vi.fn(),
    focusTree: vi.fn(),
    createNote: vi.fn(),
    renameNote: vi.fn(),
    deleteNote: vi.fn(),
    restoreDeleted: vi.fn(),
    findNote: vi.fn(),
    searchNotes: vi.fn(),
    findTodos: vi.fn(),
    openTodos: vi.fn(),
    showBacklinks: vi.fn(),
    showLinksOut: vi.fn(),
    openDaily: vi.fn(),
    openWeekly: vi.fn(),
    openMonthly: vi.fn(),
    openQuarterly: vi.fn(),
    openYearly: vi.fn(),
    openBook: vi.fn(),
    uploadBook: vi.fn(),
    importNotes: vi.fn(),
    exportNote: vi.fn(),
    openExam: vi.fn(),
    createTab: vi.fn(),
    openTerminal: vi.fn(),
    importPage: vi.fn(),
    splitRight: vi.fn(),
    splitDown: vi.fn(),
    nextPane: vi.fn(),
    paneLeft: vi.fn(),
    paneDown: vi.fn(),
    paneUp: vi.fn(),
    paneRight: vi.fn(),
    nextTab: vi.fn(),
    prevTab: vi.fn(),
    goToTab: vi.fn(),
  } satisfies EditorCommands;
}
