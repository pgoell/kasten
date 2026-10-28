/**
 * The gate on a `y` the page relays (#787, #877), in jsdom: where the user
 * activation cannot be spent, a relayed `y` takes once per visit, and the reader's
 * own press takes whatever the page relayed. The real activation, which jsdom
 * has not, is in `frame/html-pane-take-hostile.test.tsx`.
 */

import "fake-indexeddb/auto";
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { reset } from "@/lib/outbox";
import {
  answering,
  dropped,
  dumpsSent,
  fromPage,
  renderPane,
  selection,
  settled,
  takeButton,
  yFromPage,
} from "./html-pane-fixture";
import { stubMatchMedia } from "./match-media";

const { fetchNote, saveNote, updateNote, searchNotes } = vi.hoisted(() => ({
  fetchNote: vi.fn(),
  saveNote: vi.fn(),
  updateNote: vi.fn(),
  searchNotes: vi.fn(),
}));
vi.mock("@/lib/api", () => {
  class ChangedOnDisk extends Error {}
  return { fetchNote, saveNote, updateNote, searchNotes, ChangedOnDisk };
});

beforeEach(async () => {
  localStorage.clear();
  stubMatchMedia({});
  await reset();
  await dropped();
  fetchNote.mockResolvedValue("");
  saveNote.mockImplementation(async (path: string, content: string) => ({ path, content }));
  searchNotes.mockResolvedValue([]);
  updateNote.mockResolvedValue(null);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.resetAllMocks();
});

describe("a y the page relays", () => {
  it("a page that relays y twice in one visit takes only once", async () => {
    const sent = answering();
    const { frame } = renderPane();

    frame.focus();
    fromPage(frame.contentWindow, selection());
    yFromPage(frame);
    await screen.findByRole("status");
    fromPage(frame.contentWindow, selection({ text: "A second, forged passage." }));
    yFromPage(frame);
    await settled(() => dumpsSent(sent).length >= 2);

    expect(dumpsSent(sent)).toHaveLength(1);
  });

  it("where showPicker does not spend the activation, a relayed y takes once per visit", async () => {
    // A browser that reports the activation but whose picker leaves it, as one
    // that throws or shows nothing without consuming does.
    vi.stubGlobal(
      "navigator",
      Object.assign(Object.create(navigator), { userActivation: { isActive: true } }),
    );
    const picker = vi.fn();
    Object.defineProperty(HTMLInputElement.prototype, "showPicker", {
      value: picker,
      configurable: true,
    });
    try {
      const sent = answering();
      const { frame } = renderPane();

      frame.focus();
      fromPage(frame.contentWindow, selection());
      yFromPage(frame);
      await screen.findByRole("status");
      fromPage(frame.contentWindow, selection({ text: "A second, forged passage." }));
      yFromPage(frame);
      await settled(() => dumpsSent(sent).length >= 2);

      expect({ dumps: dumpsSent(sent).length, asked: picker.mock.calls.length > 0 }).toEqual({
        dumps: 1,
        asked: true,
      });
    } finally {
      vi.unstubAllGlobals();
      Reflect.deleteProperty(HTMLInputElement.prototype, "showPicker");
    }
  });

  it("a new visit to the page lets a relayed y take again", async () => {
    const sent = answering();
    const { frame } = renderPane();

    frame.focus();
    fromPage(frame.contentWindow, selection());
    yFromPage(frame);
    await screen.findByRole("status");
    fromPage(frame.contentWindow, selection({ text: "A second, forged passage." }));
    yFromPage(frame);
    await settled(() => dumpsSent(sent).length >= 2);
    expect(dumpsSent(sent)).toHaveLength(1);

    // The reader leaves the frame and comes back into it, which is a new visit.
    frame.focus();
    window.dispatchEvent(new Event("blur"));
    fromPage(frame.contentWindow, selection({ text: "A third passage." }));
    yFromPage(frame);
    await settled(() => dumpsSent(sent).length >= 2);

    expect(dumpsSent(sent)).toHaveLength(2);
    await screen.findByText("A third passage.");
  });

  it("the take button still takes after a relayed take", async () => {
    const sent = answering();
    const { frame } = renderPane();

    frame.focus();
    fromPage(frame.contentWindow, selection());
    yFromPage(frame);
    await screen.findByRole("status");
    fromPage(frame.contentWindow, selection({ text: "A second, forged passage." }));
    yFromPage(frame);
    await settled(() => dumpsSent(sent).length >= 2);
    expect(dumpsSent(sent)).toHaveLength(1);

    // The reader's own press takes what is held, whatever the page relayed.
    const button = takeButton();
    expect(button).not.toBeNull();
    fireEvent.click(button as HTMLElement);
    await settled(() => dumpsSent(sent).length >= 2);

    expect(dumpsSent(sent)).toHaveLength(2);
    await screen.findByText("A second, forged passage.");
  });
});
