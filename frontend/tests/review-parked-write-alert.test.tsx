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

beforeEach(() => {
  vi.restoreAllMocks();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("ReviewParked words a failed put-back as a write (#1159)", () => {
  it("#1159 A4 a put-back whose write fails says the note could not be written", async () => {
    vi.spyOn(api, "fetchCards").mockResolvedValue(hitsOf("a.md", A));
    vi.spyOn(api, "fetchNote").mockResolvedValue(A);
    vi.spyOn(api, "saveNote").mockRejectedValue(
      new Error("PUT /api/files/a.md failed with 409", { cause: 409 }),
    );
    const { container } = renderParked();
    await pass();

    fireEvent.click(container.querySelector('button[data-unpark="a.md:0"]') as HTMLButtonElement);
    await pass();

    expect(screen.getByRole("alert")).toHaveTextContent(
      "The note could not be written: PUT /api/files/a.md failed with 409",
    );
  });

  it("#1159 I4 a failed put-back write and a failed read show side by side, each in its own words", async () => {
    let hits = hitsOf("a.md", A);
    vi.spyOn(api, "fetchCards").mockImplementation(async () => hits);
    let refusing = false;
    vi.spyOn(api, "fetchNote").mockImplementation(async (path) => {
      if (refusing) throw new Error("GET /api/files/a.md failed with 502", { cause: 502 });
      return path === "a.md" ? A : C;
    });
    vi.spyOn(api, "saveNote").mockRejectedValue(
      new Error("PUT /api/files/a.md failed with 409", { cause: 409 }),
    );
    const { container, client } = renderParked();
    await pass();

    fireEvent.click(container.querySelector('button[data-unpark="a.md:0"]') as HTMLButtonElement);
    await pass();

    refusing = true;
    hits = [...hits, ...hitsOf("c.md", C)];
    await act(async () => {
      await client.invalidateQueries({ queryKey: ["cards"] });
    });
    await pass(61_000);

    const alerts = screen.getAllByRole("alert").map((alert) => alert.textContent);
    expect(alerts).toHaveLength(2);
    expect(alerts).toContainEqual(
      "The note could not be written: PUT /api/files/a.md failed with 409",
    );
    expect(alerts).toContainEqual(
      "The note could not be read: GET /api/files/a.md failed with 502",
    );
  });
});
