import { QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ReviewPane } from "@/components/review-pane";
import * as api from "@/lib/api";
import { shownCard } from "./review-card";
import { renderPane, seededClient } from "./review-pane-fixture";
import { stubCommands } from "./stub-commands";

describe("ReviewPane leaving a sitting", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("goes back to the decks on h, leaving the pane open", async () => {
    const pane = await renderPane();
    vi.spyOn(api, "fetchNote").mockResolvedValue("#flashcards/beta\n\nc::d\n");

    fireEvent.keyDown(pane, { key: "j" });
    fireEvent.keyDown(pane, { key: "j" });
    fireEvent.keyDown(pane, { key: "l" });
    await shownCard();

    fireEvent.keyDown(pane, { key: "h" });

    expect(screen.queryByTestId("review-card")).not.toBeInTheDocument();
    expect(await screen.findByRole("button", { name: /alpha/ })).toBeInTheDocument();
  });
});

describe("ReviewPane suspending the card on screen", () => {
  const TWO = "#flashcards/beta\n\nc::d\n\ne::f\n";

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("parks it on s and shows the next one", async () => {
    const pane = await renderPane();
    vi.spyOn(api, "fetchNote").mockResolvedValue(TWO);
    vi.spyOn(api, "saveNote").mockResolvedValue({ path: "b.md", content: TWO });

    fireEvent.keyDown(pane, { key: "j" });
    fireEvent.keyDown(pane, { key: "j" });
    fireEvent.keyDown(pane, { key: "l" });
    expect(await shownCard()).toHaveTextContent("c");

    fireEvent.keyDown(pane, { key: "s" });

    expect(screen.getByTestId("review-card")).toHaveTextContent("e");
  });
});

