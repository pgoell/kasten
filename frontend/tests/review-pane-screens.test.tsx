import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import * as api from "@/lib/api";
import { shownCard } from "./review-card";
import { renderPane } from "./review-pane-fixture";

const TWO = "#flashcards/beta\n\nc::d\n\ne::f\n";

/**
 * The pane on the first card of `beta`, its writes kept. Each card of the note is
 * fresh, so the first answer of each is the one the buttons draw.
 */
async function sitBeta(note = TWO) {
  const pane = await renderPane();
  const saved = vi
    .spyOn(api, "saveNote")
    .mockImplementation(async (path, content) => ({ path, content }));
  vi.spyOn(api, "fetchNote").mockImplementation((path) =>
    Promise.resolve(path === "b.md" ? note : ""),
  );
  fireEvent.keyDown(pane, { key: "j" });
  fireEvent.keyDown(pane, { key: "j" });
  fireEvent.keyDown(pane, { key: "l" });
  expect(await shownCard()).toHaveTextContent("c");
  return { pane, saved };
}

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

it.each(["on", "off"])(
  "#790 A7 Enter shows the answer and a second Enter grades it Good, vim %s",
  async (vim) => {
    localStorage.setItem("kasten.vim", vim);
    const { pane, saved } = await sitBeta();

    fireEvent.keyDown(pane, { key: "Enter" });
    expect(screen.getByTestId("review-back")).toHaveTextContent("d");
    fireEvent.keyDown(pane, { key: "Enter" });

    // A fresh card's first Good is a day out, which the note writes as a gap of 1.
    await waitFor(() => expect(saved).toHaveBeenCalledOnce());
    expect(saved.mock.calls[0]?.[1]).toMatch(/<!--SR:!\d{4}-\d{2}-\d{2},1,250-->/);
    await waitFor(() => expect(screen.getByTestId("review-card")).toHaveTextContent("e"));
  },
);

it.each(["on", "off"])(
  "#790 A7 keys 1 to 4 grade the card, whose buttons show the interval each writes, vim %s",
  async (vim) => {
    localStorage.setItem("kasten.vim", vim);
    const { pane, saved } = await sitBeta();

    fireEvent.keyDown(pane, { key: "Enter" });
    expect(screen.getByRole("button", { name: "Again" })).toHaveAccessibleDescription("today");

    // Again sends the card to the back of the sitting, so the next one is `e`.
    fireEvent.keyDown(pane, { key: "1" });
    await waitFor(() => expect(saved).toHaveBeenCalledOnce());
    await waitFor(() => expect(screen.getByTestId("review-card")).toHaveTextContent("e"));

    fireEvent.keyDown(pane, { key: "Enter" });
    fireEvent.keyDown(pane, { key: "3" });
    await waitFor(() => expect(saved).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByTestId("review-card")).toHaveTextContent("c"));
  },
);

it.each(["on", "off"])(
  "#790 A7 s parks the card and n opens a new question, vim %s",
  async (vim) => {
    localStorage.setItem("kasten.vim", vim);
    const { pane } = await sitBeta();

    expect(screen.getByRole("button", { name: "Park this card" })).toBeInTheDocument();
    fireEvent.keyDown(pane, { key: "s" });
    expect(screen.getByTestId("review-card")).toHaveTextContent("e");

    fireEvent.keyDown(pane, { key: "n" });
    expect(screen.getByRole("textbox", { name: "a new question" })).toBeInTheDocument();
  },
);

it.each(["on", "off"])(
  "#790 A7 u takes back the rating and h goes back to the decks, vim %s",
  async (vim) => {
    localStorage.setItem("kasten.vim", vim);
    const { pane, saved } = await sitBeta();

    fireEvent.keyDown(pane, { key: "Enter" });
    expect(screen.getByRole("button", { name: "Good" })).toHaveAttribute("data-default");
    fireEvent.keyDown(pane, { key: "3" });
    await waitFor(() => expect(saved).toHaveBeenCalledOnce());
    expect(screen.getByTestId("review-card")).toHaveTextContent("e");

    fireEvent.keyDown(pane, { key: "u" });
    await act(async () => {});
    await waitFor(() => expect(screen.getByTestId("review-card")).toHaveTextContent("c"));

    fireEvent.keyDown(pane, { key: "h" });
    expect(screen.queryByTestId("review-card")).not.toBeInTheDocument();
    expect(await screen.findByRole("button", { name: /^alpha/ })).toBeInTheDocument();
  },
);
