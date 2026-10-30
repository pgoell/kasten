import { render } from "@testing-library/react";
import { Editor } from "@/components/editor";
import { readClock } from "@/lib/clock";
import type { EditorCommands } from "@/lib/key-bindings";

/** Noon on a fixed day, where `pinClock` holds the clock. */
export const NOW = new Date(2026, 7, 10, 12);

/** Read from the same helper the command reads it from, so this cannot expire. */
export const TODAY = readClock(NOW).date;

/**
 * Hold the clock at `NOW` for every test in the file that calls it.
 *
 * A command stamps the date it reads at the keypress. A test that read today
 * once before then fails when midnight falls between the two (#1315), so a
 * file that compares against `TODAY` pins the clock to the day it names. Only
 * `Date` is held; timers run as they would.
 */
export function pinClock() {
  beforeEach(() => {
    vi.setSystemTime(NOW);
  });
  afterEach(() => {
    vi.useRealTimers();
  });
}

export function stubCommands() {
  return {
    toggleTree: vi.fn(),
    toggleArchive: vi.fn(),
    togglePreview: vi.fn(),
    closeNote: vi.fn(),
    showHelp: vi.fn(),
    openPalette: vi.fn(),
    createNote: vi.fn(),
    renameNote: vi.fn(),
    deleteNote: vi.fn(),
    restoreDeleted: vi.fn(),
    findNote: vi.fn(),
    searchNotes: vi.fn(),
    findTodos: vi.fn(),
    findBook: vi.fn(),
    findMeaning: vi.fn(),
    openTodos: vi.fn(),
    openLog: vi.fn(),
    openOverview: vi.fn(),
    openFinance: vi.fn(),
    showBacklinks: vi.fn(),
    showLinksOut: vi.fn(),
    openDaily: vi.fn(),
    logDrink: vi.fn(),
    logFood: vi.fn(),
    logWeight: vi.fn(),
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
    openRsvp: vi.fn(),
    rsvpFromHere: vi.fn(),
    uploadBook: vi.fn(),
    importNotes: vi.fn(),
    exportNote: vi.fn(),
    openReview: vi.fn(),
    openExam: vi.fn(),
    focusTree: vi.fn(),
    revealTree: vi.fn(),
    createTab: vi.fn(),
    openTerminal: vi.fn(),
    openChat: vi.fn(),
    importPage: vi.fn(),
    captureDump: vi.fn(),
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
    movePaneLeft: vi.fn(),
    movePaneDown: vi.fn(),
    movePaneUp: vi.fn(),
    movePaneRight: vi.fn(),
    zoomPane: vi.fn(),
  } satisfies EditorCommands;
}

export function content(container: HTMLElement): string {
  return (container.querySelector(".cm-content") as HTMLElement).textContent ?? "";
}

export function open(initialDoc: string, commands: EditorCommands = stubCommands(), path?: string) {
  const onChange = vi.fn();
  const onCycleTodo = vi.fn();
  const { container } = render(
    <Editor
      initialDoc={initialDoc}
      commands={commands}
      onChange={onChange}
      onCycleTodo={onCycleTodo}
      path={path}
    />,
  );

  return {
    container,
    editor: container.querySelector(".cm-content") as HTMLElement,
    onCycleTodo,
    /** The document itself, which the rendered text hides the marks of. */
    doc: () => (onChange.mock.lastCall?.[0] as string | undefined) ?? initialDoc,
  };
}
