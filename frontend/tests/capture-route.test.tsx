import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, createRouter, RouterProvider } from "@tanstack/react-router";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import * as api from "@/lib/api";
import { readClock } from "@/lib/clock";
import { routeTree } from "@/routeTree.gen";

/**
 * `/capture` mounted, because nothing else renders it.
 *
 * The phone's way into the dump, and the page Android's share sheet opens. So
 * what this file holds is a thought typed and sent, and a share arriving in the
 * query and leaving by either button.
 */

const PAGE = `<!doctype html><html><head><title>A post</title></head><body>
  <article><p>Long enough to be read as the article. Long enough to be read.</p></article>
  </body></html>`;

async function renderRoute(at = "/capture") {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createRouter({
    routeTree,
    context: { queryClient },
    history: createMemoryHistory({ initialEntries: [at] }),
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

  return {
    router,
    field: await screen.findByRole("textbox", { name: "What is on your mind" }),
  };
}

describe("the capture route", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("opens on an empty box with the focus in it and today's date above", async () => {
    const { field } = await renderRoute();

    expect(field).toHaveFocus();
    expect(field).toHaveValue("");
    expect(screen.getByText(new RegExp(readClock(new Date()).date))).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Clip to inbox" })).toBeNull();
  });

  it("sends the thought for this browser's day, lists it, and empties the box", async () => {
    const sent = vi
      .spyOn(api, "captureDump")
      .mockResolvedValue({ path: "01 Periodic/00 Daily/x.md", content: "" });
    const { field } = await renderRoute();

    fireEvent.change(field, { target: { value: "  ask Jonas about the flat \n" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => expect(field).toHaveValue(""));
    expect(sent).toHaveBeenCalledWith("ask Jonas about the flat", readClock(new Date()).date);
    expect(screen.getByRole("list", { name: "Sent" })).toHaveTextContent(
      "ask Jonas about the flat",
    );
  });

  it("keeps the thought and says why when the vault refuses it", async () => {
    vi.spyOn(api, "captureDump").mockRejectedValue(new Error("Nothing to capture"));
    const { field } = await renderRoute();

    fireEvent.change(field, { target: { value: "on a train" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Nothing to capture");
    expect(field).toHaveValue("on a train");
  });

  it("fills the box from a share, and drops the share once it is sent", async () => {
    vi.spyOn(api, "captureDump").mockResolvedValue({ path: "x.md", content: "" });
    const { field, router } = await renderRoute(
      "/capture?title=A%20post&text=https%3A%2F%2Fa.b%2Fc&url=https%3A%2F%2Fa.b%2Fc",
    );

    expect(field).toHaveValue("A post\nhttps://a.b/c");

    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => expect(router.state.location.search).toEqual({}));
  });

  it("clips a shared page into the inbox the way the import key does", async () => {
    vi.spyOn(api, "fetchFiles").mockResolvedValue([]);
    vi.spyOn(api, "fetchPage").mockResolvedValue({ url: "https://a.b/c", html: PAGE });
    const made = vi
      .spyOn(api, "createNote")
      .mockResolvedValue({ path: "00 Inbox/A post.md", content: "" });
    const dumped = vi.spyOn(api, "captureDump");
    await renderRoute("/capture?text=https%3A%2F%2Fa.b%2Fc");

    fireEvent.click(screen.getByRole("button", { name: "Clip to inbox" }));

    expect(await screen.findByRole("list", { name: "Sent" })).toHaveTextContent(
      "clipped to 00 Inbox/A post.md",
    );
    expect(made).toHaveBeenCalledWith(
      "00 Inbox/A post.md",
      expect.stringContaining("type: Source"),
    );
    expect(dumped).not.toHaveBeenCalled();
  });
});
