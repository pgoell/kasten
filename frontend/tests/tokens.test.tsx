import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, createRouter, RouterProvider } from "@tanstack/react-router";
import { act, fireEvent, render, screen } from "@testing-library/react";
import * as api from "@/lib/api";
import { routeTree } from "@/routeTree.gen";

/**
 * `/tokens` mounted, because nothing else renders it.
 *
 * A screen visited a few times a year, and the one place a secret is ever shown.
 * Both halves of that are what this file is for: that it is shown once, and that
 * a revoke reaches the route rather than only the row.
 */
const TOKENS = [
  { name: "laptop", created: "2026-08-18T09:00:00Z" },
  { name: "cron", created: "2026-08-17T09:00:00Z" },
];

const MINTED = { name: "phone", created: "2026-08-18T10:00:00Z", secret: "kasten_abc123" };

async function renderRoute() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createRouter({
    routeTree,
    context: { queryClient },
    history: createMemoryHistory({ initialEntries: ["/tokens"] }),
  });

  // Loaded before it is rendered, the way `review-route.test.tsx` does it: a
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

describe("the tokens route", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(api, "fetchTokens").mockResolvedValue(TOKENS);
  });

  it("renders one row per token", async () => {
    await renderRoute();

    expect(await screen.findByText("laptop")).toBeInTheDocument();
    expect(await screen.findByText("cron")).toBeInTheDocument();
  });

  it("mints the name that was typed and shows the secret once", async () => {
    const createToken = vi.spyOn(api, "createToken").mockResolvedValue(MINTED);
    await renderRoute();

    fireEvent.change(await screen.findByLabelText("Name"), { target: { value: "phone" } });
    fireEvent.click(screen.getByRole("button", { name: "Mint" }));

    expect(await screen.findByText(MINTED.secret)).toBeInTheDocument();
    expect(createToken).toHaveBeenCalledWith("phone");
    expect(screen.getAllByText(MINTED.secret)).toHaveLength(1);
  });

  it("revokes the row's own token and reads the list again", async () => {
    const revokeToken = vi.spyOn(api, "revokeToken").mockResolvedValue(undefined);
    const fetchTokens = vi.spyOn(api, "fetchTokens").mockResolvedValue(TOKENS);
    vi.spyOn(window, "confirm").mockReturnValue(true);
    await renderRoute();

    fireEvent.click(await screen.findByRole("button", { name: "Revoke cron" }));

    await act(async () => {
      await Promise.resolve();
    });
    expect(revokeToken).toHaveBeenCalledWith("cron");
    expect(fetchTokens.mock.calls.length).toBeGreaterThan(1);
  });

  it("takes the minted secret away when that same token is revoked", async () => {
    vi.spyOn(api, "createToken").mockResolvedValue(MINTED);
    vi.spyOn(api, "revokeToken").mockResolvedValue(undefined);
    vi.spyOn(window, "confirm").mockReturnValue(true);
    vi.spyOn(api, "fetchTokens").mockResolvedValue([{ name: "phone", created: MINTED.created }]);
    await renderRoute();

    fireEvent.change(await screen.findByLabelText("Name"), { target: { value: "phone" } });
    fireEvent.click(screen.getByRole("button", { name: "Mint" }));
    expect(await screen.findByText(MINTED.secret)).toBeInTheDocument();

    fireEvent.click(await screen.findByRole("button", { name: "Revoke phone" }));

    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.queryByText(MINTED.secret)).not.toBeInTheDocument();
  });

  it("leaves the token alone when the confirm is dismissed", async () => {
    const revokeToken = vi.spyOn(api, "revokeToken").mockResolvedValue(undefined);
    vi.spyOn(window, "confirm").mockReturnValue(false);
    await renderRoute();

    fireEvent.click(await screen.findByRole("button", { name: "Revoke cron" }));

    expect(revokeToken).not.toHaveBeenCalled();
  });
});
