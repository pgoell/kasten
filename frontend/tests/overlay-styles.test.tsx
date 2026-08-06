import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { NoteFinder } from "@/components/note-finder";
import { NoteSearch } from "@/components/note-search";

/**
 * The finder and the search are two panels doing one job, and they have to
 * read as one thing.
 *
 * They drifted once already: search grew wider than the finder when its rows
 * gained a path and a line number. Nothing but a shared table of classes stops
 * that happening again, and this is what says so out loud.
 */

const { searchNotes, fetchNote } = vi.hoisted(() => ({
  searchNotes: vi.fn().mockResolvedValue([]),
  fetchNote: vi.fn().mockResolvedValue(""),
}));
vi.mock("@/lib/api", () => ({ searchNotes, fetchNote }));

/** The box the panel draws, which is the child of the backdrop. */
function panelOf(label: string): HTMLElement {
  const dialog = screen.getByRole("dialog", { name: label });
  return dialog.firstElementChild as HTMLElement;
}

function renderBoth() {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <NoteFinder paths={["a.md"]} onOpen={() => {}} onClose={() => {}} />
      <NoteSearch onOpen={() => {}} onClose={() => {}} />
    </QueryClientProvider>,
  );
}

it("draws the finder and the search at the same size", () => {
  renderBoth();

  expect(panelOf("Search notes").className).toBe(panelOf("Find note").className);
});

it("backs both panels onto the same overlay", () => {
  renderBoth();

  const finder = screen.getByRole("dialog", { name: "Find note" });
  const search = screen.getByRole("dialog", { name: "Search notes" });

  expect(search.className).toBe(finder.className);
});
