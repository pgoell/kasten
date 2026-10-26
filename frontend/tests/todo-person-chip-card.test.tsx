/**
 * The person card over a todo that names the person as its assignee. The
 * card's own tests (`person-card.test.tsx`) draw a todo by a link in its words;
 * this pins the `👤 [[name]]` form the chip reads, so a change to either
 * reading that drops it fails here.
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { PersonFooter } from "@/components/person-card";
import * as api from "@/lib/api";

const PASCAL = "03 Areas/08 People/Pascal.md";
const DAILY = "01 Periodic/00 Daily/2026-10-25.md";
/** Pascal's note as the vault holds it: the frontmatter that makes it a person's card. */
const PASCAL_NOTE = "---\ntype: Person\n---\n\n# Pascal\n";

describe("PersonCard over an assignee", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("#809 A5 the person card lists an open todo assigned to them", async () => {
    vi.spyOn(api, "fetchNote").mockResolvedValue(PASCAL_NOTE);
    vi.spyOn(api, "fetchTodos").mockResolvedValue([
      { path: DAILY, line: 4, text: "- [ ] buy paint 👤 [[Pascal]]", project: null, shared: false },
    ]);
    vi.spyOn(api, "searchNotes").mockResolvedValue([]);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    // The footer reads the note's type, and draws the card only for a person.
    render(
      <QueryClientProvider client={client}>
        <PersonFooter path={PASCAL} paths={[PASCAL, DAILY]} onOpen={vi.fn()} />
      </QueryClientProvider>,
    );

    expect(await screen.findByRole("button", { name: /buy paint/ })).toBeInTheDocument();
  });
});
