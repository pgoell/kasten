import { act, fireEvent, render, screen } from "@testing-library/react";
import { Rsvp } from "@/components/rsvp";
import type { RsvpSource } from "@/lib/rsvp";
import { textWords } from "@/lib/rsvp-sources";

const fetchRsvp = vi.fn();
const saveRsvp = vi.fn();

vi.mock("@/lib/rsvp-api", () => ({
  fetchRsvp: (...args: unknown[]) => fetchRsvp(...args),
  saveRsvp: (...args: unknown[]) => saveRsvp(...args),
}));

const TEXT = "One two three. Four five six.\nSeven eight.";

function source(overrides: Partial<RsvpSource> = {}): RsvpSource {
  return { path: "notes/a.md", words: async () => textWords(TEXT), here: () => 4, ...overrides };
}

/** The chunk on screen, read off the three spans that place it. */
function shown(): string {
  const output = screen.getByRole("dialog").querySelector("output");
  return [...(output?.children ?? [])].map((span) => span.textContent).join("");
}

function press(key: string) {
  fireEvent.keyDown(screen.getByRole("dialog"), { key });
}

beforeEach(() => {
  fetchRsvp.mockReset();
  saveRsvp.mockReset();
  saveRsvp.mockResolvedValue({});
  localStorage.clear();
});

describe("the RSVP overlay", () => {
  it("resumes at the saved place and walks sentences and paragraphs", async () => {
    fetchRsvp.mockResolvedValue({ word: 1, words: 8, anchor: "two three. Four five six." });
    render(<Rsvp source={source()} here={false} onClose={() => {}} />);

    await screen.findByText("w");
    expect(shown()).toBe("two");
    press("l");
    expect(shown()).toBe("Four");
    press("L");
    expect(shown()).toBe("Seven");
    press("h");
    expect(shown()).toBe("Four");
    press("H");
    expect(shown()).toBe("One");
  });

  it("plays chunk by chunk and saves where it paused and where it closed", async () => {
    vi.useFakeTimers();
    try {
      fetchRsvp.mockResolvedValue(null);
      const onClose = vi.fn();
      const { unmount } = render(<Rsvp source={source()} here={false} onClose={onClose} />);
      await act(async () => {
        await vi.runOnlyPendingTimersAsync();
      });
      expect(shown()).toBe("One");

      press(" ");
      // 300 words a minute is 200ms a word.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(200);
      });
      expect(shown()).toBe("two");
      press(" ");
      expect(saveRsvp).toHaveBeenLastCalledWith("notes/a.md", {
        word: 1,
        words: 8,
        anchor: "two three. Four five six.",
      });

      press("l");
      press("Escape");
      expect(onClose).toHaveBeenCalled();
      unmount();
      // Sent once the pause's save has landed.
      await act(async () => {
        await vi.runOnlyPendingTimersAsync();
      });
      expect(saveRsvp).toHaveBeenLastCalledWith("notes/a.md", expect.objectContaining({ word: 3 }));
    } finally {
      vi.useRealTimers();
    }
  });

  it("sends a save only once the one before it has landed", async () => {
    fetchRsvp.mockResolvedValue(null);
    let land: () => void = () => {};
    saveRsvp.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          land = () => resolve({});
        }),
    );
    const { unmount } = render(<Rsvp source={source()} here={false} onClose={() => {}} />);
    await screen.findByText("n");

    press("l");
    press(" ");
    press(" ");
    press("l");
    // The second place goes out on the way out, while the first is still in the air.
    unmount();
    expect(saveRsvp).toHaveBeenCalledTimes(1);

    await act(async () => land());
    await vi.waitFor(() => expect(saveRsvp).toHaveBeenCalledTimes(2));
    expect(saveRsvp).toHaveBeenLastCalledWith("notes/a.md", expect.objectContaining({ word: 6 }));
  });

  it("starts from here and saves that as the place", async () => {
    fetchRsvp.mockResolvedValue({ word: 1, words: 8, anchor: "two three. Four five six." });
    render(<Rsvp source={source()} here onClose={() => {}} />);

    await screen.findByText("i");
    expect(shown()).toBe("five");
    expect(saveRsvp).toHaveBeenCalledWith("notes/a.md", expect.objectContaining({ word: 4 }));
  });

  it("changes the speed with j and k, and keeps it", async () => {
    fetchRsvp.mockResolvedValue(null);
    render(<Rsvp source={source()} here={false} onClose={() => {}} />);
    await screen.findByText("n");

    press("k");
    press("k");
    press("j");
    expect(screen.getByText("325")).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem("kasten.rsvp") ?? "{}").wpm).toBe(325);
  });

  it("stops every key at the dialog, so the pane under it hears none", async () => {
    fetchRsvp.mockResolvedValue(null);
    const heard = vi.fn();
    render(
      // A stand-in for a pane's own native key listener.
      <div ref={(element) => element?.addEventListener("keydown", heard)}>
        <Rsvp source={source()} here={false} onClose={() => {}} />
      </div>,
    );
    await screen.findByText("n");
    press("l");
    press("q");
    expect(heard).not.toHaveBeenCalled();
  });

  it("says why when the text cannot be read", async () => {
    fetchRsvp.mockResolvedValue(null);
    const failing = source({
      words: async () => {
        throw new Error("The pdf is still opening");
      },
    });
    render(<Rsvp source={failing} here={false} onClose={() => {}} />);
    expect(await screen.findByText("The pdf is still opening")).toBeInTheDocument();
  });
});
