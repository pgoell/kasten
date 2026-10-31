import { QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { ReviewPane } from "@/components/review-pane";
import * as api from "@/lib/api";
import { shownCard } from "./review-card";
import { HITS, renderPane, seededClient, serveNotes } from "./review-pane-fixture";
import { stubCommands } from "./stub-commands";

const TWO = "#flashcards/beta\n\nc::d\n\ne::f\n";

/** One whole note, marked `#review`, which the pane offers as a deck of one card. */
const WHOLE = [{ path: "tls.md", line: 1, text: "#review" }];

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
  vi.spyOn(api, "fetchReviewLimits").mockResolvedValue({
    new_per_day: null,
    reviews_per_day: null,
  });
});

/** The pane on the first card of `beta`, its writes kept. */
async function sitBeta() {
  const pane = await renderPane();
  const saved = vi
    .spyOn(api, "saveNote")
    .mockImplementation(async (path, content) => ({ path, content }));
  vi.spyOn(api, "fetchNote").mockImplementation((path) =>
    Promise.resolve(path === "b.md" ? TWO : ""),
  );
  fireEvent.keyDown(pane, { key: "j" });
  fireEvent.keyDown(pane, { key: "j" });
  fireEvent.keyDown(pane, { key: "l" });
  expect(await shownCard()).toHaveTextContent("c");
  return { pane, saved };
}

it("#790 B1 a held Enter does not answer the revealed card again", async () => {
  const { pane, saved } = await sitBeta();
  fireEvent.keyDown(pane, { key: "Enter" });
  expect(screen.getByTestId("review-back")).toHaveTextContent("d");

  fireEvent.keyDown(pane, { key: "Enter", repeat: true });
  await act(async () => {});

  expect(saved).not.toHaveBeenCalled();
});

it("#790 B1 a held 3 grades nothing after the first press", async () => {
  const { pane, saved } = await sitBeta();
  fireEvent.keyDown(pane, { key: "Enter" });

  fireEvent.keyDown(pane, { key: "3", repeat: true });
  await act(async () => {});

  expect(saved).not.toHaveBeenCalled();
});

it("#790 R8 Enter on a focused grade button on the answer side writes nothing and is stopped", async () => {
  const { pane, saved } = await sitBeta();
  fireEvent.keyDown(pane, { key: "Enter" });
  const again = screen.getByRole("button", { name: "Again" });
  again.focus();

  // The pane stops the key, which is what stops the button's own click in a
  // browser, and grades nothing: the answer side of a button is the button's.
  const notPrevented = fireEvent.keyDown(again, { key: "Enter" });
  await act(async () => {});

  expect(notPrevented).toBe(false);
  expect(saved).not.toHaveBeenCalled();
});

it("#790 R8 Enter after a click on Park this card reveals the next card and writes nothing more", async () => {
  const { saved } = await sitBeta();
  const park = screen.getByRole("button", { name: "Park this card" });
  park.focus();
  fireEvent.click(park);
  await waitFor(() => expect(saved).toHaveBeenCalledOnce());
  await waitFor(() => expect(screen.getByTestId("review-card")).toHaveTextContent("e"));

  fireEvent.keyDown(document.activeElement ?? park, { key: "Enter" });

  expect(await screen.findByTestId("review-back")).toHaveTextContent("f");
  await act(async () => {});
  expect(saved).toHaveBeenCalledOnce();
});

it("#790 R8 a held Enter after a click on Park this card writes nothing and is stopped", async () => {
  const { saved } = await sitBeta();
  const park = screen.getByRole("button", { name: "Park this card" });
  park.focus();
  fireEvent.click(park);
  await waitFor(() => expect(saved).toHaveBeenCalledOnce());

  const notPrevented = fireEvent.keyDown(park, { key: "Enter", repeat: true });
  await act(async () => {});

  expect(notPrevented).toBe(false);
  expect(saved).toHaveBeenCalledOnce();
});

it("#790 R8 Space on a focused deck row opens the leader, so the next key reaches it", async () => {
  const commands = stubCommands();
  const pane = await renderPane(commands);
  fireEvent.keyDown(pane, { key: "j" });

  fireEvent.keyDown(document.activeElement ?? pane, { key: " " });
  fireEvent.keyDown(document.activeElement ?? pane, { key: "b" });

  expect(commands.toggleTree).toHaveBeenCalledOnce();
  expect(screen.queryByTestId("review-card")).not.toBeInTheDocument();
});

