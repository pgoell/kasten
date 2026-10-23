import "@fontsource-variable/jetbrains-mono/index.css";
// The faces the app loads in `main.tsx`. The book's frame gets copies of them
// from `book-fonts.ts`, which reads the app's own stylesheets, so the app must
// have them loaded here or there is nothing to copy.
import "@fontsource-variable/newsreader/opsz.css";
import type { Root } from "react-dom/client";
import { applyTheme, PALETTE_KEY, THEME_KEY } from "@/lib/theme";
import {
  chooseTheme as choose,
  computed,
  drawDark,
  drawn,
  trackMounted,
} from "./book-pane-fixture";

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

/** A theme colour as computed style spells it, `rgb(...)`, read off an element of the app. */
function themeColour(name: string): string {
  const probe = document.createElement("span");
  probe.style.color = `var(${name})`;
  document.body.append(probe);
  const { color } = getComputedStyle(probe);
  probe.remove();
  return color;
}

describe("the book's type", () => {
  afterEach(() => {
    mounted?.root.unmount();
    mounted?.container.remove();
    mounted = null;
    localStorage.removeItem(THEME_KEY);
    localStorage.removeItem(PALETTE_KEY);
    applyTheme();
  });

  /** The paragraph's type and colour, and the page's ground, as the book draws them. */
  async function expectSerif(doc: Document) {
    const view = doc.defaultView as Window;
    const paragraph = view.getComputedStyle(doc.querySelector("#plain") as Element);
    // Soft, so the size is still checked where the face is not Newsreader.
    expect.soft(paragraph.fontFamily).toContain("Newsreader");
    expect.soft(paragraph.fontSize).toBe("19px");
    expect(paragraph.color).toBe(themeColour("--k-ink"));
    expect(computed(doc, "body", "backgroundColor")).toBe(themeColour("--k-bg"));
    // The faces arrived in the book's own document, not only in the app's.
    expect(await doc.fonts.load('19px "Newsreader Variable"')).not.toHaveLength(0);
  }

  it("sets the text in Newsreader at 19 px in the ink on the ground, in light", async () => {
    choose("light", "poel");
    const { doc } = await drawDark();
    await drawn();

    await expectSerif(doc);
  }, 30_000);

  it("sets the text in Newsreader at 19 px in the ink on the ground, in dark", async () => {
    choose("dark", "poel");
    const { doc } = await drawDark();
    await drawn();

    await expectSerif(doc);
  }, 30_000);

  it("sets the text in Newsreader at 19 px in the ink on the ground, in another palette", async () => {
    choose("light", "russet");
    const { doc } = await drawDark();
    await drawn();

    await expectSerif(doc);
  }, 30_000);
});
