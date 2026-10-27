import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { Suspense } from "react";
import { client } from "@/lib/api-client";
import { Route } from "@/routes/tokens";

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

/** The instant `ago` milliseconds before `now`, as the API writes it. */
function since(now: number, ago: number): string {
  return new Date(now - ago).toISOString();
}

type Get = (
  url: string,
  init?: { params?: { path?: { name: string } } },
) => Promise<{ data: unknown; response: Response }>;

/** Answer the two reads the page makes: the token list, and one token's actions. */
function serve(tokens: unknown[], actions: Record<string, unknown[]> = {}) {
  const get: Get = async (url, init) => {
    if (url === "/api/tokens") {
      return { data: tokens, response: new Response(null, { status: 200 }) };
    }
    const name = init?.params?.path?.name ?? "";
    return { data: actions[name] ?? [], response: new Response(null, { status: 200 }) };
  };
  vi.spyOn(client, "GET").mockImplementation(get as unknown as typeof client.GET);
}

async function renderPage() {
  const Page = Route.options.component;
  if (Page === undefined) throw new Error("the tokens route has no component");
  const queries = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  // The route's component is code-split, so its first render suspends on an import.
  // A synchronous `act` would leave that retry unflushed, hence the awaited one.
  await act(async () => {
    render(
      <QueryClientProvider client={queries}>
        <Suspense fallback={null}>
          <Page />
        </Suspense>
      </QueryClientProvider>,
    );
  });
  await screen.findByRole("heading", { name: "agent tokens" });
}

beforeEach(() => {
  vi.restoreAllMocks();
});

it("each token shows its last use, and never for one without", async () => {
  const now = Date.now();
  serve([
    { name: "laptop", created: since(now, 2 * DAY), last_used: since(now, 3 * MINUTE) },
    { name: "ci", created: since(now, DAY), last_used: null },
  ]);
  await renderPage();

  expect(await screen.findByText("used 3 min ago")).toBeInTheDocument();
  expect(screen.getByText("never used")).toBeInTheDocument();
});

it("a token unused for 30 days is marked", async () => {
  const now = Date.now();
  serve([{ name: "old", created: since(now, 60 * DAY), last_used: since(now, 31 * DAY) }]);
  await renderPage();

  expect(await screen.findByText("unused 30 days")).toBeInTheDocument();
});

it("a token used in the last 30 days is not marked", async () => {
  const now = Date.now();
  serve([{ name: "recent", created: since(now, 60 * DAY), last_used: since(now, 29 * DAY) }]);
  await renderPage();

  expect(await screen.findByText("used 29 days ago")).toBeInTheDocument();
  expect(screen.queryByText("unused 30 days")).not.toBeInTheDocument();
});

it("the actions button opens that token's recent actions, newest first", async () => {
  const now = Date.now();
  serve([{ name: "laptop", created: since(now, 2 * DAY), last_used: since(now, 3 * MINUTE) }], {
    laptop: [
      {
        at: since(now, 3 * MINUTE),
        client: "10.0.0.2",
        method: "POST",
        path: "/agent/mcp",
        tool: "save_note",
        note: "inbox/a.md",
        status: 200,
        outcome: "ok",
      },
      {
        at: since(now, 60 * MINUTE),
        client: null,
        method: "GET",
        path: "/agent/notes/x",
        tool: null,
        note: null,
        status: 404,
        outcome: "error",
      },
    ],
  });
  await renderPage();

  const button = await screen.findByRole("button", { name: "Actions" });
  expect(button).toHaveAttribute("aria-expanded", "false");
  fireEvent.click(button);

  const newer = await screen.findByText("save_note");
  expect(button).toHaveAttribute("aria-expanded", "true");
  const older = screen.getByText("GET /agent/notes/x");
  expect(newer.compareDocumentPosition(older) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(within(newer.closest("li") ?? document.body).getByText("inbox/a.md")).toBeInTheDocument();
});
