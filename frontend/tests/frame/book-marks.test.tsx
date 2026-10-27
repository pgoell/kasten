import type { Root } from "react-dom/client";
import type { FoliateView } from "@/lib/book/foliate-view";
import darkUrl from "../fixtures/dark-text.epub?url";
import { chooseTheme, drawBook, rootToken, trackMounted } from "./book-pane-fixture";

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

/** A note holding one passage taken from chapter one, the paragraph the book paints black. */
const NOTE = [
  "## Highlights",
  "",
  "> A paragraph the book paints black.",
  "",
  "One ^hl-abcdef",
  "",
].join("\n");

/** The marks drawn on the section on screen: one `g` for each highlight, in the overlay foliate hung. */
function marks(container: HTMLElement): SVGGElement[] {
  const view = container.querySelector("foliate-view") as FoliateView;
  const overlayer = view.renderer?.getContents?.()[0]?.overlayer;
  return [...(overlayer?.element.querySelectorAll("g") ?? [])];
}

describe("the marks a taken passage draws", () => {
  afterEach(() => {
    mounted?.root.unmount();
    mounted?.container.remove();
    mounted = null;
    localStorage.clear();
  });

  it("draws a taken passage in the mark colour, at the token's own alpha", async () => {
    chooseTheme("light", "poel");
    const { container } = await drawBook(NOTE, darkUrl);
    await vi.waitFor(() => expect(marks(container)).toHaveLength(1), { timeout: 10_000 });

    const [mark] = marks(container);
    // Soft, so the alpha is still checked when the colour is not the mark's.
    expect.soft(mark?.getAttribute("fill")).toBe(rootToken("--k-mark"));
    expect.soft(getComputedStyle(mark as SVGGElement).opacity).toBe("1");
  }, 30_000);

  it("redraws the marks in the new colour and keeps the place on a theme switch", async () => {
    chooseTheme("light", "poel");
    const { container } = await drawBook(NOTE, darkUrl);
    await vi.waitFor(() => expect(marks(container)).toHaveLength(1), { timeout: 10_000 });
    const view = container.querySelector("foliate-view") as FoliateView;
    const place = view.lastLocation?.cfi;

    chooseTheme("dark", "poel");

    await vi.waitFor(() =>
      expect(marks(container)[0]?.getAttribute("fill")).toBe(rootToken("--k-mark")),
    );
    expect(place).toBeDefined();
    expect(view.lastLocation?.cfi).toBe(place);
  }, 30_000);
});
