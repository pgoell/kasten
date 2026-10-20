import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, createRouter, RouterProvider } from "@tanstack/react-router";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import * as api from "@/lib/api";
import { routeTree } from "@/routeTree.gen";
import { COARSE, NARROW, stubMatchMedia } from "./match-media";
import { shownCard } from "./review-card";

/**
 * `/review` mounted, because nothing else renders the phone's half of it.
 *
 * The pane tests cover the keys and the route has none: every action here is a
 * button, and a button that exists in the pane and not on this page is the
 * failure this file is for.
 */
const HITS = [
  { path: "a.md", line: 1, text: "#flashcards/alpha" },
  { path: "a.md", line: 2, text: "a::b" },
  { path: "a.md", line: 3, text: "What is a VPC?::A private cloud !suspended" },
];

const NOTE = "#flashcards/alpha\na::b\nWhat is a VPC?::A private cloud !suspended\n";

async function renderRoute(hits: api.SearchHit[] = HITS, note = NOTE) {
  vi.spyOn(api, "fetchCards").mockResolvedValue(hits);
  vi.spyOn(api, "fetchNote").mockResolvedValue(note);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createRouter({
    routeTree,
    context: { queryClient },
    history: createMemoryHistory({ initialEntries: ["/review"] }),
  });

  // Loaded before it is rendered, the way `home-route-fixture.tsx` does it: a
  // provider handed an unresolved router renders nothing at all.
  await act(async () => {
    await router.load();
  });

  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

/**
 * A button on the decks screen, asked for by role once the vault is read.
 *
 * Not `findByRole`. A role query works out every element's accessible name
 * through jsdom's `getComputedStyle`: its first call here costs about 200 ms,
 * and `findByRole` runs it again on every DOM change while the decks load.
 * Measured alone, the wait took 320 ms, 280 of them in the query itself, while
 * the decks reach the screen in 40 ms: the checks hold up the timers the decks
 * arrive on. A loaded machine spent the whole second that way
 * (#493). Waiting on the loading line costs a few ms, and the role query then
 * runs once with no clock on it.
 */
async function findButton(name: string | RegExp): Promise<HTMLElement> {
  await waitFor(() => expect(screen.queryByText("Reading the vault…")).toBeNull());
  return screen.getByRole("button", { name });
}

describe("the review route", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("reaches the parked screen from a button, with no key pressed", async () => {
    await renderRoute();

    // The exact name, because the deck row below names its parked count too.
    fireEvent.click(await findButton("1 parked"));

    expect(await screen.findByText("What is a VPC?")).toBeInTheDocument();
  });
});

