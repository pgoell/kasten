import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { ReviewParked } from "@/components/review-parked";
import * as api from "@/lib/api";

const SR = "<!--SR:!2026-08-20,4,270-->";
const A = `#flashcards/aws\n\nQ A?::answer A !suspended ${SR}\n`;
const C = `#flashcards/aws\n\nQ C?::answer C !suspended ${SR}\n`;

/** The scan's lines for a note, the way the search answers them. */
function hitsOf(path: string, text: string) {
  return text.split("\n").map((line, i) => ({ path, line: i + 1, text: line }));
}

/** The error the API throws for a request the backend dropped with `status`. */
function gateway(status: number, path: string) {
  return new Error(`GET /api/${path} failed with ${status}`, { cause: status });
}

function renderParked() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <QueryClientProvider client={client}>
      <ReviewParked onLeave={vi.fn()} onOpen={vi.fn()} />
    </QueryClientProvider>,
  );
  return { ...view, client };
}

/** Lets the fake clock run on, so the screen's queries and reads move. */
async function pass(ms = 0) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

describe("ReviewParked reads through a backend that restarts (#1150, #1151)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("#1150 A5 with the scan still out the parked list says Reading the notes and not Nothing parked", async () => {
    vi.spyOn(api, "fetchCards").mockReturnValue(new Promise(() => {}));
    renderParked();
    await pass();

    expect(screen.queryByText(/Nothing parked/)).toBeNull();
    expect(screen.getByText("Reading the notes…")).toBeInTheDocument();
  });

  it("#1150 A6 a scan that fails at last with nothing cached shows its error and not Nothing parked", async () => {
    vi.spyOn(api, "fetchCards").mockRejectedValue(gateway(502, "cards"));
    renderParked();
    await pass(61_000);

    expect(screen.queryByText(/Nothing parked/)).toBeNull();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "The cards could not be read: GET /api/cards failed with 502",
    );
  });

  it("#1150 A6 an empty vault, where the scan answers no lines, still says Nothing parked", async () => {
    vi.spyOn(api, "fetchCards").mockResolvedValue([]);
    renderParked();
    await pass();

    expect(screen.getByText(/Nothing parked/)).toBeInTheDocument();
  });

  it("#1150 I4 a scan that is retrying shows Reading the notes for its tries, then the parked rows once a try answers", async () => {
    vi.spyOn(api, "fetchCards")
      .mockRejectedValueOnce(gateway(502, "cards"))
      .mockResolvedValue(hitsOf("a.md", A));
    vi.spyOn(api, "fetchNote").mockResolvedValue(A);
    renderParked();
    await pass(500);

    expect(screen.queryByText(/Nothing parked/)).toBeNull();
    expect(screen.getByText("Reading the notes…")).toBeInTheDocument();

    await pass(1000);
    expect(screen.getByText("Q A?")).toBeInTheDocument();
  });

  it("#1151 A7 a failed read of the parked notes goes once a later read answers", async () => {
    let hits = hitsOf("a.md", A);
    vi.spyOn(api, "fetchCards").mockImplementation(async () => hits);
    let refused = true;
    vi.spyOn(api, "fetchNote").mockImplementation(async (path) => {
      if (refused) throw new Error("GET /api/files/a.md failed");
      return path === "a.md" ? A : C;
    });
    const { client } = renderParked();
    await pass();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "The note could not be read: GET /api/files/a.md failed",
    );

    refused = false;
    hits = [...hits, ...hitsOf("c.md", C)];
    await act(async () => {
      await client.invalidateQueries({ queryKey: ["cards"] });
    });
    await pass();

    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByText("Q A?")).toBeInTheDocument();
  });

  it("#1151 A8 a parked note read that gets a 502 is read again and its rows show, with no alert", async () => {
    vi.spyOn(api, "fetchCards").mockResolvedValue(hitsOf("a.md", A));
    vi.spyOn(api, "fetchNote")
      .mockRejectedValueOnce(gateway(502, "files/a.md"))
      .mockResolvedValue(A);
    renderParked();
    await pass(1000);

    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByText("Q A?")).toBeInTheDocument();
  });

  it("#1151 A8 a parked note read that gets a network error is read again and its rows show, with no alert", async () => {
    vi.spyOn(api, "fetchCards").mockResolvedValue(hitsOf("a.md", A));
    vi.spyOn(api, "fetchNote")
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValue(A);
    renderParked();
    await pass(1000);

    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByText("Q A?")).toBeInTheDocument();
  });

  it("#1151 I5 a parked note read that fails for the whole minute shows the read alert as today", async () => {
    vi.spyOn(api, "fetchCards").mockResolvedValue(hitsOf("a.md", A));
    vi.spyOn(api, "fetchNote").mockRejectedValue(gateway(502, "files/a.md"));
    renderParked();
    await pass(61_000);

    expect(screen.getByRole("alert")).toHaveTextContent(
      "The note could not be read: GET /api/files/a.md failed with 502",
    );
    expect(screen.queryByText("Q A?")).toBeNull();
  });

  it("#1151 I5 a put-back whose write failed keeps its own alert after a later read answers", async () => {
    let hits = hitsOf("a.md", A);
    vi.spyOn(api, "fetchCards").mockImplementation(async () => hits);
    vi.spyOn(api, "fetchNote").mockImplementation(async (path) => (path === "a.md" ? A : C));
    let refuse: (error: Error) => void = () => {};
    vi.spyOn(api, "saveNote").mockImplementation(
      () =>
        new Promise<api.Note>((_, fail) => {
          refuse = fail;
        }),
    );
    const { container, client } = renderParked();
    await pass();

    fireEvent.click(container.querySelector('button[data-unpark="a.md:0"]') as HTMLButtonElement);
    refuse(new Error("PUT /api/files/a.md failed with 409", { cause: 409 }));
    await pass();
    expect(screen.getByRole("alert")).toHaveTextContent("PUT /api/files/a.md failed with 409");

    hits = [...hits, ...hitsOf("c.md", C)];
    await act(async () => {
      await client.invalidateQueries({ queryKey: ["cards"] });
    });
    await pass();

    expect(screen.getByRole("alert")).toHaveTextContent("PUT /api/files/a.md failed with 409");
  });
});
