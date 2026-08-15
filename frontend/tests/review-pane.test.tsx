import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { ReviewPane } from "@/components/review-pane";
import * as api from "@/lib/api";
import { stubCommands } from "./stub-commands";

/** Two decks with cards waiting, and one with nothing, which cannot be picked. */
const HITS = [
  { path: "a.md", line: 1, text: "#flashcards/alpha" },
  { path: "a.md", line: 2, text: "a::b" },
  { path: "b.md", line: 1, text: "#flashcards/beta" },
  { path: "b.md", line: 2, text: "c::d" },
  { path: "z.md", line: 1, text: "#flashcards/zeta" },
  { path: "z.md", line: 2, text: "e::f <!--SR:!2099-01-01,4,250-->" },
];

async function renderPane() {
  vi.spyOn(api, "fetchCards").mockResolvedValue(HITS);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <ReviewPane commands={stubCommands()} onClose={vi.fn()} />
    </QueryClientProvider>,
  );
  await screen.findByRole("button", { name: /alpha/ });
  return screen.getByLabelText("review");
}

describe("ReviewPane keys on the deck overview", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("walks the decks with j and k", async () => {
    const pane = await renderPane();

    fireEvent.keyDown(pane, { key: "j" });
    expect(document.activeElement).toHaveAttribute("data-deck", "alpha");

    fireEvent.keyDown(pane, { key: "j" });
    expect(document.activeElement).toHaveAttribute("data-deck", "beta");

    fireEvent.keyDown(pane, { key: "k" });
    expect(document.activeElement).toHaveAttribute("data-deck", "alpha");
  });

  it("stays on the first and the last rather than wrapping", async () => {
    const pane = await renderPane();

    fireEvent.keyDown(pane, { key: "k" });
    expect(document.activeElement).toHaveAttribute("data-deck", "alpha");

    // Past the end, and `zeta` has nothing waiting, so it is never landed on.
    fireEvent.keyDown(pane, { key: "j" });
    fireEvent.keyDown(pane, { key: "j" });
    expect(document.activeElement).toHaveAttribute("data-deck", "beta");
  });

  it("starts the sitting on l", async () => {
    const pane = await renderPane();
    vi.spyOn(api, "fetchNote").mockResolvedValue("#flashcards/beta\n\nc::d\n");

    fireEvent.keyDown(pane, { key: "j" });
    fireEvent.keyDown(pane, { key: "j" });
    fireEvent.keyDown(pane, { key: "l" });

    expect(await screen.findByTestId("review-card")).toHaveTextContent("c");
  });
});

describe("ReviewPane on a nested deck", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("draws the deck under its parent, called by its last part", async () => {
    vi.spyOn(api, "fetchCards").mockResolvedValue([
      { path: "d.md", line: 1, text: "#flashcards/databases/postgres" },
      { path: "d.md", line: 2, text: "a::b" },
    ]);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <ReviewPane commands={stubCommands()} onClose={vi.fn()} />
      </QueryClientProvider>,
    );

    const parent = await screen.findByRole("button", { name: /databases/ });
    const child = screen.getByRole("button", { name: /postgres/ });
    expect(parent).toHaveAttribute("data-deck", "databases");
    expect(child).toHaveAttribute("data-deck", "databases/postgres");
    expect(child.style.paddingLeft).toBe("1.5rem");
  });
});
