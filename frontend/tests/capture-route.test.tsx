import "fake-indexeddb/auto";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, createRouter, RouterProvider } from "@tanstack/react-router";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import * as api from "@/lib/api";
import { readClock } from "@/lib/clock";
import { reset } from "@/lib/outbox";
import { routeTree } from "@/routeTree.gen";

/**
 * `/capture` mounted, because nothing else renders it.
 *
 * The phone's way into the dump, and the page Android's share sheet opens. So
 * what this file holds is a thought typed and sent, kept waiting when it cannot
 * go, and a share arriving in the query and leaving by either button.
 *
 * A dump leaves through the outbox's own raw fetch, so that is what these stub,
 * with fake-indexeddb under the outbox in place of the phone's store.
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

/** Drop the outbox's database, which only goes once the outbox has let go of it. */
function dropped(): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase("kasten-outbox");
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

/** A fetch that answers every call with `answer`, which may throw as no signal does. */
function answering(answer: () => Response) {
  const sent = vi.fn(async (_url: string, _init: RequestInit) => answer());
  vi.stubGlobal("fetch", sent);
  return sent;
}

const ok = () => new Response(JSON.stringify({ path: "x.md", content: "" }), { status: 200 });

const offline = () => {
  throw new TypeError("Failed to fetch");
};

describe("the capture route", () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    localStorage.clear();
    await reset();
    await dropped();
  });

  it("brings back a draft the app was closed on, and drops it once sent", async () => {
    const first = await renderRoute();
    fireEvent.change(first.field, { target: { value: "half a thought" } });
    cleanup();

    const { field } = await renderRoute();
    expect(field).toHaveValue("half a thought");

    answering(ok);
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(field).toHaveValue(""));
    expect(localStorage.getItem("kasten-capture-draft")).toBeNull();
    cleanup();

    expect((await renderRoute()).field).toHaveValue("");
  });

  it("leaves a stored draft alone while a share is in the box, and brings it back after", async () => {
    const first = await renderRoute();
    fireEvent.change(first.field, { target: { value: "half thought" } });
    cleanup();

    answering(ok);
    const { field } = await renderRoute("/capture?text=https%3A%2F%2Fx");
    expect(field).toHaveValue("https://x");
    fireEvent.change(field, { target: { value: "https://x edited" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => expect(field).toHaveValue("half thought"));
    expect(localStorage.getItem("kasten-capture-draft")).toBe("half thought");
    cleanup();

    expect((await renderRoute()).field).toHaveValue("half thought");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
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
    const sent = answering(ok);
    const { field } = await renderRoute();

    fireEvent.change(field, { target: { value: "  ask Jonas about the flat \n" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => expect(field).toHaveValue(""));
    expect(await screen.findByRole("list", { name: "Sent" }, { timeout: 2000 })).toHaveTextContent(
      "ask Jonas about the flat",
    );
    expect(sent.mock.calls.map(([, init]) => JSON.parse(init.body as string))).toEqual([
      expect.objectContaining({
        text: "ask Jonas about the flat",
        date: readClock(new Date()).date,
      }),
    ]);
  });

  it("keeps a refused thought waiting and says why", async () => {
    answering(
      () =>
        new Response(JSON.stringify({ detail: "Nothing to capture" }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        }),
    );
    const { field } = await renderRoute();

    fireEvent.change(field, { target: { value: "on a train" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Nothing to capture");
    expect(screen.getByRole("list", { name: "Waiting" })).toHaveTextContent("on a train");
    expect(field).toHaveValue("");
  });

  it("keeps a thought sent with no signal under Waiting, and sends it when the signal returns", async () => {
    answering(offline);
    const { field } = await renderRoute();

    fireEvent.change(field, { target: { value: "at the bus stop" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    const list = await screen.findByRole("list", { name: "Waiting" });
    await waitFor(() => expect(list).toHaveTextContent("at the bus stop"));
    const row = within(list).getByText("at the bus stop").closest("li") as HTMLElement;
    expect(row).toHaveTextContent(readClock(new Date()).date);
    expect(row).toHaveTextContent("waiting");
    expect(field).toHaveValue("");
    expect(screen.queryByRole("list", { name: "Sent" })).toBeNull();

    answering(ok);
    await act(async () => {
      window.dispatchEvent(new Event("online"));
    });

    expect(await screen.findByRole("list", { name: "Sent" })).toHaveTextContent("at the bus stop");
    await waitFor(() => expect(screen.queryByRole("list", { name: "Waiting" })).toBeNull());
  });

  it.each([
    ["the proxy's redirect", () => ({ ok: false, status: 0, type: "opaqueredirect" }) as Response],
    ["a 401", () => new Response("", { status: 401 })],
  ])("says to sign in again after %s", async (_name, answer) => {
    answering(answer);
    const { field } = await renderRoute();

    fireEvent.change(field, { target: { value: "behind the proxy" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    expect(await screen.findByRole("status")).toHaveTextContent("Waiting: sign in again");
    expect(screen.getByRole("link", { name: "sign in again" })).toHaveAttribute("href", "/");
    expect(screen.getByRole("list", { name: "Waiting" })).toHaveTextContent("behind the proxy");
  });

  it("fills the box from a share, and drops the share once it is sent", async () => {
    answering(ok);
    const { field, router } = await renderRoute(
      "/capture?title=A%20post&text=https%3A%2F%2Fa.b%2Fc&url=https%3A%2F%2Fa.b%2Fc",
    );

    expect(field).toHaveValue("A post\nhttps://a.b/c");

    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => expect(router.state.location.search).toEqual({}));
  });

  it("clips a shared page into the inbox the way the import key does", async () => {
    const sent = answering(ok);
    vi.spyOn(api, "fetchFiles").mockResolvedValue([]);
    vi.spyOn(api, "fetchPage").mockResolvedValue({ url: "https://a.b/c", html: PAGE });
    const made = vi
      .spyOn(api, "createNote")
      .mockResolvedValue({ path: "00 Inbox/A post.md", content: "" });
    await renderRoute("/capture?text=https%3A%2F%2Fa.b%2Fc");

    fireEvent.click(screen.getByRole("button", { name: "Clip to inbox" }));

    expect(await screen.findByRole("list", { name: "Sent" })).toHaveTextContent(
      "clipped to 00 Inbox/A post.md",
    );
    expect(made).toHaveBeenCalledWith(
      "00 Inbox/A post.md",
      expect.stringContaining("type: Source"),
    );
    expect(sent.mock.calls.map(([url]) => url)).not.toContain("/api/dump");
  });

  it("says where the files of a share went, and that they did not go with no signal", async () => {
    await renderRoute("/capture?receipts=1&refused=1");
    expect(screen.getByRole("status")).toHaveTextContent(
      "1 receipt kept for tax, waiting under Finance, To sort; 1 refused",
    );
    cleanup();

    await renderRoute("/capture?title=A+page&offline=2");
    expect(screen.getByRole("status")).toHaveTextContent("2 files not sent: no signal");
  });
});
