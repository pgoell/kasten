import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render } from "@testing-library/react";
import { useMemo } from "react";
import { NoteEditor } from "@/components/note-editor";
import { StatusBar } from "@/components/status-bar";
import { fetchNote } from "@/lib/api";
import type { EditorCommands } from "@/lib/key-bindings";
import { useAutosave } from "@/lib/use-autosave";

// Single-line notes on purpose: CodeMirror's text content runs the lines
// together, so anything longer makes the assertions unreadable. No markdown
// syntax either, because live preview hides the marks and these tests are about
// which note is open, not about how one is rendered.
export const VAULT: Record<string, string> = {
  "index.md": "the index note",
  "daily/2026-08-05.md": "the daily note",
};

export function serveVault() {
  vi.mocked(fetchNote).mockImplementation(async (path: string) => {
    const content = VAULT[path];
    if (content === undefined) throw new Error(`GET /api/files/${path} failed with 404`);
    return content;
  });
}

// Out here for the reason `commands` below is held across renders: the route's
// own follow handler is a `useCallback`, and a fresh literal per render would
// hand the editor a new prop on every keystroke.
const follow = () => {};

/** What the route puts around an open note: autosave, the editor, the bar. */
function OpenNote({ path }: { path: string }) {
  // What the route wires, and the reason this harness exists: the editor asks
  // the autosave before it takes the vault's text, and the autosave is what
  // knows whether anything is waiting.
  const { status, change, save, allowReload } = useAutosave(path);
  // Held across renders because the route holds it across renders too. A fresh
  // literal here would hand the editor a new prop on every keystroke, and the
  // render-count test below would then be measuring this harness rather than
  // the components it names.
  const commands = useMemo<EditorCommands>(
    () => ({
      toggleTree: () => {},
      toggleArchive: () => {},
      togglePreview: () => {},
      closeNote: () => {},
      showHelp: () => {},
      openPalette: () => {},
      openLog: () => {},
      openOverview: () => {},
      createNote: () => {},
      renameNote: () => {},
      deleteNote: () => {},
      restoreDeleted: () => {},
      findNote: vi.fn(),
      searchNotes: vi.fn(),
      findTodos: vi.fn(),
      findBook: vi.fn(),
      openTodos: vi.fn(),
      showBacklinks: vi.fn(),
      showLinksOut: vi.fn(),
      openDaily: vi.fn(),
      logDrink: vi.fn(),
      logFood: vi.fn(),
      openWeekly: vi.fn(),
      openMonthly: vi.fn(),
      openQuarterly: vi.fn(),
      openYearly: vi.fn(),
      openBook: vi.fn(),
      openReadingBook: vi.fn(),
      openPerson: vi.fn(),
      openHistory: vi.fn(),
      openGraph: vi.fn(),
      openLocalGraph: vi.fn(),
      openVideo: vi.fn(),
      toggleVideo: vi.fn(),
      uploadBook: vi.fn(),
      importNotes: vi.fn(),
      exportNote: vi.fn(),
      openExam: vi.fn(),
      openReview: vi.fn(),
      focusTree: () => {},
      revealTree: () => {},
      createTab: () => {},
      openTerminal: () => {},
      openChat: () => {},
      importPage: () => {},
      captureDump: () => {},
      splitRight: () => {},
      splitDown: () => {},
      nextPane: () => {},
      paneLeft: () => {},
      paneDown: () => {},
      paneUp: () => {},
      paneRight: () => {},
      nextTab: () => {},
      prevTab: () => {},
      goToTab: () => {},
      movePaneLeft: () => {},
      movePaneDown: () => {},
      movePaneUp: () => {},
      movePaneRight: () => {},
      zoomPane: () => {},
    }),
    [],
  );

  return (
    <>
      <NoteEditor
        path={path}
        commands={commands}
        preview
        onChange={change}
        onSave={save}
        onFollow={follow}
        allowReload={allowReload}
      />
      <StatusBar status={status} />
    </>
  );
}

export function renderNote(path: string) {
  // One client across the rerenders, so the second visit to a note is a cache
  // hit. Retries would only drag out the deliberate 404.
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const tree = (open: string) => (
    <QueryClientProvider client={queryClient}>
      <OpenNote path={open} />
    </QueryClientProvider>
  );

  const { container, rerender } = render(tree(path));

  return {
    text: () => container.querySelector(".cm-content")?.textContent,
    body: () => container.textContent,
    open: (next: string) => rerender(tree(next)),
    status: () =>
      container.querySelector("[data-testid='save-status']")?.getAttribute("aria-label"),
    spinner: () => container.querySelector("[data-testid='save-spinner']"),
    errorIcon: () => container.querySelector("[data-testid='save-error']"),
    press: (key: string, init?: KeyboardEventInit) =>
      fireEvent.keyDown(container.querySelector(".cm-content") as HTMLElement, { key, ...init }),
    // What an event from the vault does to an open note, and what the query
    // made of the read that followed. Both go through the client, because a
    // read that failed while the note stays on screen leaves nothing to wait on.
    reread: (target: string) => queryClient.invalidateQueries({ queryKey: ["note", target] }),
    readError: (target: string) => queryClient.getQueryState(["note", target])?.error,
  };
}
