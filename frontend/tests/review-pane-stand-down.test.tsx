import { QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { ReviewPane } from "@/components/review-pane";
import * as api from "@/lib/api";
import { shownCard } from "./review-card";
import { HITS, seededClient, serveNotes } from "./review-pane-fixture";
import { stubCommands } from "./stub-commands";

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
  vi.spyOn(api, "fetchCards").mockResolvedValue(HITS);
  vi.spyOn(api, "fetchReviewLimits").mockResolvedValue({
    new_per_day: null,
    reviews_per_day: null,
  });
  serveNotes(HITS);
});

function renderPane(onClose = vi.fn()) {
  render(
    <QueryClientProvider client={seededClient(HITS)}>
      <ReviewPane commands={stubCommands()} onClose={onClose} onOpen={vi.fn()} />
    </QueryClientProvider>,
  );
  screen.getByRole("button", { name: /^alpha/ });
  return screen.getByLabelText("review");
}

it("q closes the pane", () => {
  const onClose = vi.fn();
  const pane = renderPane(onClose);

  fireEvent.keyDown(pane, { key: "q" });

  expect(onClose).toHaveBeenCalledOnce();
});

it("a key with Ctrl held leaves the deck rows alone", () => {
  const pane = renderPane();

  fireEvent.keyDown(pane, { key: "j", ctrlKey: true });

  expect(document.activeElement).not.toHaveAttribute("data-deck");
});

it("a grade key typed into the capture line grades nothing", async () => {
  const pane = renderPane();
  const saved = vi
    .spyOn(api, "saveNote")
    .mockImplementation(async (path, content) => ({ path, content }));
  fireEvent.keyDown(pane, { key: "j" });
  fireEvent.keyDown(pane, { key: "l" });
  await shownCard();
  fireEvent.keyDown(pane, { key: "Enter" });
  fireEvent.keyDown(pane, { key: "n" });

  fireEvent.keyDown(screen.getByLabelText("a new question"), { key: "3" });
  await act(async () => {});

  expect(saved).not.toHaveBeenCalled();
});
