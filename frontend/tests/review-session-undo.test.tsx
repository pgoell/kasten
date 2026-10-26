import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ReviewSession } from "@/components/review-session";
import * as api from "@/lib/api";
import { readClock } from "@/lib/clock";
import { noteBase } from "@/lib/note-base";
import { type Deck, decksFrom } from "@/lib/review";
import { shownCard } from "./review-card";
import { DECK } from "./review-session-fixture";

describe("ReviewSession undoing the last step (#600)", () => {
  const TWO = "#flashcards/aws\n\nWhat is a VPC?::A private cloud\n\nWhat is S3?::Storage\n";
  const MOVED_ON = "The note changed since that step, so it was not undone.";

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

  const undoButton = () => screen.queryByRole("button", { name: "Undo" });

  /** Turn the card and rate it, then let the rating's write land. */
  async function rate(name: string) {
    fireEvent.click(screen.getByRole("button", { name: "Show the answer" }));
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
    vi.useRealTimers();
  });

  it("#600 A5 Undo takes back a rating: the old text goes back and the card comes back revealed, first", async () => {
    const { vault, saved } = renderVault();
    await shownCard();
    await rate("Good");
    expect(screen.getByTestId("review-card")).toHaveTextContent("What is S3?");

    const undo = undoButton();
    expect(undo).not.toBeNull();
    fireEvent.click(undo as HTMLElement);

    await backOn("What is a VPC?");
    expect(screen.getByTestId("review-back")).toHaveTextContent("A private cloud");
    expect(screen.getByText(/left/).textContent).toBe("2 left");
    expect(saved).toHaveBeenCalledTimes(2);
    expect(saved.mock.calls[1]?.[1]).toBe(TWO);
    expect(saved.mock.calls[1]?.[3]).toBe(noteBase(saved.mock.calls[0]?.[1] ?? ""));
    expect(vault.disk).toBe(TWO);
  });

  it("#600 A6 Undo takes back a suspend, putting the cloze's other number back in the queue too", async () => {
    const cloze = "#flashcards/aws\n\nThe capital of {{c1::France}} is {{c2::Paris::a city}}.\n";
    const { vault } = renderVault(cloze);
    await shownCard();
    fireEvent.click(screen.getByRole("button", { name: "Park this card" }));
    await act(async () => {});
    expect(screen.getByTestId("review-done")).toBeInTheDocument();
    expect(vault.disk).toContain("!suspended");

    const undo = undoButton();
    expect(undo).not.toBeNull();
    fireEvent.click(undo as HTMLElement);

    await backOn("The capital of [...] is Paris.");
    expect(screen.getByTestId("review-back")).toHaveTextContent("France");
    expect(screen.getByText(/left/).textContent).toBe("2 left");
    expect(vault.disk).toBe(cloze);
  });

  it("#600 A7 holds one step: after an undo there is nothing more to take back", async () => {
    const { vault, saved } = renderVault();
    await shownCard();
    await rate("Good");
    await rate("Good");

    const undo = undoButton();
    expect(undo).not.toBeNull();
    fireEvent.click(undo as HTMLElement);

    await backOn("What is S3?");
    expect(undoButton()).toBeNull();
    expect(saved).toHaveBeenCalledTimes(3);
    // The rating before the one taken back stands.
    expect(vault.disk).toContain("What is a VPC?::A private cloud <!--SR:");
    expect(vault.disk).toContain("What is S3?::Storage\n");
  });

  it("#600 A8 an undone rating gives the card back its place under the daily limit", async () => {
    const limits = { note: "aws: 1 new\n", defaults: { new_per_day: null, reviews_per_day: null } };
    const today = readClock(new Date()).date;
    const row = (text: string) =>
      decksFrom([{ path: "decks/aws.md", text }], today, limits).find(
        (deck) => deck.name === "aws",
      );
    const { vault } = renderVault(TWO, { ...DECK, fresh: 1 }, limits.note);
    await shownCard();
    expect(screen.getByText(/left/).textContent).toBe("1 left");
    await rate("Good");
    expect(screen.getByTestId("review-done")).toBeInTheDocument();
    expect(row(vault.disk)?.fresh).toBe(0);

    const undo = undoButton();
    expect(undo).not.toBeNull();
    fireEvent.click(undo as HTMLElement);

    await backOn("What is a VPC?");
    expect(row(vault.disk)?.fresh).toBe(1);
  });

  it("#600 A9 an undo over a note changed since the step writes nothing and says so", async () => {
    const { vault, saved } = renderVault();
    await shownCard();
    await rate("Good");
    // Another pane, or the disk, writes over the rated note.
    const other = `${vault.disk}\nwritten elsewhere\n`;
    vault.disk = other;

    const undo = undoButton();
    expect(undo).not.toBeNull();
    fireEvent.click(undo as HTMLElement);

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(MOVED_ON));
    expect(screen.getByRole("alert")).not.toHaveTextContent("could not be written");
    expect(saved).toHaveBeenCalledTimes(2);
    expect(vault.disk).toBe(other);
    expect(screen.getByTestId("review-card")).toHaveTextContent("What is S3?");
    expect(screen.queryByTestId("review-back")).toBeNull();
    expect(screen.getByText(/left/).textContent).toBe("1 left");
  });

  it("#600 I1 rating the last card leaves Undo on the done screen, and it brings the card back", async () => {
    renderVault();
    await shownCard();
    await rate("Good");
    await rate("Good");
    expect(screen.getByTestId("review-done")).toHaveTextContent("2 answered");

    const undo = undoButton();
    expect(undo).not.toBeNull();
    fireEvent.click(undo as HTMLElement);

    await backOn("What is S3?");
    expect(screen.getByTestId("review-back")).toHaveTextContent("Storage");
    expect(screen.getByText(/left/).textContent).toBe("1 left");
  });

  it("#600 I2 undoing Again leaves no second seat of the card and takes the answer off the count", async () => {
    renderVault();
    await shownCard();
    await rate("Again");
    expect(screen.getByText(/left/).textContent).toBe("2 left");

    const undo = undoButton();
    expect(undo).not.toBeNull();
    fireEvent.click(undo as HTMLElement);

    await backOn("What is a VPC?");
    expect(screen.getByText(/left/).textContent).toBe("2 left");
    fireEvent.click(screen.getByRole("button", { name: "Good" }));
    await act(async () => {});
    await rate("Good");
    expect(await screen.findByTestId("review-done")).toHaveTextContent("2 answered");
  });

  it("#600 I4 an undo after a jot into the same note is refused, keeping the question", async () => {
    const { vault, saved } = renderVault();
    await shownCard();
    await rate("Good");
    fireEvent.click(screen.getByRole("button", { name: "Write a new question" }));
    fireEvent.change(screen.getByLabelText("a new question"), {
      target: { value: "What is a moved block?" },
    });
    fireEvent.submit(screen.getByTestId("review-capture"));
    await act(async () => {});
    // The jot named the rating's answer as its base, and landed.
    expect(vault.disk).toContain("What is a moved block?::");

    const undo = undoButton();
    expect(undo).not.toBeNull();
    fireEvent.click(undo as HTMLElement);

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(MOVED_ON));
    expect(saved).toHaveBeenCalledTimes(3);
    expect(saved.mock.calls[2]?.[3]).toBe(noteBase(saved.mock.calls[0]?.[1] ?? ""));
    expect(vault.disk).toContain("What is a moved block?::");
    expect(vault.disk).toContain("What is a VPC?::A private cloud <!--SR:");
    expect(screen.getByTestId("review-card")).toHaveTextContent("What is S3?");
  });

  it("#600 I5 an undo the network fails restores nothing and says why", async () => {
    const { vault, saved } = renderVault();
    await shownCard();
    await rate("Good");
    const rated = vault.disk;
    saved.mockRejectedValue(new TypeError("Failed to fetch"));
    vi.useFakeTimers();

    const undo = undoButton();
    expect(undo).not.toBeNull();
    fireEvent.click(undo as HTMLElement);

    // The write is tried again for about a minute, then the failure shows.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(screen.getByRole("alert")).toHaveTextContent(
      "The note could not be written: Failed to fetch",
    );
    expect(saved).toHaveBeenCalledTimes(9);
    expect(vault.disk).toBe(rated);
    expect(screen.getByTestId("review-card")).toHaveTextContent("What is S3?");
    expect(undoButton()).toBeNull();
  });

  it("#600 I6 a whole note gets its frontmatter schedule back, and then its suspend", async () => {
    const marked =
      "---\nsr-due: 2026-01-01\nsr-interval: 4\nsr-ease: 250\n---\n# TLS\n\nthe handshake\n";
    const { vault } = renderVault(marked, {
      name: "tls",
      notes: ["notes/tls.md"],
      due: 1,
      fresh: 0,
      parked: 0,
      whole: true,
      next: null,
    });
    await shownCard();
    fireEvent.click(screen.getByRole("button", { name: "Good" }));
    await act(async () => {});
    expect(vault.disk).toContain("sr-interval: 10");

    const undo = undoButton();
    expect(undo).not.toBeNull();
    fireEvent.click(undo as HTMLElement);
    await waitFor(() => expect(vault.disk).toBe(marked));
    await backOn("the handshake");

    fireEvent.click(screen.getByRole("button", { name: "Park this card" }));
    await act(async () => {});
    expect(vault.disk).toContain("sr-suspended: true");
    fireEvent.click(undoButton() as HTMLElement);

    await waitFor(() => expect(vault.disk).toBe(marked));
    await backOn("the handshake");
  });

  it("#600 an undo after the rating's write failed is refused, writing nothing", async () => {
    const { vault, saved } = renderVault();
    await shownCard();
    const landing = saved.getMockImplementation();
    saved.mockRejectedValue(new TypeError("Failed to fetch"));
    vi.useFakeTimers();
    await rate("Good");
    // The network is down for the whole minute of tries, then it is back.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(screen.getByRole("alert")).toHaveTextContent("could not be written: Failed to fetch");
    if (landing) saved.mockImplementation(landing);
    vi.useRealTimers();

    const undo = undoButton();
    expect(undo).not.toBeNull();
    fireEvent.click(undo as HTMLElement);

    // The rating never landed, so the base the undo names is one the vault
    // never held, and it refuses rather than guess.
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(MOVED_ON));
    expect(saved).toHaveBeenCalledTimes(9);
    expect(vault.disk).toBe(TWO);
    expect(screen.getByTestId("review-card")).toHaveTextContent("What is S3?");
  });
});
