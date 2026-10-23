import { act, renderHook, waitFor } from "@testing-library/react";
import type { RefObject } from "react";
import type { FoliateView } from "@/lib/foliate-view";
import { useBookView } from "@/lib/use-book-view";
import { CFI, CHAPTERS } from "./book-pane-fixture";
import { defineFoliateFake, FakeView, lastView, resetFoliateFake } from "./foliate-fake";

const { fetchNote } = vi.hoisted(() => ({ fetchNote: vi.fn() }));
vi.mock("@/lib/api", () => ({ fetchNote, fetchBook: vi.fn(), uploadAsset: vi.fn() }));

// The factory is not optional, for the reason `book-pane-keys.test.tsx` gives.
vi.mock("foliate-js/view.js", () => ({}));

defineFoliateFake();

/** The view hook over a host and a view ref, with every callback a no-op. */
function mount() {
  const host = { current: document.createElement("div") } as RefObject<HTMLDivElement | null>;
  const viewRef = { current: null } as RefObject<FoliateView | null>;
  const ready = { current: false } as RefObject<boolean>;
  const beside = { path: "20 Literature/DDIA.epub", blob: new Blob(["a book"]) };
  const noop = () => {};
  // Built once, outside the render: the view is rebuilt whenever one of these
  // changes identity, and a fresh arrow per render would rebuild it forever.
  const callbacks = {
    onFocus: noop,
    onMoved: noop,
    onKeyDown: noop,
    repaint: noop,
    watchPage: () => undefined,
    select: noop,
    follow: noop,
    forgetUnless: noop,
    tap: noop,
    release: noop,
    forget: noop,
    resumeSeek: () => false,
  };
  const { result, unmount } = renderHook(() =>
    useBookView({
      host,
      viewRef,
      ready,
      beside,
      note: "20 Literature/DDIA.md",
      ...callbacks,
    }),
  );
  return { result, unmount };
}

/** Move the reader, as the renderer does, with `tocItem` set where the book is. */
function moveTo(tocItem: { id?: number; label?: string; href?: string } | undefined) {
  act(() => {
    lastView().lastLocation = { cfi: CFI, tocItem };
    lastView().emitRelocate({ reason: "page" });
  });
}

describe("the view hook's contents and chapter", () => {
  beforeEach(() => {
    resetFoliateFake();
    fetchNote.mockResolvedValue("");
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  it("answers the book's contents as rows once the book has opened", async () => {
    FakeView.toc = CHAPTERS;
    const { result, unmount } = mount();

    // Optional on the read, so a hook without rows fails the assertion and not a TypeError.
    await waitFor(() =>
      expect(result.current.rows?.map((row) => row.label)).toEqual(["One", "Two"]),
    );
    unmount();
  });

  it("names the chapter the reader is in, with its label trimmed", async () => {
    FakeView.toc = CHAPTERS;
    const { result, unmount } = mount();
    await waitFor(() => expect(lastView().started).toBe(true));

    moveTo({ id: 1, label: "  Two  ", href: "ch2.xhtml" });

    expect(result.current.chapter).toEqual({ id: 1, label: "Two" });
    unmount();
  });

  it("names no chapter where the reader is in one the book does not name", async () => {
    FakeView.toc = CHAPTERS;
    const { result, unmount } = mount();
    await waitFor(() => expect(lastView().started).toBe(true));
    moveTo(CHAPTERS[0]);

    moveTo(undefined);

    expect(result.current.chapter).toBeNull();
    unmount();
  });
});

describe("the view hook's flow", () => {
  beforeEach(() => {
    resetFoliateFake();
    fetchNote.mockResolvedValue("");
    document.documentElement.style.setProperty("--k-measure", "680px");
  });

  afterEach(() => {
    document.documentElement.style.removeProperty("--k-measure");
    vi.resetAllMocks();
  });

  it("sets a flowing book to scroll at the reading measure before it is read", async () => {
    const { unmount } = mount();
    await waitFor(() => expect(lastView().started).toBe(true));

    expect.soft(lastView().renderer.attributes.get("flow")).toBe("scrolled");
    expect.soft(lastView().renderer.attributes.get("max-inline-size")).toBe("680px");
    unmount();
  });

  it("leaves a fixed-layout book's flow as the book drew it", async () => {
    FakeView.fixedLayout = true;
    const { unmount } = mount();
    await waitFor(() => expect(lastView().started).toBe(true));

    expect(lastView().renderer.attributes.has("flow")).toBe(false);
    unmount();
  });
});
