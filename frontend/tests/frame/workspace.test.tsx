/**
 * Pictures of a workspace back after a reload, on a phone and on a desktop
 * (#495).
 *
 * The route wants a backend to mount, so the shell here is the route's restore
 * by hand: the layout read from `loadWorkspace` in a `useState` initializer,
 * written back by `saveWorkspace` in an effect, and drawn by `PaneLayout` with
 * an editor in each pane. A reload is an unmount and a mount with
 * `localStorage` left as it was; a real one would take the test runner down
 * with the page.
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, useEffect, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { page } from "vitest/browser";
import { Editor } from "@/components/editor";
import { PaneLayout } from "@/components/pane-layout";
import { noteName } from "@/lib/note-path";
import {
  activeTab,
  emptyLayout,
  focusPane,
  type Layout,
  openInFocused,
  splitFocused,
  tabPanes,
} from "@/lib/panes";
import { useViewport } from "@/lib/use-viewport";
import { loadWorkspace, saveWorkspace } from "@/lib/workspace";
import { COARSE, NARROW, stubMatchMedia } from "../match-media";
import { stubCommands } from "../stub-commands";
import { shot } from "./shots";
import "@/styles/app.css";

const FINE_KEY = "kasten.workspace.1";
const COARSE_KEY = "kasten.workspace.coarse.1";

let root: Root | undefined;
let host: HTMLElement | undefined;

/** The route's restore and save, around panes that each hold a note. */
function Shell({ start }: { start: () => Layout }) {
  const { narrow, coarse } = useViewport();
  const [saved] = useState(() => loadWorkspace(coarse));
  const [layout, setLayout] = useState<Layout>(() => saved?.layout ?? start());
  useEffect(() => saveWorkspace(coarse, layout, false), [coarse, layout]);
  const tab = activeTab(layout);
  return (
    <main className="flex h-dvh flex-col bg-one-bg">
      <div className="flex min-h-0 flex-1">
        <PaneLayout
          node={tab.root}
          focus={tab.focus}
          divided={tabPanes(layout).length > 1}
          zoomed={narrow || tab.zoom === true ? tab.focus : null}
          onFocus={(id) => setLayout((previous) => focusPane(previous, id))}
        >
          {(pane) =>
            pane.path === undefined ? null : (
              <div data-note={pane.path} className="h-full">
                <Editor
                  initialDoc={`# ${noteName(pane.path)}\n\nOpen before the reload, and open after it.\n`}
                  commands={stubCommands()}
                />
              </div>
            )
          }
        </PaneLayout>
      </div>
    </main>
  );
}

async function mount(start: () => Layout): Promise<void> {
  host = document.body.appendChild(document.createElement("div"));
  host.className = "h-dvh";
  root = createRoot(host);
  await act(async () => {
    root?.render(
      <QueryClientProvider client={new QueryClient()}>
        <Shell start={start} />
      </QueryClientProvider>,
    );
  });
}

async function unmount(): Promise<void> {
  await act(async () => root?.unmount());
  host?.remove();
  root = undefined;
  host = undefined;
}

/** A start nobody should see: the second mount must come from storage. */
const NOTHING = () => emptyLayout();

beforeEach(() => localStorage.clear());

afterEach(async () => {
  await unmount();
  localStorage.clear();
  vi.unstubAllGlobals();
});

it("a phone reopens the note it had open", async () => {
  await page.viewport(414, 896);
  stubMatchMedia({ [COARSE]: true, [NARROW]: true });

  await mount(() => emptyLayout("Inbox/Shopping.md"));
  await unmount();
  // Under the finger's key, and the mouse's left empty.
  expect(localStorage.getItem(COARSE_KEY)).toContain("Inbox/Shopping.md");
  expect(localStorage.getItem(FINE_KEY)).toBeNull();

  await mount(NOTHING);
  const note = document.querySelector('[data-note="Inbox/Shopping.md"]');
  expect(note).not.toBeNull();
  await expect.poll(() => note?.querySelector(".cm-content")?.textContent).toContain("Shopping");
  expect(await shot(host as Element, "workspace-phone")).toBe(414);
});

it("a desktop reopens a row of two notes side by side", async () => {
  await page.viewport(1280, 800);
  stubMatchMedia({ [COARSE]: false, [NARROW]: false });

  await mount(() =>
    openInFocused(splitFocused(emptyLayout("Projects/Left.md"), "row"), "Projects/Right.md"),
  );
  await unmount();
  expect(localStorage.getItem(FINE_KEY)).toContain("Projects/Right.md");
  expect(localStorage.getItem(COARSE_KEY)).toBeNull();

  await mount(NOTHING);
  const left = document.querySelector('[data-note="Projects/Left.md"]');
  const right = document.querySelector('[data-note="Projects/Right.md"]');
  expect(left).not.toBeNull();
  expect(right).not.toBeNull();
  const a = (left as Element).getBoundingClientRect();
  const b = (right as Element).getBoundingClientRect();
  // Beside each other at one height, in equal shares of the width.
  expect(a.width).toBeGreaterThan(0);
  expect(a.right).toBeLessThanOrEqual(b.left);
  expect(a.top).toBe(b.top);
  expect(Math.abs(a.width - b.width)).toBeLessThanOrEqual(1);
  expect(await shot(host as Element, "workspace-desktop")).toBe(1280);
});
