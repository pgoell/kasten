/**
 * What opening the app over a 10,000-note vault costs, in a real browser.
 *
 * Recorded, not gated. This file asserts nothing about time; a wall clock on a
 * shared runner is a worse gate than a reader. It exists so the next session
 * starts from numbers rather than from a feeling.
 *
 * These are the numbers the tree was folded against. Mounting every row cost
 * 443 to 462ms to the first one and 834 to 859ms to the paint, over 10,842
 * buttons. The tree opens folded now, which is 8 rows, 10 to 34ms and 15 to
 * 65ms. What holds it there is a test in the jsdom suite rather than a
 * threshold here: `tests/file-explorer.test.tsx` asserts the folders start
 * folded, which is the thing that would have to break for these to climb back.
 *
 * The console lines below do not reach the terminal through vitest's browser
 * mode. Read them by making the test fail, which is what the assertion message
 * is for elsewhere in this repo, or trust the figures recorded above.
 *
 * Read the numbers as development-build React served through Vite, the same
 * caveat `tests/frame/note-prompt.test.tsx` carries. Production React is
 * materially cheaper on reconciliation, so nobody should quote these as the
 * deployed figures.
 *
 * The shell here is the route's two panes, the file tree and the editor, built
 * by hand rather than through the router. `routes/index.tsx` reaches for
 * `useSearch`, `useNavigate` and `GET /api/files`, none of which is load cost:
 * a router and a stubbed fetch would put a dev-server round trip and a lazy
 * route chunk inside the measured window and answer a different question.
 *
 * First contentful paint is read below and comes back empty, which is the
 * honest answer rather than a broken one. Chromium records paint timing for
 * the outermost frame only, and a vitest browser test runs inside the runner's
 * tester iframe. The entry the outer page holds would time the runner's own
 * chrome, not the vault. The two measured numbers are what stands in for it.
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createRoot } from "react-dom/client";
import { Editor } from "@/components/editor";
import { FileExplorer } from "@/components/file-explorer";
import type { TreeCommands } from "@/lib/key-bindings";
import { syntheticVault } from "../../bench/fixtures";

/** The size the whole performance round is measured at. */
const NOTES = 10000;

/** The keys reach these. Nothing here presses one. */
const INERT: TreeCommands = {
  toggleTree: () => {},
  toggleArchive: () => {},
  togglePreview: () => {},
  closeNote: () => {},
  showHelp: () => {},
  focusTree: () => {},
  createNote: () => {},
  renameNote: () => {},
  deleteNote: () => {},
  restoreDeleted: () => {},
  deleteFolder: () => {},
  findNote: vi.fn(),
  searchNotes: vi.fn(),
  findTodos: vi.fn(),
  openTodos: vi.fn(),
  showBacklinks: vi.fn(),
  showLinksOut: vi.fn(),
  openDaily: vi.fn(),
  openWeekly: vi.fn(),
  openMonthly: vi.fn(),
  openQuarterly: vi.fn(),
  openYearly: vi.fn(),
  openBook: vi.fn(),
  uploadBook: vi.fn(),
  importNotes: vi.fn(),
  exportNote: vi.fn(),
  openExam: vi.fn(),
  renameFolder: () => {},
  createTab: () => {},
  openTerminal: () => {},
  importPage: () => {},
  splitRight: () => {},
  splitDown: () => {},
  nextPane: () => {},
  paneLeft: () => {},
  paneDown: () => {},
  paneUp: () => {},
  paneRight: () => {},
  nextTab: () => {},
  prevTab: () => {},
  goToTab: () => {},
};

/** What the route opens with when no note is chosen, shortened. */
const SAMPLE = "# kasten\n\nNotes are plain markdown files on disk.\n";

/** The tree's rows carry `data-row`; the first one is the first row drawn. */
function firstRow(): Element | null {
  return document.querySelector("[data-row]");
}

/** Resolves on the browser's next animation frame. */
function frame(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => resolve());
  });
}

/**
 * When the tree's first row reached the DOM, on `performance.now()`'s clock.
 *
 * A mutation observer rather than a poll on the animation frame: the commit is
 * one task, and a frame poll would round whatever it costs up to the next
 * refresh period.
 */
function firstRowDrawn(): Promise<number> {
  return new Promise((resolve) => {
    const observer = new MutationObserver(() => {
      if (!firstRow()) return;
      observer.disconnect();
      resolve(performance.now());
    });
    observer.observe(document.body, { childList: true, subtree: true });
  });
}

describe(`opening the app over ${NOTES} notes`, () => {
  it("records first contentful paint and the time to the first tree row", async () => {
    const { paths, folderCount } = syntheticVault(NOTES);
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    const drawn = firstRowDrawn();
    const started = performance.now();
    root.render(
      <QueryClientProvider client={new QueryClient()}>
        <main className="flex h-dvh flex-col bg-one-bg">
          <div className="flex min-h-0 flex-1">
            <FileExplorer
              paths={paths}
              onOpenFile={() => {}}
              open={true}
              onOpenChange={() => {}}
              commands={INERT}
            />
            <div className="min-w-0 flex-1">
              <Editor initialDoc={SAMPLE} commands={INERT} />
            </div>
          </div>
        </main>
      </QueryClientProvider>,
    );

    const toFirstRow = (await drawn) - started;
    // Two turns, the way the keystroke measurement takes them: the first
    // callback runs before the paint that carries the commit to the screen and
    // the second cannot run until that paint is over.
    await frame();
    await frame();
    const toPaint = performance.now() - started;

    const paints = performance.getEntriesByType("paint");
    const contentful = paints.find((entry) => entry.name === "first-contentful-paint");
    console.log(
      contentful
        ? `first contentful paint: ${contentful.startTime.toFixed(1)}ms after the time origin, ` +
            `with the mount starting at ${started.toFixed(1)}ms on the same clock`
        : `first contentful paint: unavailable, ${paints.length} paint entries, ` +
            "because chromium records paint timing for the outermost frame only " +
            "and this runs in vitest's tester iframe",
    );
    console.log(
      `${NOTES} notes in ${folderCount} folders: ${toFirstRow.toFixed(1)}ms to the first tree row, ` +
        `${toPaint.toFixed(1)}ms to the paint that carried it, ` +
        `${document.querySelectorAll("[data-row]").length} rows mounted`,
    );

    root.unmount();
    container.remove();
  }, 120_000);
});