describe("ReviewPane undoing the last step (#600)", () => {
  const TWO = "#flashcards/beta\n\nc::d\n\ne::f\n";

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    localStorage.clear();
  });

  /**
   * The pane's sitting of `beta`, its vault answering each write with what was sent.
   *
   * Only `b.md` reads as `note`. `decks.md` reads empty, and `rated` once a
   * write has gone out, so a test can change it under the rating's refetch;
   * `late.reads` counts those reads.
   */
  async function sitBeta(note: string, commands = stubCommands(), rated = "") {
    const pane = await renderPane(commands);
    const saved = vi
      .spyOn(api, "saveNote")
      .mockImplementation(async (path: string, content: string) => ({ path, content }));
    const late = { reads: 0 };
    vi.spyOn(api, "fetchNote").mockImplementation((path) => {
      if (path === "b.md") return Promise.resolve(note);
      if (path !== "99 Misc/01 Config/decks.md" || saved.mock.calls.length === 0) {
        return Promise.resolve("");
      }
      late.reads += 1;
      return Promise.resolve(rated);
    });
    fireEvent.keyDown(pane, { key: "j" });
    fireEvent.keyDown(pane, { key: "j" });
    fireEvent.keyDown(pane, { key: "l" });
    expect(await shownCard()).toHaveTextContent("c");
    return { pane, saved, late };
  }

  it.each(["on", "off"])(
    "#600 A5 u takes back the last rating on the sitting screen, vim %s",
    async (vim) => {
      localStorage.setItem("kasten.vim", vim);
      const { pane, saved } = await sitBeta(TWO);

      fireEvent.keyDown(pane, { key: " " });
      fireEvent.keyDown(pane, { key: "3" });
      expect(screen.getByTestId("review-card")).toHaveTextContent("e");
      await waitFor(() => expect(saved).toHaveBeenCalledOnce());

      fireEvent.keyDown(pane, { key: "u" });

      await waitFor(() => expect(saved).toHaveBeenCalledTimes(2));
      expect(saved.mock.calls[1]?.[1]).toBe(TWO);
      await waitFor(() => expect(screen.getByTestId("review-card")).toHaveTextContent("c"));
      expect(screen.getByTestId("review-back")).toHaveTextContent("d");
    },
  );

  it.each(["on", "off"])(
    "#612 A5 a rating's refetch of a changed decks.md leaves the pane's sitting as it was, vim %s",
    async (vim) => {
      localStorage.setItem("kasten.vim", vim);
      const { pane, late } = await sitBeta(TWO, stubCommands(), "beta: 1 new\n");

      fireEvent.keyDown(pane, { key: " " });
      fireEvent.keyDown(pane, { key: "3" });
      await waitFor(() => expect(late.reads).toBeGreaterThan(0));
      await act(async () => {});

      expect(screen.getByText(/^\d+ left$/).textContent).toBe("1 left");
      expect(screen.getByTestId("review-card")).toHaveTextContent("e");
    },
  );

  it("#600 I1 u on the done screen brings back the last card rated", async () => {
    const { pane, saved } = await sitBeta("#flashcards/beta\n\nc::d\n");

    fireEvent.keyDown(pane, { key: " " });
    fireEvent.keyDown(pane, { key: "3" });
    expect(screen.getByTestId("review-done")).toBeInTheDocument();
    await waitFor(() => expect(saved).toHaveBeenCalledOnce());

    fireEvent.keyDown(pane, { key: "u" });

    await waitFor(() => expect(saved).toHaveBeenCalledTimes(2));
    expect(saved.mock.calls[1]?.[1]).toBe("#flashcards/beta\n\nc::d\n");
    await waitFor(() => expect(screen.getByTestId("review-card")).toHaveTextContent("c"));
    expect(screen.getByTestId("review-back")).toHaveTextContent("d");
  });

  it("#600 B3 space on the done screen holding Undo starts the leader, and reveals nothing", async () => {
    const commands = stubCommands();
    const { pane } = await sitBeta("#flashcards/beta\n\nc::d\n", commands);
    fireEvent.keyDown(pane, { key: " " });
    fireEvent.keyDown(pane, { key: "3" });
    expect(screen.getByTestId("review-done")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Undo" })).not.toBeNull();

    fireEvent.keyDown(pane, { key: " " });
    fireEvent.keyDown(pane, { key: "b" });

    expect(commands.toggleTree).toHaveBeenCalledOnce();
    expect(screen.getByTestId("review-done")).toBeInTheDocument();
  });

  it("#600 B6 a header button clicked before u keeps the focus, and the keys, in the pane", async () => {
    const { pane, saved } = await sitBeta(TWO);
    const suspend = screen.getByRole("button", { name: "Suspend" });
    // A mouse click focuses the button before it presses it.
    suspend.focus();
    fireEvent.click(suspend);
    expect(screen.getByTestId("review-card")).toHaveTextContent("e");
    await waitFor(() => expect(saved).toHaveBeenCalledOnce());
    let release: (() => void) | undefined;
    saved.mockImplementationOnce(
      (path: string, content: string) =>
        new Promise((resolve) => {
          release = () => resolve({ path, content });
        }),
    );

    fireEvent.keyDown(suspend, { key: "u" });
    await waitFor(() => expect(saved).toHaveBeenCalledTimes(2));

    // Greyed and still focused while the undo is out: a disabled button would
    // have handed the focus to the body.
    expect(suspend).toHaveAttribute("aria-disabled", "true");
    expect(suspend).not.toBeDisabled();
    expect(document.activeElement).toBe(suspend);

    await act(async () => release?.());
    await waitFor(() => expect(screen.getByTestId("review-card")).toHaveTextContent("c"));
    expect(pane.contains(document.activeElement)).toBe(true);
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: "3" });

    await waitFor(() => expect(saved).toHaveBeenCalledTimes(3));
    expect(screen.getByTestId("review-card")).toHaveTextContent("e");
  });
});

describe("ReviewPane replaying a card's sound", () => {
  const SOUNDED = "#flashcards/beta\n\nc ![](beta%20media/c.mp3)::d ![](beta%20media/d.mp3)\n";

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("plays the side showing again on r, the front before the answer and the back after", async () => {
    // jsdom draws a media element and plays nothing, so the player is stubbed.
    // The source is read at the call: the session reuses one element.
    const sources: string[] = [];
    vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(function (
      this: HTMLMediaElement,
    ) {
      sources.push(this.src);
      return Promise.resolve();
    });
    vi.spyOn(HTMLMediaElement.prototype, "pause").mockReturnValue(undefined);
    const pane = await renderPane();
    vi.spyOn(api, "fetchNote").mockResolvedValue(SOUNDED);

    fireEvent.keyDown(pane, { key: "j" });
    fireEvent.keyDown(pane, { key: "j" });
    fireEvent.keyDown(pane, { key: "l" });
    await shownCard();
    const played = () => [...sources];

    fireEvent.keyDown(pane, { key: "r" });
    expect(played().at(-1)).toMatch(/\/api\/assets\/beta%20media\/c\.mp3$/);

    fireEvent.keyDown(pane, { key: " " });
    fireEvent.keyDown(pane, { key: "r" });
    expect(played().at(-1)).toMatch(/\/api\/assets\/beta%20media\/d\.mp3$/);
    expect(played().filter((src) => src.endsWith("d.mp3"))).toHaveLength(2);
  });
});

