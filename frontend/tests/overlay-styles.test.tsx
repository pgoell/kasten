import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { NoteFinder } from "@/components/note-finder";
import { NoteSearch } from "@/components/note-search";

/**
 * The finder and the line lists (backlinks and todos) are panels doing one
 * job, and they have to read as one thing.
 *
 * They drifted once already: the list grew wider than the finder when its rows
 * gained a path and a line number. Nothing but a shared table of classes stops
 * that happening again, and this is what says so out loud. The search page
 * draws its own panel now, so it is not compared here.
 */

const { searchNotes, fetchNote, fetchMentions, fetchTodos } = vi.hoisted(() => ({
  searchNotes: vi.fn().mockResolvedValue([]),
  fetchNote: vi.fn().mockResolvedValue(""),
  fetchMentions: vi.fn().mockResolvedValue([]),
  fetchTodos: vi.fn().mockResolvedValue([]),
}));
vi.mock("@/lib/api", () => ({ searchNotes, fetchNote, fetchMentions, fetchTodos }));

/** The box the panel draws, which is the child of the backdrop. */
function panelOf(label: string): HTMLElement {
  const dialog = screen.getByRole("dialog", { name: label });
  return dialog.firstElementChild as HTMLElement;
}

function renderBoth() {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <NoteFinder paths={["a.md"]} onOpen={() => {}} onClose={() => {}} />
      <NoteSearch
        backlinksOf="reading/borges.md"
        paths={["a.md"]}
        onOpen={() => {}}
        onClose={() => {}}
      />
    </QueryClientProvider>,
  );
}

// Why: the finder and the backlinks panel share the one table of classes, so
// they must draw at the same width.
it("draws the finder and the backlinks panel at the same size", () => {
  renderBoth();

  expect(panelOf("Backlinks").className).toBe(panelOf("Find note").className);
});

// Why: both panels sit on the one backdrop, so the same sheet holds each.
it("backs both panels onto the same overlay", () => {
  renderBoth();

  const finder = screen.getByRole("dialog", { name: "Find note" });
  const backlinks = screen.getByRole("dialog", { name: "Backlinks" });

  expect(backlinks.className).toBe(finder.className);
});
