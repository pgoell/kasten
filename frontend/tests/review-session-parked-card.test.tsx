import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { ReviewSession } from "@/components/review-session";
import * as api from "@/lib/api";
import { noteBase } from "@/lib/note-base";
import { shownCard } from "./review-card";
import { DECK } from "./review-session-fixture";

describe("ReviewSession on a parked card", () => {
  const PARKED =
    "#flashcards/aws\n\nWhat is a VPC?::A private cloud\n\n" +
    "What is Direct Connect?::A private link !suspended\n";

  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  const TWO =
    "#flashcards/aws\n\nWhat is a VPC?::A private cloud\n\n" +
    "What is Direct Connect?::A private link\n";

  function renderTwo() {
    vi.spyOn(api, "fetchNote").mockResolvedValue(TWO);
    const saved = vi.spyOn(api, "saveNote").mockResolvedValue({
      path: "decks/aws.md",
      content: TWO,
    });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <ReviewSession deck={{ ...DECK, fresh: 2 }} onLeave={vi.fn()} />
      </QueryClientProvider>,
    );
    return saved;
  }

  it("writes the token onto the card on screen", async () => {
    const saved = renderTwo();
    await shownCard();

    fireEvent.click(screen.getByRole("button", { name: "Suspend" }));

    expect(saved.mock.calls[0]?.[0]).toBe("decks/aws.md");
    expect(saved.mock.calls[0]?.[1]).toContain("What is a VPC?::A private cloud !suspended");
    expect(saved.mock.calls[0]?.[1]).toContain("What is Direct Connect?::A private link\n");
  });

  it("names the text it read as the first save's base, and that save's answer as the next", async () => {
    const saved = renderTwo();
    // The vault's answer differs from what was sent, the way a stamp makes it.
    saved.mockImplementation(async (path: string, content: string) => ({
      path,
      content: `${content}\nlanded\n`,
    }));
    await shownCard();

    fireEvent.click(screen.getByRole("button", { name: "Show answer" }));
    fireEvent.click(screen.getByRole("button", { name: "Good" }));
    await act(async () => {});
    fireEvent.click(screen.getByRole("button", { name: "Show answer" }));
    fireEvent.click(screen.getByRole("button", { name: "Good" }));

    expect(saved.mock.calls[0]?.slice(2)).toEqual([false, noteBase(TWO)]);
    expect(saved.mock.calls[1]?.[1]).toContain("landed");
    expect(saved.mock.calls[1]?.[3]).toBe(noteBase(`${saved.mock.calls[0]?.[1]}\nlanded\n`));
  });

  it("holds a second rating's write until the first answers, and names that answer", async () => {
    const saved = renderTwo();
    let answer: (() => void) | undefined;
    saved.mockImplementationOnce(
      (path: string, content: string) =>
        new Promise((resolve) => {
          // The stamped block a note without one comes back with.
          answer = () => resolve({ path, content: `---\nid: x\n---\n${content}` });
        }),
    );
    saved.mockImplementation(async (path: string, content: string) => ({ path, content }));
    await shownCard();

    fireEvent.click(screen.getByRole("button", { name: "Show answer" }));
    fireEvent.click(screen.getByRole("button", { name: "Good" }));
    fireEvent.click(screen.getByRole("button", { name: "Show answer" }));
    fireEvent.click(screen.getByRole("button", { name: "Good" }));
    await act(async () => {});
    expect(saved).toHaveBeenCalledTimes(1);

    await act(async () => answer?.());

    expect(saved).toHaveBeenCalledTimes(2);
    expect(saved.mock.calls[1]?.[3]).toBe(noteBase(`---\nid: x\n---\n${saved.mock.calls[0]?.[1]}`));
  });

  it("reads the note again after a refused rating, and names that text next", async () => {
    const saved = renderTwo();
    saved.mockRejectedValueOnce(new api.ChangedOnDisk());
    const reread = `${TWO}\nsomebody else's line\n`;
    await shownCard();
    vi.mocked(api.fetchNote).mockResolvedValue(reread);

    fireEvent.click(screen.getByRole("button", { name: "Show answer" }));
    fireEvent.click(screen.getByRole("button", { name: "Good" }));
    await act(async () => {});
    fireEvent.click(screen.getByRole("button", { name: "Show answer" }));
    fireEvent.click(screen.getByRole("button", { name: "Good" }));
    await act(async () => {});

    expect(saved).toHaveBeenCalledTimes(2);
    expect(saved.mock.calls[1]?.[3]).toBe(noteBase(reread));
    expect(screen.getByText(/could not be written: Changed on disk/)).toBeInTheDocument();
  });

  it("sends a rating queued behind a refused one, naming the unlanded text, and says it failed", async () => {
    const saved = renderTwo();
    let refuse: (() => void) | undefined;
    saved.mockImplementationOnce(
      () =>
        new Promise((_, reject) => {
          refuse = () => reject(new api.ChangedOnDisk());
        }),
    );
    saved.mockRejectedValueOnce(new Error("the second was refused"));
    await shownCard();

    fireEvent.click(screen.getByRole("button", { name: "Show answer" }));
    fireEvent.click(screen.getByRole("button", { name: "Good" }));
    fireEvent.click(screen.getByRole("button", { name: "Show answer" }));
    fireEvent.click(screen.getByRole("button", { name: "Good" }));
    await act(async () => refuse?.());
    await act(async () => {});

    expect(saved).toHaveBeenCalledTimes(2);
    expect(saved.mock.calls[1]?.[3]).toBe(noteBase(saved.mock.calls[0]?.[1] ?? ""));
    expect(screen.getByText(/could not be written: the second was refused/)).toBeInTheDocument();
  });

  it("names the old screen text for a rating made while the re-read is out", async () => {
    const saved = renderTwo();
    saved.mockRejectedValueOnce(new api.ChangedOnDisk());
    await shownCard();
    let reread: (() => void) | undefined;
    vi.mocked(api.fetchNote).mockImplementation(
      () =>
        new Promise((resolve) => {
          reread = () => resolve(`${TWO}\nsomebody else's line\n`);
        }),
    );

    fireEvent.click(screen.getByRole("button", { name: "Show answer" }));
    fireEvent.click(screen.getByRole("button", { name: "Good" }));
    await act(async () => {});
    expect(reread).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Show answer" }));
    fireEvent.click(screen.getByRole("button", { name: "Good" }));
    await act(async () => reread?.());
    await act(async () => {});

    expect(saved).toHaveBeenCalledTimes(2);
    expect(saved.mock.calls[1]?.[3]).toBe(noteBase(saved.mock.calls[0]?.[1] ?? ""));
  });

  it("drops it from the queue and moves to the next card", async () => {
    renderTwo();
    await shownCard();
    expect(screen.getByText(/left/).textContent).toBe("2 left");

    fireEvent.click(screen.getByRole("button", { name: "Suspend" }));

    expect(screen.getByText(/left/).textContent).toBe("1 left");
    expect(screen.getByTestId("review-card")).toHaveTextContent("What is Direct Connect?");
  });

  it("leaves the parked card out of the queue", async () => {
    vi.spyOn(api, "fetchNote").mockResolvedValue(PARKED);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <ReviewSession deck={{ ...DECK, parked: 1 }} onLeave={vi.fn()} />
      </QueryClientProvider>,
    );

    const card = await shownCard();
    expect(card).toHaveTextContent("What is a VPC?");
    expect(card).not.toHaveTextContent("What is Direct Connect?");
    expect(screen.getByText(/left/).textContent).toBe("1 left");
  });
});