describe("ReviewPane jotting a question mid-sitting", () => {
  const TWO = "#flashcards/beta\n\nc::d\n\ne::f\n";

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  async function inSitting() {
    const pane = await renderPane();
    vi.spyOn(api, "fetchNote").mockResolvedValue(TWO);
    const saved = vi.spyOn(api, "saveNote").mockResolvedValue({ path: "b.md", content: TWO });

    fireEvent.keyDown(pane, { key: "j" });
    fireEvent.keyDown(pane, { key: "j" });
    fireEvent.keyDown(pane, { key: "l" });
    await shownCard();
    return { pane, saved };
  }

  it("opens the field on n and puts the cursor in it", async () => {
    const { pane } = await inSitting();

    fireEvent.keyDown(pane, { key: "n" });

    expect(document.activeElement).toBe(screen.getByLabelText("a new question"));
  });

  it("does not rate the card while a question is being typed", async () => {
    const { pane, saved } = await inSitting();
    fireEvent.keyDown(pane, { key: "n" });

    // The pane's own rating keys are live on the section this bubbles to.
    fireEvent.keyDown(screen.getByLabelText("a new question"), { key: "1" });

    expect(saved).not.toHaveBeenCalled();
    expect(screen.getByTestId("review-card")).toHaveTextContent("c");
  });
});

describe("ReviewPane on a nested cloze", () => {
  const NESTED = "#flashcards/capitals\n\n{{c1::Canberra was {{c2::founded}} in 1913}}\n";
  const HITS = [
    { path: "c.md", line: 1, text: "#flashcards/capitals" },
    { path: "c.md", line: 3, text: "{{c1::Canberra was {{c2::founded}} in 1913}}" },
  ];

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("A8 a nested cloze is asked as c1 then c2 and rated by key", async () => {
    vi.spyOn(api, "fetchCards").mockResolvedValue(HITS);
    vi.spyOn(api, "fetchNote").mockResolvedValue(NESTED);
    // The vault answers with what was sent: the next rating starts from it.
    const saved = vi
      .spyOn(api, "saveNote")
      .mockImplementation(async (path: string, content: string) => ({ path, content }));
    const client = seededClient(HITS);
    render(
      <QueryClientProvider client={client}>
        <ReviewPane commands={stubCommands()} onClose={vi.fn()} onOpen={vi.fn()} />
      </QueryClientProvider>,
    );
    screen.getByRole("button", { name: /capitals/ });
    const pane = screen.getByLabelText("review");

    fireEvent.keyDown(pane, { key: "j" });
    fireEvent.keyDown(pane, { key: "l" });

    // c1 hides the whole span, the inner mark with it.
    expect(await shownCard()).toHaveTextContent(/^\[\.\.\.\]$/);
    fireEvent.keyDown(pane, { key: " " });
    expect(screen.getByTestId("review-back")).toHaveTextContent("Canberra was founded in 1913");
    fireEvent.keyDown(pane, { key: "3" });

    expect(saved.mock.calls[0]?.[1]).toMatch(
      /^#flashcards\/capitals\n\n\{\{c1::Canberra was \{\{c2::founded\}\} in 1913\}\} <!--SR:c1![\d-]+,1,250-->\n$/,
    );

    // c2 hides the inner word alone.
    await waitFor(() =>
      expect(screen.getByTestId("review-card")).toHaveTextContent(
        /^Canberra was \[\.\.\.\] in 1913$/,
      ),
    );
    fireEvent.keyDown(pane, { key: " " });
    fireEvent.keyDown(pane, { key: "3" });

    expect(saved.mock.calls[1]?.[1]).toMatch(
      /^#flashcards\/capitals\n\n\{\{c1::Canberra was \{\{c2::founded\}\} in 1913\}\} <!--SR:c1![\d-]+,1,250--> <!--SR:c2![\d-]+,1,250-->\n$/,
    );
    expect(await screen.findByTestId("review-done")).toBeInTheDocument();
  });
});