it("#790 R8 Enter after an undo on a whole note writes nothing", async () => {
  vi.spyOn(api, "fetchCards").mockResolvedValue(WHOLE);
  serveNotes(WHOLE);
  render(
    <QueryClientProvider client={seededClient(WHOLE)}>
      <ReviewPane commands={stubCommands()} onClose={vi.fn()} onOpen={vi.fn()} />
    </QueryClientProvider>,
  );
  const pane = screen.getByLabelText("review");
  await waitFor(() =>
    expect(within(pane).getByRole("button", { name: /^tls/ })).toBeInTheDocument(),
  );
  const saved = vi
    .spyOn(api, "saveNote")
    .mockImplementation(async (path, content) => ({ path, content }));
  fireEvent.keyDown(pane, { key: "j" });
  fireEvent.keyDown(pane, { key: "l" });
  await waitFor(() => expect(within(pane).getByTestId("review-card")).toBeInTheDocument());

  // The whole note is graded, then taken back: its answer is up again, but
  // nothing was turned over, so an Enter grades nothing.
  fireEvent.keyDown(pane, { key: "3" });
  await waitFor(() => expect(saved).toHaveBeenCalledOnce());
  fireEvent.keyDown(pane, { key: "u" });
  // The card comes back, and with it the revealed flag, once the undo's write lands.
  await waitFor(() => expect(within(pane).getByTestId("review-card")).toBeInTheDocument());
  await act(async () => {});
  fireEvent.keyDown(pane, { key: "Enter" });
  await act(async () => {});

  expect(saved).toHaveBeenCalledTimes(2);
});

it("#927 a grade key pressed the moment a whole note's card shows grades it", async () => {
  vi.spyOn(api, "fetchCards").mockResolvedValue(WHOLE);
  serveNotes(WHOLE);
  render(
    <QueryClientProvider client={seededClient(WHOLE)}>
      <ReviewPane commands={stubCommands()} onClose={vi.fn()} onOpen={vi.fn()} />
    </QueryClientProvider>,
  );
  const pane = screen.getByLabelText("review");
  await waitFor(() =>
    expect(within(pane).getByRole("button", { name: /^tls/ })).toBeInTheDocument(),
  );
  const saved = vi
    .spyOn(api, "saveNote")
    .mockImplementation(async (path, content) => ({ path, content }));

  // Pressed from the observer, which runs as the card commits and before React
  // flushes passive effects, so the key meets the pane at the moment it shows (#927).
  const observer = new MutationObserver(() => {
    if (pane.querySelector('[data-testid="review-card"]') === null) return;
    observer.disconnect();
    fireEvent.keyDown(pane, { key: "3" });
  });
  observer.observe(pane, { subtree: true, childList: true });
  fireEvent.keyDown(pane, { key: "j" });
  fireEvent.keyDown(pane, { key: "l" });

  await waitFor(() => expect(saved).toHaveBeenCalledOnce());
});

it("#790 B5 one Enter does not grade a whole note, which is shown from the start", async () => {
  vi.spyOn(api, "fetchCards").mockResolvedValue(WHOLE);
  serveNotes(WHOLE);
  render(
    <QueryClientProvider client={seededClient(WHOLE)}>
      <ReviewPane commands={stubCommands()} onClose={vi.fn()} onOpen={vi.fn()} />
    </QueryClientProvider>,
  );
  const pane = screen.getByLabelText("review");
  await waitFor(() =>
    expect(within(pane).getByRole("button", { name: /^tls/ })).toBeInTheDocument(),
  );
  const saved = vi
    .spyOn(api, "saveNote")
    .mockImplementation(async (path, content) => ({ path, content }));

  fireEvent.keyDown(pane, { key: "j" });
  fireEvent.keyDown(pane, { key: "l" });
  await waitFor(() => expect(within(pane).getByTestId("review-card")).toBeInTheDocument());
  fireEvent.keyDown(pane, { key: "Enter" });
  await act(async () => {});

  expect(saved).not.toHaveBeenCalled();
});

it("Space with a card on screen opens the leader and shows no answer", async () => {
  const commands = stubCommands();
  const pane = await renderPane(commands);
  vi.spyOn(api, "fetchNote").mockImplementation((path) =>
    Promise.resolve(path === "b.md" ? TWO : ""),
  );
  fireEvent.keyDown(pane, { key: "j" });
  fireEvent.keyDown(pane, { key: "j" });
  fireEvent.keyDown(pane, { key: "l" });
  expect(await shownCard()).toHaveTextContent("c");

  fireEvent.keyDown(pane, { key: " " });
  fireEvent.keyDown(pane, { key: "b" });

  expect(commands.toggleTree).toHaveBeenCalledOnce();
  expect(screen.queryByTestId("review-back")).not.toBeInTheDocument();
});

it("a click on Start leaves the keys in the pane, so Enter shows the answer", async () => {
  const pane = await renderPane();
  const start = await within(pane).findByRole("button", { name: "Start with alpha" });
  start.focus();
  fireEvent.click(start);
  await shownCard();

  expect(document.activeElement).toBe(pane);
  fireEvent.keyDown(document.activeElement ?? document.body, { key: "Enter" });
  expect(screen.getByTestId("review-back")).toBeInTheDocument();
});

/** The pane on the overview, with `onClose` handed in so a test can see it called. */
function renderClosable(onClose = vi.fn()) {
  vi.spyOn(api, "fetchCards").mockResolvedValue(HITS);
  serveNotes(HITS);
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
  const pane = renderClosable(onClose);

  fireEvent.keyDown(pane, { key: "q" });

  expect(onClose).toHaveBeenCalledOnce();
});

it("a key with Ctrl held leaves the deck rows alone", () => {
  const pane = renderClosable();

  fireEvent.keyDown(pane, { key: "j", ctrlKey: true });

  expect(document.activeElement).not.toHaveAttribute("data-deck");
});

it("a grade key typed into the capture line grades nothing", async () => {
  const pane = renderClosable();
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