describe("the review route on a phone", () => {
  const NESTED = "#flashcards/capitals\n\n{{c1::Canberra was {{c2::founded}} in 1913}}\n";

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    // A fold is kept in localStorage.
    localStorage.clear();
  });

  it("A8 a nested cloze is rated by tap at phone width", async () => {
    stubMatchMedia({ [NARROW]: true, [COARSE]: true });
    await renderRoute(
      [
        { path: "c.md", line: 1, text: "#flashcards/capitals" },
        { path: "c.md", line: 3, text: "{{c1::Canberra was {{c2::founded}} in 1913}}" },
      ],
      NESTED,
    );
    // The vault answers with what was sent: the next rating starts from it.
    const saved = vi
      .spyOn(api, "saveNote")
      .mockImplementation(async (path: string, content: string) => ({ path, content }));

    fireEvent.click(await findButton(/capitals/));

    expect(await shownCard()).toHaveTextContent(/^\[\.\.\.\]$/);
    fireEvent.click(screen.getByRole("button", { name: "Show answer" }));
    expect(screen.getByTestId("review-back")).toHaveTextContent("Canberra was founded in 1913");
    fireEvent.click(screen.getByRole("button", { name: "Good" }));

    expect(saved.mock.calls[0]?.[1]).toMatch(
      /^#flashcards\/capitals\n\n\{\{c1::Canberra was \{\{c2::founded\}\} in 1913\}\} <!--SR:c1![\d-]+,1,250-->\n$/,
    );

    await waitFor(() =>
      expect(screen.getByTestId("review-card")).toHaveTextContent(
        /^Canberra was \[\.\.\.\] in 1913$/,
      ),
    );
    fireEvent.click(screen.getByRole("button", { name: "Show answer" }));
    expect(screen.getByTestId("review-back")).toHaveTextContent("Canberra was founded in 1913");
    fireEvent.click(screen.getByRole("button", { name: "Good" }));

    expect(saved.mock.calls[1]?.[1]).toMatch(
      /^#flashcards\/capitals\n\n\{\{c1::Canberra was \{\{c2::founded\}\} in 1913\}\} <!--SR:c1![\d-]+,1,250--> <!--SR:c2![\d-]+,1,250-->\n$/,
    );
    expect(await screen.findByTestId("review-done")).toBeInTheDocument();
  });

  it("#517 A4 a tap on the toggle folds and unfolds, a parent with nothing to offer too", async () => {
    stubMatchMedia({ [NARROW]: true, [COARSE]: true });
    // One parked card, so neither row has anything to sit.
    await renderRoute(
      [
        { path: "t.md", line: 1, text: "#flashcards/trivia/geography" },
        { path: "t.md", line: 2, text: "a::b !suspended" },
      ],
      "#flashcards/trivia/geography\na::b !suspended\n",
    );
    const parent = await findButton(/^trivia/);
    const child = () => document.querySelector('button[data-deck="trivia/geography"]');

    expect(child()).toBeNull();
    const toggle = screen.getByRole("button", { name: "unfold trivia" });
    expect(parent).toBeDisabled();
    expect(toggle).toHaveClass("min-h-11", "min-w-11");
    expect(toggle.parentElement).toBe(parent.parentElement);

    fireEvent.click(toggle);
    expect(child()).not.toBeNull();
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(toggle).toHaveAccessibleName("fold trivia");
    // A row with nothing to fold keeps a gutter as wide as the toggle.
    expect(child()?.previousElementSibling).toHaveClass("min-w-11");

    fireEvent.click(toggle);
    expect(child()).toBeNull();
  });

  it("#600 A11 Undo and Center work by tap at phone width", async () => {
    stubMatchMedia({ [NARROW]: true, [COARSE]: true });
    await renderRoute();
    const saved = vi
      .spyOn(api, "saveNote")
      .mockImplementation(async (path: string, content: string) => ({ path, content }));

    fireEvent.click(await findButton(/alpha/));
    expect(await shownCard()).toHaveTextContent("a");
    fireEvent.click(screen.getByRole("button", { name: "Show answer" }));
    fireEvent.click(screen.getByRole("button", { name: "Good" }));
    expect(await screen.findByTestId("review-done")).toBeInTheDocument();

    const undo = screen.queryByRole("button", { name: "Undo" });
    expect(undo).not.toBeNull();
    fireEvent.click(undo as HTMLElement);

    await waitFor(() => expect(screen.getByTestId("review-back")).toHaveTextContent("b"));
    expect(saved.mock.calls[1]?.[1]).toBe(NOTE);

    const center = screen.getByRole("button", { name: "Center" });
    expect(center).toHaveClass("min-h-11");
    fireEvent.click(center);
    expect(center).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("review-card")).toHaveClass("text-center");
  });

  it("#612 A5 a tapped rating's refetch of a changed decks.md leaves the sitting as it was", async () => {
    stubMatchMedia({ [NARROW]: true, [COARSE]: true });
    const two = "#flashcards/alpha\na::b\nc::d\n";
    await renderRoute(
      [
        { path: "a.md", line: 1, text: "#flashcards/alpha" },
        { path: "a.md", line: 2, text: "a::b" },
        { path: "a.md", line: 3, text: "c::d" },
      ],
      two,
    );
    const saved = vi
      .spyOn(api, "saveNote")
      .mockImplementation(async (path: string, content: string) => ({ path, content }));
    // `decks.md` caps the deck at one new card once the rating has gone out.
    const late = { reads: 0 };
    vi.spyOn(api, "fetchNote").mockImplementation(async (path) => {
      if (path !== "99 Misc/01 Config/decks.md") return two;
      if (saved.mock.calls.length === 0) return "";
      late.reads += 1;
      return "alpha: 1 new\n";
    });

    fireEvent.click(await findButton(/alpha/));
    expect(await shownCard()).toHaveTextContent("a");
    fireEvent.click(screen.getByRole("button", { name: "Show answer" }));
    fireEvent.click(screen.getByRole("button", { name: "Good" }));
    await waitFor(() => expect(late.reads).toBeGreaterThan(0));
    await act(async () => {});

    expect(screen.getByText(/^\d+ left$/).textContent).toBe("1 left");
    expect(screen.getByTestId("review-card")).toHaveTextContent("c");
  });
});

describe("the review route under a daily limit", () => {
  const DUE = "<!--SR:!2000-01-01,4,250-->";
  const CARDS = `#flashcards/alpha\na::b ${DUE}\nc::d ${DUE}\ne::f ${DUE}\ng::h\ni::j\nk::l\n`;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("A12 draws a deck's row with the due and new counts its decks.md line allows", async () => {
    // `renderRoute` with one change: the config note answers with the limit.
    vi.spyOn(api, "fetchCards").mockResolvedValue(
      CARDS.split("\n").map((text, at) => ({ path: "a.md", line: at + 1, text })),
    );
    vi.spyOn(api, "fetchNote").mockImplementation((path) =>
      Promise.resolve(path === "99 Misc/01 Config/decks.md" ? "alpha: 1 new, 2 reviews\n" : CARDS),
    );
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const router = createRouter({
      routeTree,
      context: { queryClient },
      history: createMemoryHistory({ initialEntries: ["/review"] }),
    });
    await act(async () => {
      await router.load();
    });
    render(
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );

    const row = await findButton(/^alpha/);
    expect(row).toHaveTextContent("2 due");
    expect(row).toHaveTextContent("1 new");
  });
});
