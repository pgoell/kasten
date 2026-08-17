import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, createRouter, RouterProvider } from "@tanstack/react-router";
import { act, fireEvent, render, screen } from "@testing-library/react";
import * as api from "@/lib/api";
import { routeTree } from "@/routeTree.gen";

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

async function renderRoute() {
  vi.spyOn(api, "fetchCards").mockResolvedValue(HITS);
  vi.spyOn(api, "fetchNote").mockResolvedValue(NOTE);
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
