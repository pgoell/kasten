import { resetHeld } from "@/lib/held-text";
import { openInFocused } from "@/lib/pane-contents";
import { emptyLayout, splitFocused } from "@/lib/panes";
import { need, nextFrame, READER, registerReaderFixture, TOUCH, unmount } from "./reader-fixture";
import { DESIGN, mountTabs, registerTabNotes } from "./tab-strip-fixture";

vi.mock("@/lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...real,
    fetchFiles: vi.fn(),
    fetchNote: vi.fn(),
    saveNote: async (path: string, content: string) => ({ path, content }),
    searchNotes: vi.fn(),
    fetchTodos: vi.fn(),
    fetchImages: async () => [],
    fetchHtml: async () => [],
    fetchAssets: async () => [],
    fetchTags: async () => [],
    fetchTerminals: async () => [],
    fetchVersion: async () => "0.8.0",
    fetchWeather: async () => [],
  };
});

vi.mock("@/lib/trash-api", async (original) => ({
  ...(await original<typeof import("@/lib/trash-api")>()),
  fetchTrash: async () => [],
}));

vi.mock("@/lib/graph-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/graph-api")>()),
  fetchGraph: vi.fn(),
}));

registerReaderFixture();
registerTabNotes();
afterEach(() => resetHeld());

/** The reader on one side and the design notes on the other, split on a phone (#793 A5). */
function split() {
  return openInFocused(splitFocused(emptyLayout(READER), "row"), DESIGN);
}

/** The panes the tab draws, which are the ones with a box on screen. */
function panesOn(host: HTMLElement): HTMLElement[] {
  return [...host.querySelectorAll<HTMLElement>("[data-pane]")].filter(
    (pane) => pane.getClientRects().length > 0,
  );
}

describe("#793 A5 a split on a phone", () => {
  it("#793 A5 at 390x844 with touch both panes show, one above the other, full width", async () => {
    const mounted = await mountTabs(TOUCH, "light", split());
    expect(panesOn(mounted.host)).toHaveLength(2);
    const [upper, lower] = panesOn(mounted.host);
    if (!upper || !lower) throw new Error("two panes are on screen after the split");

    const top = upper.getBoundingClientRect();
    const bottom = lower.getBoundingClientRect();
    expect(top.height).toBeGreaterThan(100);
    expect(bottom.height).toBeGreaterThan(100);
    expect(bottom.top).toBeGreaterThanOrEqual(top.bottom);
    expect(bottom.width).toBeGreaterThan(TOUCH.width - 40);
    expect(top.width).toBeCloseTo(bottom.width, 0);
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(
      document.documentElement.clientWidth,
    );

    await unmount(mounted);
  });

  it("#793 I1 at 390x844 with touch a tap on the lower pane moves the focus line to it", async () => {
    const mounted = await mountTabs(TOUCH, "light", split());
    expect(panesOn(mounted.host)).toHaveLength(2);
    const [upper, lower] = panesOn(mounted.host);
    if (!upper || !lower) throw new Error("two panes are on screen after the split");
    const focusLine = (pane: HTMLElement) =>
      pane.querySelector("[data-focus-line]")?.classList.contains("bg-k-accent");
    expect(focusLine(lower)).toBe(true);
    expect(focusLine(upper)).toBe(false);

    // A tap puts the focus in the pane's own editor, which is what moves the focus.
    need(upper.querySelector<HTMLElement>(".cm-content"), "editor in the upper pane").focus();
    await nextFrame();
    expect(focusLine(upper)).toBe(true);

    need(lower.querySelector<HTMLElement>(".cm-content"), "editor in the lower pane").focus();
    await nextFrame();
    expect(focusLine(lower)).toBe(true);
    expect(focusLine(upper)).toBe(false);

    await unmount(mounted);
  });
});
