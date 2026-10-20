import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ReviewSession } from "@/components/review-session";
import * as api from "@/lib/api";
import { noteBase } from "@/lib/note-base";
import type { Deck } from "@/lib/review";
import { shownCard } from "./review-card";
import { DECK } from "./review-session-fixture";

/** What the session hands a shell to put its keys over. */
type ReviewControls = Parameters<NonNullable<Parameters<typeof ReviewSession>[0]["onControls"]>>[0];

describe("ReviewSession undoing the last step (#600)", () => {
  const TWO = "#flashcards/aws\n\nWhat is a VPC?::A private cloud\n\nWhat is S3?::Storage\n";

  /**
   * The sitting over a vault holding one note, and `decks.md`.
   *
   * The vault refuses a write whose base is not the hash of the text it holds,
   * the way the backend's conditional `PUT` does, so a refusal here comes of the
   * base the sitting named and never of a rejection set up for the test.
   *
   * `decksNote` given as a list is one answer per read of `decks.md`, the last
   * kept, so a test can change the note under a running sitting.
   */
  function renderVault(
    start = TWO,
    deck: Deck = { ...DECK, fresh: 2 },
    decksNote: string | string[] = "",
  ) {
    const vault = { disk: start };
    const answers = [decksNote].flat();
    const decks = { reads: 0 };
    vi.spyOn(api, "fetchNote").mockImplementation(async (path: string) => {
      if (path !== "99 Misc/01 Config/decks.md") return vault.disk;
      decks.reads += 1;
      return answers[Math.min(decks.reads, answers.length) - 1] ?? "";
    });
    const saved = vi
      .spyOn(api, "saveNote")
      .mockImplementation(async (path: string, content: string, _keep?: boolean, base?: string) => {
        if (base !== noteBase(vault.disk)) throw new api.ChangedOnDisk();
        vault.disk = content;
        return { path, content };
      });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <ReviewSession deck={deck} onLeave={vi.fn()} />
      </QueryClientProvider>,
    );
    return { vault, saved, decks };
  }

  /** Wait for the `reads`th read of the limits, and for whatever it set off. */
  async function refetched(read: () => number, reads: number) {
    await waitFor(() => expect(read()).toBe(reads));
    await act(async () => {});
  }

  const undoButton = () => screen.queryByRole("button", { name: "Undo" });

  /** Turn the card and rate it, then let the rating's write land. */
  async function rate(name: string) {
    fireEvent.click(screen.getByRole("button", { name: "Show answer" }));
    fireEvent.click(screen.getByRole("button", { name }));
    await act(async () => {});
  }

  /** The card on screen, once the undo has put `question` back on it. */
  function backOn(question: string) {
    return waitFor(() => expect(screen.getByTestId("review-card")).toHaveTextContent(question));
  }

  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("#600 I3 an undo pressed while the rating's write is out waits behind it and names its answer", async () => {
    const { vault, saved } = renderVault();
    let answer: (() => void) | undefined;
    saved.mockImplementationOnce(
      (path: string, content: string) =>
        new Promise((resolve) => {
          answer = () => {
            // The stamped block a note without one comes back with.
            vault.disk = `---\nid: x\n---\n${content}`;
            resolve({ path, content: vault.disk });
          };
        }),
    );
    await shownCard();
    fireEvent.click(screen.getByRole("button", { name: "Show answer" }));
    fireEvent.click(screen.getByRole("button", { name: "Good" }));

    const undo = undoButton();
    expect(undo).not.toBeNull();
    fireEvent.click(undo as HTMLElement);
    await act(async () => {});
    expect(saved).toHaveBeenCalledTimes(1);
    expect(undoButton()).toHaveAttribute("aria-disabled", "true");

    await act(async () => answer?.());

    await backOn("What is a VPC?");
    expect(saved).toHaveBeenCalledTimes(2);
    expect(saved.mock.calls[1]?.[1]).toBe(TWO);
    expect(saved.mock.calls[1]?.[3]).toBe(noteBase(`---\nid: x\n---\n${saved.mock.calls[0]?.[1]}`));
    expect(screen.queryByRole("alert")).toBeNull();
    expect(vault.disk).toBe(TWO);
  });

  it("#600 B1 nothing rates, parks, turns or jots the next card while an undo is out", async () => {
    // A in one note and B in another, so nothing done to B waits behind the
    // undo's write in the queue of A's note.
    const disk = new Map([
      ["x.md", "#flashcards/aws\n\nWhat is A?::a\n"],
      ["y.md", "#flashcards/aws\n\nWhat is B?::b\n"],
    ]);
    vi.spyOn(api, "fetchNote").mockImplementation(async (path: string) => disk.get(path) ?? "");
    const saved = vi
      .spyOn(api, "saveNote")
      .mockImplementation(async (path: string, content: string) => {
        disk.set(path, content);
        return { path, content };
      });
    // What the pane's keys reach, kept as the session hands it over.
    const held: { controls: ReviewControls } = { controls: null };
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <ReviewSession
          deck={{ ...DECK, notes: ["x.md", "y.md"], fresh: 2 }}
          onLeave={vi.fn()}
          onControls={(given) => {
            held.controls = given;
          }}
        />
      </QueryClientProvider>,
    );
    await shownCard();
    await rate("Good");
    let release: (() => void) | undefined;
    saved.mockImplementationOnce(
      (path: string, content: string) =>
        new Promise((resolve) => {
          release = () => {
            disk.set(path, content);
            resolve({ path, content });
          };
        }),
    );

    const undo = undoButton();
    expect(undo).not.toBeNull();
    fireEvent.click(undo as HTMLElement);
    await act(async () => {});

    expect(screen.getByTestId("review-card")).toHaveTextContent("What is B?");
    for (const name of ["Show answer", "Suspend", "Jot"]) {
      expect(screen.getByRole("button", { name })).toHaveAttribute("aria-disabled", "true");
    }
    // Taps on the greyed buttons, and the pane's keys, which reach the same
    // callbacks.
    for (const name of ["Show answer", "Suspend", "Jot"]) {
      fireEvent.click(screen.getByRole("button", { name }));
    }
    act(() => {
      held.controls?.reveal();
      held.controls?.capture();
      held.controls?.rate("good");
      held.controls?.suspend();
    });
    expect(screen.queryByTestId("review-back")).toBeNull();
    expect(screen.queryByTestId("review-capture")).toBeNull();
    expect(saved).toHaveBeenCalledTimes(2);

    await act(async () => release?.());

    // A back revealed, then B asked once: nothing done while the undo was out
    // came back through its landing.
    await backOn("What is A?");
    fireEvent.click(screen.getByRole("button", { name: "Good" }));
    await act(async () => {});
    await rate("Good");
    expect(await screen.findByTestId("review-done")).toHaveTextContent("2 answered");
    expect(saved).toHaveBeenCalledTimes(4);
  });

  it("#600 B2 a jot sent while an undo is out stays in its line and goes once the undo lands", async () => {
    const { vault, saved } = renderVault();
    await shownCard();
    await rate("Good");
    fireEvent.click(screen.getByRole("button", { name: "Jot" }));
    fireEvent.change(screen.getByLabelText("a new question"), {
      target: { value: "What is a moved block?" },
    });
    let release: (() => void) | undefined;
    saved.mockImplementationOnce(
      (path: string, content: string) =>
        new Promise((resolve) => {
          release = () => {
            vault.disk = content;
            resolve({ path, content });
          };
        }),
    );

    const undo = undoButton();
    expect(undo).not.toBeNull();
    fireEvent.click(undo as HTMLElement);
    await act(async () => {});
    fireEvent.submit(screen.getByTestId("review-capture"));
    await act(async () => {});

    expect(saved).toHaveBeenCalledTimes(2);
    expect(screen.getByLabelText("a new question")).toHaveValue("What is a moved block?");

    await act(async () => release?.());
    await backOn("What is a VPC?");
    fireEvent.submit(screen.getByTestId("review-capture"));
    await act(async () => {});

    expect(saved).toHaveBeenCalledTimes(3);
    expect(vault.disk).toContain("What is a VPC?::A private cloud\n");
    expect(vault.disk).toContain("What is a moved block?::");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("#600 B4 a jot held through an undo lands in the note it was opened on", async () => {
    const disk = new Map([
      ["x.md", "#flashcards/aws\n\nWhat is A?::a\n"],
      ["y.md", "#flashcards/aws\n\nWhat is B?::b\n"],
    ]);
    vi.spyOn(api, "fetchNote").mockImplementation(async (path: string) => disk.get(path) ?? "");
    const saved = vi
      .spyOn(api, "saveNote")
      .mockImplementation(async (path: string, content: string) => {
        disk.set(path, content);
        return { path, content };
      });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <ReviewSession deck={{ ...DECK, notes: ["x.md", "y.md"], fresh: 2 }} onLeave={vi.fn()} />
      </QueryClientProvider>,
    );
    await shownCard();
    await rate("Good");
    // Opened on B, which lives in y.md.
    fireEvent.click(screen.getByRole("button", { name: "Jot" }));
    fireEvent.change(screen.getByLabelText("a new question"), { target: { value: "Q?" } });

    const undo = undoButton();
    expect(undo).not.toBeNull();
    fireEvent.click(undo as HTMLElement);
    await backOn("What is A?");
    fireEvent.submit(screen.getByTestId("review-capture"));
    await act(async () => {});

    expect(saved).toHaveBeenCalledTimes(3);
    expect(saved.mock.calls[2]?.[0]).toBe("y.md");
    expect(disk.get("y.md")).toContain("Q?::");
    expect(disk.get("x.md")).not.toContain("Q?");
  });

  it("#600 B5 Jot it and Check are disabled while an undo is out, their text kept", async () => {
    localStorage.setItem("kasten.review.typing", "on");
    const { saved } = renderVault();
    await shownCard();
    fireEvent.submit(screen.getByTestId("review-typed"));
    fireEvent.click(screen.getByRole("button", { name: "Good" }));
    await act(async () => {});
    fireEvent.click(screen.getByRole("button", { name: "Jot" }));
    fireEvent.change(screen.getByLabelText("a new question"), { target: { value: "Q?" } });
    fireEvent.change(screen.getByLabelText("your answer"), { target: { value: "Storage" } });
    let release: (() => void) | undefined;
    saved.mockImplementationOnce(
      (path: string, content: string) =>
        new Promise((resolve) => {
          release = () => resolve({ path, content });
        }),
    );

    const undo = undoButton();
    expect(undo).not.toBeNull();
    fireEvent.click(undo as HTMLElement);
    await act(async () => {});

    expect(screen.getByRole("button", { name: "Jot it" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Check" })).toBeDisabled();
    expect(screen.getByLabelText("a new question")).toHaveValue("Q?");
    expect(screen.getByLabelText("your answer")).toHaveValue("Storage");

    await act(async () => release?.());
    await backOn("What is a VPC?");
    expect(screen.getByRole("button", { name: "Jot it" })).not.toBeDisabled();
  });

  it("#612 A1 a rating's refetch of a changed decks.md does not build the queue again", async () => {
    const { decks } = renderVault(TWO, { ...DECK, fresh: 2 }, ["", "aws: 5 new\n"]);
    await shownCard();
    await rate("Good");
    await refetched(() => decks.reads, 2);

    expect(screen.getByTestId("review-card")).toHaveTextContent("What is S3?");
    expect(screen.getByText(/^\d+ left$/).textContent).toBe("1 left");
    const reads = vi.mocked(api.fetchNote).mock.calls.filter(([path]) => path === "decks/aws.md");
    expect(reads).toHaveLength(1);
  });

  it("#612 A2 a card rated Again keeps its second asking across that refetch", async () => {
    const { decks } = renderVault(TWO, { ...DECK, fresh: 2 }, ["", "aws: 5 new\n"]);
    await shownCard();
    await rate("Again");
    await refetched(() => decks.reads, 2);
    await rate("Good");

    expect(screen.getByText(/^\d+ left$/).textContent).toBe("1 left");
    expect(screen.getByTestId("review-card")).toHaveTextContent("What is a VPC?");
  });

  it("#612 A3 the count left does not jump back when decks.md cuts the limit after a rating", async () => {
    const { decks } = renderVault(TWO, { ...DECK, fresh: 2 }, ["", "aws: 1 new\n"]);
    await shownCard();
    await rate("Good");
    await refetched(() => decks.reads, 2);

    expect(screen.getByText(/^\d+ left$/).textContent).toBe("1 left");
    expect(screen.getByTestId("review-card")).toHaveTextContent("What is S3?");
  });

  it("#612 A4 an undo puts back the queue behind the card when decks.md changes on every read", async () => {
    const { decks } = renderVault(TWO, { ...DECK, fresh: 2 }, ["", "aws: 2 new\n", "aws: 1 new\n"]);
    await shownCard();
    await rate("Good");
    await refetched(() => decks.reads, 2);

    const undo = undoButton();
    expect(undo).not.toBeNull();
    fireEvent.click(undo as HTMLElement);
    await backOn("What is a VPC?");
    await refetched(() => decks.reads, 3);

    expect(screen.getByText(/^\d+ left$/).textContent).toBe("2 left");
    fireEvent.click(screen.getByRole("button", { name: "Good" }));
    await act(async () => {});
    expect(screen.getByTestId("review-card")).toHaveTextContent("What is S3?");
  });

  it("#612 I3 a refetch that changes only the default limits builds nothing again", async () => {
    let reads = 0;
    vi.spyOn(api, "fetchReviewLimits").mockImplementation(async () => {
      reads += 1;
      return { new_per_day: reads === 1 ? null : 1, reviews_per_day: null };
    });
    renderVault();
    await shownCard();
    await rate("Good");
    await refetched(() => reads, 2);

    expect(screen.getByText(/^\d+ left$/).textContent).toBe("1 left");
    expect(screen.getByTestId("review-card")).toHaveTextContent("What is S3?");
  });
});
