import { QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { ReviewPane } from "@/components/review-pane";
import * as api from "@/lib/api";
import { shownCard } from "./review-card";
import { renderPane, seededClient, serveNotes } from "./review-pane-fixture";
import { stubCommands } from "./stub-commands";

const TWO = "#flashcards/beta\n\nc::d\n\ne::f\n";

/** One whole note, marked `#review`, which the pane offers as a deck of one card. */
const WHOLE = [{ path: "tls.md", line: 1, text: "#review" }];

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
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

it("#790 B1 a held space does not answer the revealed card again", async () => {
  const { pane, saved } = await sitBeta();
  fireEvent.keyDown(pane, { key: " " });
  expect(screen.getByTestId("review-back")).toHaveTextContent("d");

  fireEvent.keyDown(pane, { key: " ", repeat: true });
  await act(async () => {});

  expect(saved).not.toHaveBeenCalled();
});

it("#790 B1 a held 3 grades nothing after the first press", async () => {
  const { pane, saved } = await sitBeta();
  fireEvent.keyDown(pane, { key: " " });

  fireEvent.keyDown(pane, { key: "3", repeat: true });
  await act(async () => {});

  expect(saved).not.toHaveBeenCalled();
});

it("#790 B2 Enter on a focused grade button is left to the button", async () => {
  const { pane, saved } = await sitBeta();
  fireEvent.keyDown(pane, { key: " " });
  const again = screen.getByRole("button", { name: "Again" });
  again.focus();

  const notPrevented = fireEvent.keyDown(again, { key: "Enter" });
  await act(async () => {});

  // The native click is the button's to run, so the pane neither answers the key
  // nor stops the browser from running it.
  expect(notPrevented).toBe(true);
  expect(saved).not.toHaveBeenCalled();
});

it("#790 B5 one space does not grade a whole note, which is shown from the start", async () => {
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
  fireEvent.keyDown(pane, { key: " " });
  await act(async () => {});

  expect(saved).not.toHaveBeenCalled();
});
