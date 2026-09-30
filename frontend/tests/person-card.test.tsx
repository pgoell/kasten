/**
 * The card as it is drawn, over the two questions it asks the vault.
 *
 * `person.test.ts` pins the reading. What is left for here is what the card
 * does with it: the three sections, the row that opens the line it names, and
 * the sentence a person nothing links to gets instead of three empty headings.
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { PersonCard, PersonFooter } from "@/components/person-card";
import * as api from "@/lib/api";

const MAX = "03 Areas/08 People/Max Bosch.md";
const MEETING = "02 Projects/FDE/2026-09-28 FDE Check-in.md";
const DAILY = "01 Periodic/00 Daily/2026-09-30.md";
const PATHS = [MAX, MEETING, DAILY];

/** Every checkbox line in the vault, which is what `GET /api/todos` answers with. */
const TODOS = [
  { path: DAILY, line: 12, text: "- [ ] send [[Max Bosch]] the repo 📅 2026-10-02" },
  { path: DAILY, line: 13, text: "- [ ] something nobody is named in" },
];

/** Every line carrying the name, which is what `GET /api/search` answers with. */
const LINES = [
  { path: MEETING, line: 7, text: "[[Max Bosch]] and me, 20 min" },
  { path: DAILY, line: 49, text: "- ✅ 2026-09-29 paired with [[Max Bosch]] kt-8d19f6" },
];

function renderCard(todos = TODOS, lines = LINES, onOpen = vi.fn()) {
  vi.spyOn(api, "fetchTodos").mockResolvedValue(todos);
  vi.spyOn(api, "searchNotes").mockResolvedValue(lines);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <PersonCard person={MAX} paths={PATHS} onOpen={onOpen} />
    </QueryClientProvider>,
  );
  return onOpen;
}

describe("PersonCard", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("draws the open todos, the meetings and the done lines", async () => {
    renderCard();

    expect(
      await screen.findByRole("button", { name: /send Max Bosch the repo/ }),
    ).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: /FDE Check-in/ })).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: /paired with/ })).toBeInTheDocument();
    // The todo naming nobody belongs to another card, or to none.
    expect(screen.queryByRole("button", { name: /nobody is named/ })).not.toBeInTheDocument();
  });

  it("opens the line a row names", async () => {
    const onOpen = renderCard();

    fireEvent.click(await screen.findByRole("button", { name: /FDE Check-in/ }));

    expect(onOpen).toHaveBeenCalledWith(MEETING, 7);
  });

  it("says how the card fills when nothing links the person", async () => {
    renderCard([], []);

    expect(await screen.findByText(/nothing links \[\[Max Bosch\]\] yet/)).toBeInTheDocument();
  });
});

describe("PersonFooter", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  async function renderFooter(note: string) {
    vi.spyOn(api, "fetchNote").mockResolvedValue(note);
    vi.spyOn(api, "fetchTodos").mockResolvedValue(TODOS);
    vi.spyOn(api, "searchNotes").mockResolvedValue(LINES);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <PersonFooter path={MAX} paths={PATHS} onOpen={vi.fn()} />
      </QueryClientProvider>,
    );
    // The note is read before anything is decided, so wait for that read.
    await vi.waitFor(() => expect(api.fetchNote).toHaveBeenCalled());
  }

  it("draws the card under a person's note", async () => {
    await renderFooter("---\ntype: Person\n---\n# Max Bosch\n");

    expect(await screen.findByRole("button", { name: /FDE Check-in/ })).toBeInTheDocument();
  });

  it("draws nothing under every other note", async () => {
    await renderFooter("---\ntype: Note\n---\n# Max Bosch\n");

    expect(screen.queryByRole("button", { name: /FDE Check-in/ })).not.toBeInTheDocument();
  });
});
