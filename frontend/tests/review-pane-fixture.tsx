import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { ReviewPane } from "@/components/review-pane";
import * as api from "@/lib/api";
import { deckNotes } from "@/lib/review";
import { stubCommands } from "./stub-commands";

/** Two decks with cards waiting, and one with nothing, which cannot be picked. */
export const HITS = [
  { path: "a.md", line: 1, text: "#flashcards/alpha" },
  { path: "a.md", line: 2, text: "a::b" },
  { path: "b.md", line: 1, text: "#flashcards/beta" },
  { path: "b.md", line: 2, text: "c::d" },
  { path: "z.md", line: 1, text: "#flashcards/zeta" },
  { path: "z.md", line: 2, text: "e::f <!--SR:!2099-01-01,4,250-->" },
];

/**
 * Each note as the lines the scan found in it, which is what the overview reads.
 *
 * The counts come off the note, so the scan names the notes and this is the
 * text of each. A sitting's own `fetchNote` mock, set later, replaces it.
 */
export function serveNotes(hits: api.SearchHit[]) {
  vi.spyOn(api, "fetchNote").mockImplementation((path) => Promise.resolve(noteOf(hits, path)));
}

export function noteOf(hits: api.SearchHit[], path: string): string {
  return hits
    .filter((hit) => hit.path === path)
    .map((hit) => hit.text)
    .join("\n");
}

/**
 * A client already holding the scan and each deck note, as `renderPane` says why.
 *
 * Each note is the lines the scan found in it. A test whose `fetchNote` serves
 * fuller text gets that on the refetch at mount, which counts the same.
 */
export function seededClient(hits: api.SearchHit[], archive = false) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(["cards", archive], hits);
  for (const path of deckNotes(hits)) {
    client.setQueryData(["cards", "note", path], noteOf(hits, path));
  }
  return client;
}

/**
 * The pane on the deck overview, its decks drawn on the first render.
 *
 * The cache holds the scan and every deck note before the pane mounts. Left
 * empty, the rows wait on the scan, a `setTimeout` for the result to reach
 * React, a re-render that only then asks for the notes, those reads, another
 * `setTimeout` and another re-render, all inside `findBy`'s one second. That
 * chain ran out of the second on a loaded machine (#522). The reads still go
 * out, as a refetch on mount, and `ReviewDecks reading the deck notes` below
 * is where the wait itself is tested.
 */
export async function renderPane(commands = stubCommands()) {
  vi.spyOn(api, "fetchCards").mockResolvedValue(HITS);
  serveNotes(HITS);
  const client = seededClient(HITS);
  render(
    <QueryClientProvider client={client}>
      <ReviewPane commands={commands} onClose={vi.fn()} onOpen={vi.fn()} />
    </QueryClientProvider>,
  );
  // `get` and not `find`: nothing is left to wait on.
  // Anchored, because the Start button names the first deck too.
  screen.getByRole("button", { name: /^alpha/ });
  return screen.getByLabelText("review");
}
