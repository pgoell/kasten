import { QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { ReviewPane } from "@/components/review-pane";
import * as api from "@/lib/api";
import { shownCard } from "./review-card";
import { renderPane, seededClient, serveNotes } from "./review-pane-fixture";
import { stubCommands } from "./stub-commands";

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
  vi.spyOn(api, "fetchReviewLimits").mockResolvedValue({
    new_per_day: null,
    reviews_per_day: null,
  });
});

describe("ReviewPane Enter on the rows", () => {
  it("#1166 A2 Enter on a deck row focused by j opens its sitting", async () => {
    const pane = await renderPane();
    vi.spyOn(api, "fetchNote").mockResolvedValue("#flashcards/beta\n\nc::d\n");

    fireEvent.keyDown(pane, { key: "j" });
    fireEvent.keyDown(pane, { key: "j" });
    fireEvent.keyDown(pane, { key: "Enter" });

    expect(await shownCard()).toHaveTextContent("c");
  });

  it("#1166 I4 after Enter opens a deck the pane keeps the keys, so the next Enter shows the answer", async () => {
    const pane = await renderPane();
    vi.spyOn(api, "fetchNote").mockResolvedValue("#flashcards/beta\n\nc::d\n");

    fireEvent.keyDown(pane, { key: "j" });
    fireEvent.keyDown(pane, { key: "j" });
    fireEvent.keyDown(pane, { key: "Enter" });
    await shownCard();

    expect(document.activeElement).toBe(pane);
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Enter" });
    expect(screen.getByTestId("review-back")).toBeInTheDocument();
  });

  it("#1166 A3 Enter on a parked row focused by j opens its note, as o does", async () => {
    const hits = [
      { path: "a.md", line: 1, text: "#flashcards/alpha" },
      { path: "a.md", line: 2, text: "a::b" },
      { path: "a.md", line: 3, text: "What is a VPC?::A private cloud !suspended" },
    ];
    vi.spyOn(api, "fetchCards").mockResolvedValue(hits);
    serveNotes(hits);
    const onOpen = vi.fn();
    const client = seededClient(hits);
    render(
      <QueryClientProvider client={client}>
        <ReviewPane commands={stubCommands()} onClose={vi.fn()} onOpen={onOpen} />
      </QueryClientProvider>,
    );
    screen.getByRole("button", { name: /^alpha/ });
    const pane = screen.getByLabelText("review");
    fireEvent.keyDown(pane, { key: "p" });
    await screen.findByText("What is a VPC?");

    fireEvent.keyDown(pane, { key: "j" });
    fireEvent.keyDown(pane, { key: "Enter" });

    expect(onOpen).toHaveBeenCalledWith("a.md");
  });

  it("#1166 G1 Enter on a focused fold arrow on the decks screen presses nothing and is stopped", async () => {
    // Green on main by design: the fold arrow's Enter was already stopped and
    // pressed nothing. This keeps the fix from pressing it too.
    const nested = [
      { path: "d.md", line: 1, text: "#flashcards/databases/postgres" },
      { path: "d.md", line: 2, text: "a::b" },
    ];
    vi.spyOn(api, "fetchCards").mockResolvedValue(nested);
    serveNotes(nested);
    const client = seededClient(nested);
    render(
      <QueryClientProvider client={client}>
        <ReviewPane commands={stubCommands()} onClose={vi.fn()} onOpen={vi.fn()} />
      </QueryClientProvider>,
    );
    const toggle = await screen.findByRole("button", { name: "unfold databases" });
    toggle.focus();

    const notPrevented = fireEvent.keyDown(toggle, { key: "Enter" });

    expect(notPrevented).toBe(false);
    expect(screen.getByRole("button", { name: "unfold databases" })).toBeInTheDocument();
  });
});
