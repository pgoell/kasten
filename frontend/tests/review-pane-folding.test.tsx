import { QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ReviewPane } from "@/components/review-pane";
import * as api from "@/lib/api";
import * as review from "@/lib/review/review";
import { shownCard } from "./review-card";
import { noteOf, seededClient, serveNotes } from "./review-pane-fixture";
import { stubCommands } from "./stub-commands";

describe("ReviewPane folding the deck list (#517)", () => {
  /** A parent with one due, one new and one parked card below it, and a deck after it. */
  const TREE = [
    { path: "d.md", line: 1, text: "#flashcards/databases/postgres" },
    { path: "d.md", line: 2, text: "a::b" },
    { path: "d.md", line: 3, text: "c::d <!--SR:!2000-01-01,4,250-->" },
    { path: "d.md", line: 4, text: "e::f !suspended" },
    { path: "z.md", line: 1, text: "#flashcards/zz" },
    { path: "z.md", line: 2, text: "g::h" },
  ];
  const FOLDS = "kasten.review.folds.1";

  // Folds and the vim setting live in localStorage, so each test starts bare.
  beforeEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });
  afterEach(() => localStorage.clear());

  function renderTree() {
    vi.spyOn(api, "fetchReviewLimits").mockResolvedValue({
      new_per_day: null,
      reviews_per_day: null,
    });
    vi.spyOn(api, "fetchCards").mockResolvedValue(TREE);
    serveNotes(TREE);
    render(
      <QueryClientProvider client={seededClient(TREE)}>
        <ReviewPane commands={stubCommands()} onClose={vi.fn()} onOpen={vi.fn()} />
      </QueryClientProvider>,
    );
    screen.getByRole("button", { name: /^zz/ });
    return screen.getByLabelText("review");
  }

  const row = (name: string) => document.querySelector(`button[data-deck="${name}"]`);
  const press = (pane: HTMLElement, ...keys: string[]) => {
    for (const key of keys) fireEvent.keyDown(pane, { key });
  };

  it("#517 A1 folds a deck's subdecks behind a toggle, folded at first and kept per deck", () => {
    renderTree();

    expect(row("databases/postgres")).toBeNull();
    const toggle = screen.getByRole("button", { name: "unfold databases" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("button", { name: /fold zz/ })).toBeNull();

    fireEvent.click(toggle);
    expect(row("databases/postgres")).not.toBeNull();
    expect(screen.getByRole("button", { name: "fold databases" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );

    // A remount reads the fold back.
    cleanup();
    renderTree();
    expect(row("databases/postgres")).not.toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "fold databases" }));
    expect(row("databases/postgres")).toBeNull();
  });

  it("#517 A2 a folded deck counts due, new and parked for everything under it", () => {
    renderTree();

    expect(row("databases/postgres")).toBeNull();
    const parent = row("databases");
    expect(parent).toHaveTextContent("1 due");
    expect(parent).toHaveTextContent("1 new");
    expect(parent).toHaveTextContent("1 parked");
  });

  it.each(["on", "off"])(
    "#517 A3 za folds and unfolds the deck under the cursor, vim %s",
    (vim) => {
      localStorage.setItem("kasten.vim", vim);
      localStorage.setItem(FOLDS, JSON.stringify(["databases"]));
      const pane = renderTree();

      press(pane, "j");
      expect(document.activeElement).toBe(row("databases"));
      press(pane, "z", "a");
      expect(row("databases/postgres")).toBeNull();
      expect(document.activeElement).toBe(row("databases"));

      press(pane, "z", "a");
      expect(row("databases/postgres")).not.toBeNull();
    },
  );

  it("#517 A3 a z followed by another key leaves that key its own", () => {
    localStorage.setItem(FOLDS, JSON.stringify(["databases"]));
    const pane = renderTree();

    press(pane, "j", "z", "j");
    expect(document.activeElement).toBe(row("databases/postgres"));
    press(pane, "k", "z", "a");
    expect(row("databases/postgres")).toBeNull();
  });

  it("#517 I4 za on a subdeck folds its parent and moves the cursor to the parent's row", () => {
    localStorage.setItem(FOLDS, JSON.stringify(["databases"]));
    const pane = renderTree();

    press(pane, "j", "j");
    expect(document.activeElement).toBe(row("databases/postgres"));
    press(pane, "z", "a");

    expect(row("databases/postgres")).toBeNull();
    expect(document.activeElement).toBe(row("databases"));
  });

  it("#517 I4 za on a subdeck under a parent with nothing to offer moves the cursor to its toggle", () => {
    // A parent disabled above a subdeck that can be sat, which a daily limit
    // on the parent alone makes and the counts of today's cards never do.
    vi.spyOn(review, "decksFrom").mockReturnValue([
      { name: "trivia", notes: ["d.md"], due: 0, fresh: 0, parked: 0, whole: false, next: null },
      {
        name: "trivia/geography",
        notes: ["d.md"],
        due: 0,
        fresh: 1,
        parked: 0,
        whole: false,
        next: null,
      },
    ]);
    localStorage.setItem(FOLDS, JSON.stringify(["trivia"]));
    vi.spyOn(api, "fetchReviewLimits").mockResolvedValue({
      new_per_day: null,
      reviews_per_day: null,
    });
    vi.spyOn(api, "fetchCards").mockResolvedValue(TREE);
    serveNotes(TREE);
    render(
      <QueryClientProvider client={seededClient(TREE)}>
        <ReviewPane commands={stubCommands()} onClose={vi.fn()} onOpen={vi.fn()} />
      </QueryClientProvider>,
    );
    const pane = screen.getByLabelText("review");

    // The first `j` stops on the disabled parent's toggle, the second on the subdeck.
    press(pane, "j", "j");
    expect(document.activeElement).toBe(row("trivia/geography"));
    press(pane, "z", "a");

    expect(row("trivia/geography")).toBeNull();
    expect(row("trivia")).toBeDisabled();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "unfold trivia" }));

    // From the toggle, `l` unfolds and keeps the cursor there, and `j` walks on.
    press(pane, "l");
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "fold trivia" }));
    press(pane, "j");
    expect(document.activeElement).toBe(row("trivia/geography"));
  });

  it("#517 I5 j skips the rows a fold hides, and l on a folded deck sits all of it", async () => {
    const pane = renderTree();
    vi.spyOn(api, "fetchNote").mockResolvedValue(noteOf(TREE, "d.md"));

    press(pane, "j", "j");
    expect(document.activeElement).toBe(row("zz"));

    press(pane, "k", "l");
    expect(await shownCard()).toBeInTheDocument();
  });

  it("#517 I6 unreadable fold storage leaves everything below the top level folded", () => {
    const blocked = () => {
      throw new DOMException("blocked", "SecurityError");
    };
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(blocked);
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(blocked);
    renderTree();

    expect(row("databases/postgres")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "unfold databases" }));
    expect(row("databases/postgres")).not.toBeNull();
  });
});
