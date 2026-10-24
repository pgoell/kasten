import { QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { ReviewPane } from "@/components/review-pane";
import * as api from "@/lib/api";
import { HITS, seededClient, serveNotes } from "./review-pane-fixture";
import { stubCommands } from "./stub-commands";

const TWO = "#flashcards/beta\n\nc::d\n\ne::f\n";

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

it("#790 A16 a key grades the card of the focused pane and leaves the pane beside it alone", async () => {
  vi.spyOn(api, "fetchCards").mockResolvedValue(HITS);
  serveNotes(HITS);
  render(
    <QueryClientProvider client={seededClient(HITS)}>
      <ReviewPane commands={stubCommands()} onClose={vi.fn()} onOpen={vi.fn()} />
      <ReviewPane commands={stubCommands()} onClose={vi.fn()} onOpen={vi.fn()} />
    </QueryClientProvider>,
  );
  const [one, two] = screen.getAllByLabelText("review");
  if (one === undefined || two === undefined) throw new Error("two review panes expected");
  await waitFor(() =>
    expect(within(one).getByRole("button", { name: /^beta/ })).toBeInTheDocument(),
  );
  await waitFor(() =>
    expect(within(two).getByRole("button", { name: /^beta/ })).toBeInTheDocument(),
  );

  const saved = vi
    .spyOn(api, "saveNote")
    .mockImplementation(async (path, content) => ({ path, content }));
  vi.spyOn(api, "fetchNote").mockImplementation((path) =>
    Promise.resolve(path === "b.md" ? TWO : ""),
  );

  // Both panes sit beta, so each shows its first card.
  for (const pane of [one, two]) {
    fireEvent.keyDown(pane, { key: "j" });
    fireEvent.keyDown(pane, { key: "j" });
    fireEvent.keyDown(pane, { key: "l" });
  }
  await waitFor(() => expect(within(one).getByTestId("review-card")).toHaveTextContent("c"));
  await waitFor(() => expect(within(two).getByTestId("review-card")).toHaveTextContent("c"));

  // The focused pane gets the keys: Enter shows its answer, and 3 grades it.
  fireEvent.keyDown(one, { key: "Enter" });
  expect(within(one).getByTestId("review-back")).toHaveTextContent("d");
  fireEvent.keyDown(one, { key: "3" });

  await waitFor(() => expect(saved).toHaveBeenCalledOnce());
  await waitFor(() => expect(within(one).getByTestId("review-card")).toHaveTextContent("e"));
  expect(within(two).getByTestId("review-card")).toHaveTextContent("c");
  expect(within(two).queryByTestId("review-back")).not.toBeInTheDocument();
});
