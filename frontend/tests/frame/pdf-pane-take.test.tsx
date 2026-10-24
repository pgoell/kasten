/**
 * The take from a real pdf pane, in real Chromium: a passage selected in the
 * text layer, the button over it, `y` or a tap takes it, and the mark stays on
 * the page through a redraw.
 *
 * The pdf is the fixture from `./pdf-fixture`, served by `./pdf-take-api`, and the
 * dump it sends lands in the stubbed API the html take tests read too.
 */

import "./pdf-take-api";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook } from "@testing-library/react";
import { flushSync } from "react-dom";
import { commands as browser, page, userEvent } from "vitest/browser";
import { PdfPane } from "@/components/pdf-pane";
import { applyTheme, THEME_KEY, toggleTheme } from "@/lib/theme";
import { useVim } from "@/lib/vim-setting";
import "@/styles/app.css";
import { api, inside, type Mounted, setUp, takeButton, tearDown } from "./html-take-fixture";
import { PAGE_ONE } from "./pdf-fixture";

const PATH = "take/plan.pdf";
const LEFT = "take/left.pdf";
const RIGHT = "take/right.pdf";
/** The passage on page one, which is the whole of its text layer span. */
const WORDS = PAGE_ONE[0] ?? "";

// A pdf's first draw waits on pdf.js's own load, which runs past vitest's 15 s.
vi.setConfig({ testTimeout: 40_000 });

let mounted: Mounted;

beforeEach(async () => {
  mounted = await setUp();
});

afterEach(async () => {
  await tearDown(mounted);
});

/** One pdf pane per path, side by side, each the height of the viewport. */
function mount(paths: string[]) {
  // The take's recent-notes list asks through React Query, and a client per mount keeps
  // one test's cache from answering the next.
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  flushSync(() =>
    mounted.root.render(
      <QueryClientProvider client={client}>
        <div className="flex h-dvh flex-row">
          {paths.map((path) => (
            <div key={path} data-pane className="flex min-w-0 flex-1 flex-col">
              <PdfPane
                path={path}
                opened={1}
                commands={mounted.spy}
                focusSignal={1}
                onNoteBeside={() => {}}
              />
            </div>
          ))}
        </div>
      </QueryClientProvider>,
    ),
  );
}

/** The pane showing `path`. */
function paneOf(path: string): HTMLElement {
  return mounted.host.querySelector(`[data-pdf-pane="${path}"]`) as HTMLElement;
}

/** The text layer span holding the passage, once page one is drawn with its text. */
async function drawn(path: string): Promise<Element> {
  return vi.waitFor(
    () => {
      const span = [...paneOf(path).querySelectorAll('[data-pdf-page="1"] .textLayer span')].find(
        (one) => (one.textContent ?? "").includes(WORDS),
      );
      expect(span).toBeDefined();
      return span as Element;
    },
    { timeout: 20_000 },
  );
}

/** Selects the whole of `span`, the way a reader's drag over the words does. */
function selectSpan(span: Element): Range {
  const selection = window.getSelection() as Selection;
  const range = document.createRange();
  range.selectNodeContents(span);
  selection.removeAllRanges();
  selection.addRange(range);
  return range;
}

/** The text of every range the document's take mark holds. */
function markedWords(): string[] {
  return [...(CSS.highlights.get("kasten-taken") ?? [])].map((range) => range.toString());
}

/** Waits for the take button to draw over the selection, and returns it. */
async function buttonOver(): Promise<HTMLElement> {
  return vi.waitFor(
    () => {
      const button = takeButton(mounted);
      expect(button).not.toBeNull();
      return button as HTMLElement;
    },
    { timeout: 10_000 },
  );
}

describe("the pdf pane takes a passage from its text layer", () => {
  it("takes with y and marks the words, dumping the quote and its link", async () => {
    mount([PATH]);
    selectSpan(await drawn(PATH));
    await buttonOver();

    await userEvent.keyboard("y");

    await vi.waitFor(() => expect(api.dumps).toHaveLength(1));
    expect(api.dumps[0]).toContain(`> ${WORDS}`);
    expect(api.dumps[0]).toContain(`[[${PATH}#page=1|`);
    expect(markedWords()).toEqual([WORDS]);
  });

  it("keeps the scroll and the mark through a theme switch", async () => {
    localStorage.setItem(THEME_KEY, "light");
    applyTheme();
    mount([PATH]);
    selectSpan(await drawn(PATH));
    await buttonOver();
    await userEvent.keyboard("y");
    await vi.waitFor(() => expect(api.dumps).toHaveLength(1));

    const box = paneOf(PATH).querySelector("[data-pdf-box]") as HTMLElement;
    // Down a little, so the page with the passage is still the one at the top.
    box.scrollTop = 60;
    const before = box.querySelector('[data-pdf-page="1"] canvas');
    toggleTheme();

    // The redraw is done once page one holds a new canvas, and the mark is put
    // back on the new text layer when that layer has its words.
    await vi.waitFor(() =>
      expect(box.querySelector('[data-pdf-page="1"] canvas')).not.toBe(before),
    );
    await vi.waitFor(() => expect(markedWords()).toEqual([WORDS]));
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(box.scrollTop).toBe(60);
  });

  it("at 390 with touch puts the button under the words, 44 px tall, and a click takes", async () => {
    await page.viewport(390, 844);
    await browser.emulateMedia({ touch: true });
    mount([PATH]);
    const range = selectSpan(await drawn(PATH));
    const button = await buttonOver();

    const words = range.getBoundingClientRect();
    const box = button.getBoundingClientRect();
    expect(box.top).toBeGreaterThanOrEqual(words.bottom);
    expect(box.height).toBeGreaterThanOrEqual(44);
    expect(inside(button, paneOf(PATH))).toBe(true);

    await userEvent.click(button);
    await vi.waitFor(() => expect(api.dumps).toHaveLength(1));
  });

  it("in one of two panes puts the button in that pane only", async () => {
    mount([LEFT, RIGHT]);
    selectSpan(await drawn(RIGHT));
    await buttonOver();

    expect(paneOf(RIGHT).querySelector("[data-take]")).not.toBeNull();
    expect(paneOf(LEFT).querySelector("[data-take]")).toBeNull();
  });

  it.each(["on", "off"])("takes with y in vim mode %s", async (mode) => {
    localStorage.setItem("kasten.vim", mode);
    const vim = renderHook(() => useVim());
    expect(vim.result.current, "the vim setting this case names").toBe(mode === "on");
    vim.unmount();
    mount([PATH]);
    selectSpan(await drawn(PATH));
    await buttonOver();

    await userEvent.keyboard("y");

    await vi.waitFor(() => expect(api.dumps).toHaveLength(1));
  });
});
