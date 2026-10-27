import type { Root } from "react-dom/client";
import type { FoliateView } from "@/lib/book/foliate-view";
import plainUrl from "../fixtures/plain.epub?url";
import { chooseTheme, drawBook, drawn, sections, trackMounted } from "./book-pane-fixture";

const { fetchBook, fetchNote } = vi.hoisted(() => ({ fetchBook: vi.fn(), fetchNote: vi.fn() }));
vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  fetchBook,
  fetchNote,
}));

let mounted: { root: Root; container: HTMLElement } | null = null;
trackMounted((next) => {
  mounted = next;
});

/** The literature note as the vault holds it, with a place in it. */
function noteAt(cfi: string): string {
  return `---\nid: one\nreading: ${cfi}\n---\n# Plain\n`;
}

/**
 * The view the pane's own effect builds, once it has built it and the book has a place.
 * With `place`, waits until the reported place contains it.
 */
async function viewIn(container: HTMLElement, place = ""): Promise<FoliateView> {
  return vi.waitFor(
    () => {
      const view = container.querySelector("foliate-view") as FoliateView | null;
      expect(view?.lastLocation).toBeTruthy();
      if (place) expect(view?.lastLocation?.cfi).toContain(place);
      return view as FoliateView;
    },
    { timeout: 10_000 },
  );
}

describe("the place in a scrolled book", () => {
  afterEach(() => {
    mounted?.root.unmount();
    mounted?.container.remove();
    mounted = null;
    localStorage.clear();
  });

  it("reports the place a scroll reaches, and a reopen lands in the same paragraph", async () => {
    chooseTheme("light", "poel");
    const moved: string[] = [];
    const { container } = await drawBook("", plainUrl, (cfi) => moved.push(cfi));
    // A pane that holds a screen of the chapter and not all of it, so there is
    // a scroll to make. A pane too short to hold a line reports no visible range.
    container.style.cssText = "width: 1200px; height: 700px;";
    const view = await viewIn(container);
    await vi.waitFor(() => expect(sections.length).toBeGreaterThan(0), { timeout: 10_000 });
    await drawn();
    const before = view.lastLocation?.cfi;

    view.renderer?.next(91);

    // The scroll is reported as it lands, with the place it reached.
    await vi.waitFor(() => expect(moved.length).toBeGreaterThan(0), { timeout: 5_000 });
    const [cfi] = moved;
    expect(cfi).not.toBe(before);

    mounted?.root.unmount();
    mounted?.container.remove();
    mounted = null;
    const reopened = await drawBook(noteAt(cfi ?? ""), plainUrl);
    // A reopen first reports the section start, then the stored place once the book
    // lands on it, so wait for that place rather than read the first report.
    const again = await viewIn(reopened.container, "/4[para]");
    // The same paragraph and not the same character: the reopen lands on the
    // start of the paragraph the scroll reached, which is where the place says.
    expect(cfi).toContain("/4[para]");
    expect(again.lastLocation?.cfi).toContain("/4[para]");
  }, 30_000);

  it("scrolls the text on j, pressed in the book, and reports the place", async () => {
    chooseTheme("light", "poel");
    const moved: string[] = [];
    const { container } = await drawBook("", plainUrl, (cfi) => moved.push(cfi));
    container.style.cssText = "width: 1200px; height: 700px;";
    const view = await viewIn(container);
    await vi.waitFor(() => expect(sections.length).toBeGreaterThan(0), { timeout: 10_000 });
    await drawn();
    const before = view.lastLocation?.cfi;
    const doc = sections.at(-1) as Document;

    doc.body.dispatchEvent(new KeyboardEvent("keydown", { key: "j", bubbles: true }));

    await vi.waitFor(() => expect(moved.length).toBeGreaterThan(0), { timeout: 5_000 });
    expect(moved.at(-1)).not.toBe(before);
  }, 30_000);
});
