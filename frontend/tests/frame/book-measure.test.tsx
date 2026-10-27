import type { Root } from "react-dom/client";
import { page } from "vitest/browser";
import type { FoliateView } from "@/lib/book/foliate-view";
import plainUrl from "../fixtures/plain.epub?url";
import { drawBook, drawn, sections, trackMounted } from "./book-pane-fixture";

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

describe("the text at the reading measure", () => {
  afterEach(() => {
    mounted?.root.unmount();
    mounted?.container.remove();
    mounted = null;
  });

  it("sets the text at the reading measure in one column, in a wide pane", async () => {
    // A pane wider than the measure, so a column that is not at the measure shows.
    await page.viewport(1200, 800);
    try {
      const { container } = await drawBook("", plainUrl);
      container.style.cssText = "width: 1200px; height: 700px;";
      // The view is built by the pane's own effect, so it arrives after the mount.
      await vi.waitFor(
        () => {
          const view = container.querySelector("foliate-view") as FoliateView | null;
          expect(view?.lastLocation).toBeTruthy();
        },
        { timeout: 10_000 },
      );
      await vi.waitFor(() => expect(sections.length).toBeGreaterThan(0), { timeout: 10_000 });
      await drawn();

      const doc = sections.at(-1) as Document;
      expect(Math.round(doc.body.getBoundingClientRect().width)).toBe(680);
    } finally {
      await page.viewport(414, 896);
    }
  }, 30_000);
});
