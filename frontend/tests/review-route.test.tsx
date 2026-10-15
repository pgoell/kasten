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

  // Loaded before it is rendered, the way `home-route.test.tsx` does it: a
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

describe("the review route", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("reaches the parked screen from a button, with no key pressed", async () => {
    await renderRoute();

    // The exact name, because the deck row below names its parked count too.
    fireEvent.click(await screen.findByRole("button", { name: "1 parked" }));

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

    fireEvent.click(await screen.findByRole("button", { name: /capitals/ }));

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
});
