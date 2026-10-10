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

type Draw = (onClose: () => void) => ReactElement;

/** The panels whose input is a draft: what is typed there is lost when one closes. */
const DRAFTS: [string, Draw][] = [
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
];

/**
 * Every panel over the app, and the one way out of each that needs no key.
 *
 * One table rather than a test per file: the rule is one rule, and a panel
 * added later without it is a panel a phone cannot leave.
 */
const OVERLAYS: [string, Draw][] = [
  [
    "the palette",
    (onClose) => <CommandPalette entries={[{ label: "Bold", run: vi.fn() }]} onClose={onClose} />,
  ],
  ["the finder", (onClose) => <NoteFinder paths={["a.md"]} onOpen={vi.fn()} onClose={onClose} />],
  ["the search", (onClose) => <NoteSearch onOpen={vi.fn()} onClose={onClose} />],
  ...DRAFTS,
  ["the key help", (onClose) => <KeyHelp onClose={onClose} />],
];

function open(draw: Draw) {
  const onClose = vi.fn();
  render(<QueryClientProvider client={new QueryClient()}>{draw(onClose)}</QueryClientProvider>);
  const sheet = screen.getByRole("dialog");
  return { onClose, sheet, panel: sheet.firstElementChild as HTMLElement };
}

describe.each(OVERLAYS)("%s", (_name, draw) => {
  it("closes on a press and release on the sheet around the panel", () => {
    const { onClose, sheet } = open(draw);

    fireEvent.mouseDown(sheet);
    // Still up at the press: the release and the click that follow would
    // otherwise land on whatever lay under the sheet.
    expect(onClose).not.toHaveBeenCalled();
    // The browser's own step of the press, which moves the focus, is left to
    // run, the sheet being what should hold it until the click.
    expect(fireEvent.mouseDown(sheet)).toBe(true);
    fireEvent.mouseUp(sheet);
    fireEvent.click(sheet);

    expect(onClose).toHaveBeenCalledOnce();
  });

  it("stays open on a press inside the panel", () => {
    const { onClose, panel } = open(draw);

    // Every element pressed, and the panel itself clicked: a click on a row
    // or a button is that row's own business, and may well close the panel.
    for (const inside of panel.querySelectorAll("*")) fireEvent.mouseDown(inside);
    fireEvent.mouseDown(panel);
    fireEvent.click(panel);

    expect(onClose).not.toHaveBeenCalled();
  });

  it("stays open when a drag out of the panel is let go over the sheet", () => {
    const { onClose, sheet, panel } = open(draw);

    // The click of a drag lands on what its two ends have in common.
    fireEvent.mouseDown(panel);
    fireEvent.mouseUp(sheet);
    fireEvent.click(sheet);

    expect(onClose).not.toHaveBeenCalled();
  });

  it("stays open when a press on the sheet is let go inside the panel", () => {
    const { onClose, sheet, panel } = open(draw);

    fireEvent.mouseDown(sheet);
    fireEvent.mouseUp(panel);
    fireEvent.click(sheet);

    expect(onClose).not.toHaveBeenCalled();
  });
});

describe.each(DRAFTS)("%s", (_name, draw) => {
  it("keeps what was typed when the sheet is pressed, and still closes on Escape", () => {
    const { onClose, sheet } = open(draw);
    const field = sheet.querySelector("input") as HTMLInputElement;

    fireEvent.change(field, { target: { value: "half a thought" } });
    fireEvent.mouseDown(sheet);
    fireEvent.mouseUp(sheet);
    fireEvent.click(sheet);
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.keyDown(field, { key: "Escape" });
    expect(onClose).toHaveBeenCalledOnce();
  });
});

it("closes a rename nobody has typed into, the path it opens on being no draft", () => {
  const { onClose, sheet } = open((close) => (
    <NotePrompt mode="rename" paths={["a.md"]} startPath="a.md" onOpen={vi.fn()} onClose={close} />
  ));

  fireEvent.mouseDown(sheet);
  fireEvent.mouseUp(sheet);
  fireEvent.click(sheet);

  expect(onClose).toHaveBeenCalledOnce();
});
