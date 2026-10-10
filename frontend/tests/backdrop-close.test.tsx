import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { ClipPrompt } from "@/components/clip-prompt";
import { CommandPalette } from "@/components/command-palette";
import { DumpPrompt } from "@/components/dump-prompt";
import { KeyHelp } from "@/components/key-help";
import { NoteFinder } from "@/components/note-finder";
import { NotePrompt } from "@/components/note-prompt";
import { NoteSearch } from "@/components/note-search";
import { TerminalPrompt } from "@/components/terminal-prompt";
import { TodoPrompt } from "@/components/todo-prompt";

vi.mock("@/lib/api", () => ({
  fetchNote: vi.fn().mockResolvedValue(""),
  searchNotes: vi.fn().mockResolvedValue([]),
  fetchTodos: vi.fn().mockResolvedValue([]),
  createNote: vi.fn(),
  renameNote: vi.fn(),
  moveFolder: vi.fn(),
}));

/**
 * Every panel over the app, and the one way out of each that needs no key.
 *
 * One table rather than a test per file: the rule is one rule, and a panel
 * added later without it is a panel a phone cannot leave.
 */
const OVERLAYS: [string, (onClose: () => void) => ReactElement][] = [
  [
    "the palette",
    (onClose) => <CommandPalette entries={[{ label: "Bold", run: vi.fn() }]} onClose={onClose} />,
  ],
  ["the finder", (onClose) => <NoteFinder paths={["a.md"]} onOpen={vi.fn()} onClose={onClose} />],
  ["the search", (onClose) => <NoteSearch onOpen={vi.fn()} onClose={onClose} />],
  [
    "the note prompt",
    (onClose) => (
      <NotePrompt mode="create" paths={["a.md"]} startPath="" onOpen={vi.fn()} onClose={onClose} />
    ),
  ],
  [
    "the todo prompt",
    (onClose) => <TodoPrompt onAdd={vi.fn()} onClose={onClose} today="2026-10-10" />,
  ],
  [
    "the dump prompt",
    (onClose) => <DumpPrompt onCapture={vi.fn()} onClose={onClose} today="2026-10-10" />,
  ],
  ["the clip prompt", (onClose) => <ClipPrompt onClip={vi.fn()} onClose={onClose} />],
  [
    "the terminal prompt",
    (onClose) => <TerminalPrompt sessions={[]} onOpen={vi.fn()} onClose={onClose} />,
  ],
  ["the key help", (onClose) => <KeyHelp onClose={onClose} />],
];

describe.each(OVERLAYS)("%s", (_name, draw) => {
  function open() {
    const onClose = vi.fn();
    render(<QueryClientProvider client={new QueryClient()}>{draw(onClose)}</QueryClientProvider>);
    const sheet = screen.getByRole("dialog");
    return { onClose, sheet, panel: sheet.firstElementChild as HTMLElement };
  }

  it("closes on a press of the sheet around the panel", () => {
    const { onClose, sheet } = open();

    fireEvent.mouseDown(sheet);

    expect(onClose).toHaveBeenCalledOnce();
  });

  it("stays open on a press inside the panel", () => {
    const { onClose, panel } = open();

    fireEvent.mouseDown(panel);
    for (const inside of panel.querySelectorAll("*")) fireEvent.mouseDown(inside);

    expect(onClose).not.toHaveBeenCalled();
  });
});
