import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ReviewSession } from "@/components/review-session";
import * as api from "@/lib/api";
import type { Deck } from "@/lib/review";

const DECK: Deck = { name: "aws", note: "decks/aws.md", due: 0, fresh: 1, whole: false };

const NOTE = "#flashcards/aws\n\nWhat does S3 stand for?::Simple Storage Service\n";

function renderSession() {
  vi.spyOn(api, "fetchNote").mockResolvedValue(NOTE);
  vi.spyOn(api, "saveNote").mockResolvedValue({ path: DECK.note, content: NOTE });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  render(
    <QueryClientProvider client={client}>
      <ReviewSession deck={DECK} onLeave={vi.fn()} />
    </QueryClientProvider>,
  );

  return screen.findByTestId("review-card");
}

describe("ReviewSession typing", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("asks for a button press when typing is off", async () => {
    await renderSession();

    expect(screen.getByRole("button", { name: "Show answer" })).toBeInTheDocument();
    expect(screen.queryByLabelText("your answer")).not.toBeInTheDocument();
  });

  it("asks for the answer in writing once typing is on", async () => {
    await renderSession();

    fireEvent.click(screen.getByRole("button", { name: "Type" }));

    expect(screen.getByLabelText("your answer")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Show answer" })).not.toBeInTheDocument();
  });

  it("keeps the ratings back until the answer is in", async () => {
    await renderSession();
    fireEvent.click(screen.getByRole("button", { name: "Type" }));

    expect(screen.queryByRole("button", { name: "Good" })).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("your answer"), {
      target: { value: "Simple Storage Service" },
    });
    fireEvent.submit(screen.getByTestId("review-typed"));

    expect(screen.getByTestId("review-back")).toHaveTextContent("Simple Storage Service");
    expect(screen.getByRole("button", { name: "Good" })).toBeInTheDocument();
  });

  it("says the answer matched", async () => {
    await renderSession();
    fireEvent.click(screen.getByRole("button", { name: "Type" }));
    fireEvent.change(screen.getByLabelText("your answer"), {
      target: { value: "simple storage service" },
    });
    fireEvent.submit(screen.getByTestId("review-typed"));

    expect(screen.getByTestId("review-verdict")).toHaveTextContent("Matched");
  });

  it("shows what was typed beside the answer when it did not match", async () => {
    await renderSession();
    fireEvent.click(screen.getByRole("button", { name: "Type" }));
    fireEvent.change(screen.getByLabelText("your answer"), {
      target: { value: "Simple Store Service" },
    });
    fireEvent.submit(screen.getByTestId("review-typed"));

    const verdict = screen.getByTestId("review-verdict");
    expect(verdict).toHaveTextContent("Simple Store Service");
    // The rating is still yours to give: a mismatch never refuses one.
    expect(screen.getByRole("button", { name: "Easy" })).toBeInTheDocument();
  });

  it("remembers the toggle across a remount", async () => {
    await renderSession();
    fireEvent.click(screen.getByRole("button", { name: "Type" }));
    expect(localStorage.getItem("kasten.review.typing")).toBe("on");

    cleanup();
    await renderSession();

    expect(screen.getByLabelText("your answer")).toBeInTheDocument();
  });
});

describe("ReviewSession on a whole note", () => {
  const NOTE_DECK: Deck = { name: "tls", note: "notes/tls.md", due: 1, fresh: 0, whole: true };
  const MARKED =
    "---\nsr-due: 2026-01-01\nsr-interval: 4\nsr-ease: 250\n---\n# TLS\n\nthe handshake\n";

  function renderNote() {
    vi.spyOn(api, "fetchNote").mockResolvedValue(MARKED);
    const saved = vi.spyOn(api, "saveNote").mockResolvedValue({
      path: NOTE_DECK.note,
      content: MARKED,
    });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <ReviewSession deck={NOTE_DECK} onLeave={vi.fn()} />
      </QueryClientProvider>,
    );
    return saved;
  }

  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("shows the note without its frontmatter and rates it straight away", async () => {
    renderNote();

    const card = await screen.findByTestId("review-card");
    expect(card).toHaveTextContent("the handshake");
    expect(card).not.toHaveTextContent("sr-ease");
    expect(screen.getByRole("button", { name: "Good" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Show answer" })).not.toBeInTheDocument();
  });

  it("writes the schedule into the note's frontmatter", async () => {
    const saved = renderNote();
    await screen.findByTestId("review-card");

    fireEvent.click(screen.getByRole("button", { name: "Good" }));

    expect(saved).toHaveBeenCalledOnce();
    const written = saved.mock.calls[0]?.[1] ?? "";
    expect(written).toContain("sr-interval: 10");
    expect(written).toContain("the handshake");
  });
});
