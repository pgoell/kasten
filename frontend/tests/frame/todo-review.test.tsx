/**
 * Whether a todo in review draws its own symbol and keeps its words unmuted.
 *
 * The symbol is a `::before` that jsdom does not compute, so only a real
 * browser can say what is drawn in place of the box. Mounted bare with what
 * the editor draws a note with, vim on and off, the cursor on a line above.
 */

import { EditorState, type Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { vim } from "@replit/codemirror-vim";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createRoot } from "react-dom/client";
import { page } from "vitest/browser";
import { TodoPane } from "@/components/todo-pane";
import { kastenTheme } from "@/lib/editor-theme";
import { imagePaths } from "@/lib/image";
import { livePreview } from "@/lib/live-preview";
import { noteLanguage } from "@/lib/note-language";
import { DEFAULT_VIEWS } from "@/lib/todo-view";
import { vimKeys } from "@/lib/vim-mode";
import { vaultPaths } from "@/lib/wikilink";
import { COARSE, NARROW, stubMatchMedia } from "../match-media";
import { stubCommands } from "../stub-commands";
import { shot } from "./shots";
import "@/styles/app.css";

// The pane's reads, answered here: the board is drawn off these and no server.
// The rest kept, as the browser checks every named import the graph holds.
const { fetchTodos } = vi.hoisted(() => ({ fetchTodos: vi.fn() }));
vi.mock("@/lib/api", async (original) => ({
  ...(await original<typeof import("@/lib/api")>()),
  fetchTodos,
  fetchNote: () => Promise.resolve(DEFAULT_VIEWS),
  fetchFiles: () => Promise.resolve([]),
  createNote: () => Promise.resolve(),
}));

let view: EditorView | undefined;

afterEach(() => {
  view?.dom.parentElement?.remove();
  view?.destroy();
  view = undefined;
});

function mount(doc: string, keys: Extension, extra: Extension = []): Element[] {
  const parent = document.body.appendChild(document.createElement("div"));
  view = new EditorView({
    state: EditorState.create({
      doc,
      selection: { anchor: 0 },
      extensions: [
        noteLanguage(),
        kastenTheme,
        keys,
        livePreview(),
        vaultPaths.of([]),
        imagePaths.of([]),
        extra,
      ],
    }),
    parent,
  });
  return [...view.contentDOM.querySelectorAll(".cm-line")];
}

it.each([
  ["vim on", vim()],
  ["vim off", vimKeys.of(false)],
])("draws [r] as ◎, its words neither muted nor struck: %s", (_, keys) => {
  const [, review, done] = mount("intro\n- [r] check it\n- [x] ship it", keys);
  const drawn = getComputedStyle(review as Element);

  expect(review?.className).toContain("cm-todo cm-todo-review");
  expect(getComputedStyle(review as Element, "::before").content).toBe('"◎ "');
  expect(drawn.textDecorationLine).toBe("none");
  expect(drawn.color).not.toBe(getComputedStyle(done as Element).color);
});

const TODAY = "2026-10-18";
const DAILY = "01 Periodic/00 Daily/2026-10-18.md";
const LINES = [
  "- [ ] write the release notes",
  "- [/] wire up the pane",
  "- [r] ship the parser #agent",
  "- [w] hear back from legal 👤 Anna 2026-10-15",
  `- [x] fix the tap ✅ ${TODAY}`,
];

it("#488 keeps the board footer's count on one line on a phone", async () => {
  fetchTodos.mockResolvedValue(LINES.map((text, at) => ({ path: DAILY, line: at + 3, text })));
  const host = document.body.appendChild(document.createElement("div"));
  const root = createRoot(host);
  // In a `finally`, so a failure does not leave its viewport or its phone to the cases after it.
  try {
    await page.viewport(414, 896);
    stubMatchMedia({ [COARSE]: true, [NARROW]: true });
    root.render(
      <QueryClientProvider client={new QueryClient()}>
        <TodoPane
          commands={stubCommands()}
          onOpen={() => {}}
          onCycle={() => {}}
          onAdd={() => {}}
          onSubtask={() => {}}
          onEdit={() => {}}
          onBlock={() => {}}
          onTimer={() => {}}
          onAgent={() => {}}
          onRefile={() => {}}
          onNotice={() => {}}
          focusSignal={0}
          today={TODAY}
          archive={false}
        />
      </QueryClientProvider>,
    );
    await expect.poll(() => host.querySelector("[data-row]")).not.toBeNull();
    host
      .querySelector("section[aria-label='Todos']")
      ?.dispatchEvent(new KeyboardEvent("keydown", { key: "c", bubbles: true }));
    await expect.poll(() => host.querySelector("[data-testid='todo-card']")).not.toBeNull();

    const count = host.querySelector("[data-testid='todo-footer'] > span") as Element;
    expect(count.textContent).toBe("5 on the board");
    // A range over the text, not the span: a flex item is one box however
    // its text wraps, while the range gives one box per line.
    const range = document.createRange();
    range.selectNodeContents(count);
    expect(range.getClientRects().length).toBe(1);
  } finally {
    root.unmount();
    host.remove();
    vi.unstubAllGlobals();
    await page.viewport(414, 896);
  }
});

it.runIf(import.meta.env.VITE_KASTEN_SHOTS)(
  "takes screenshots of review in live preview and on the board",
  async () => {
    fetchTodos.mockResolvedValue(LINES.map((text, at) => ({ path: DAILY, line: at + 3, text })));
    // In a `finally`, so a failed shot does not leave its viewport to the cases after it.
    try {
      for (const [width, height] of [
        [414, 896],
        [1280, 900],
      ] as const) {
        await page.viewport(width, height);

        // The cursor on the heading, so every todo line draws its symbol.
        mount(`# Today\n\n${LINES.join("\n")}`, vimKeys.of(false), EditorView.lineWrapping);
        expect(await shot(view?.dom as Element, `review-preview-${width}`)).toBe(width);
        view?.dom.parentElement?.remove();
        view?.destroy();
        view = undefined;

        // A phone at 414: the board picks its tabs off the pointer, not the
        // width, so the shot is a phone's only with a coarse one.
        const phone = width === 414;
        if (phone) stubMatchMedia({ [COARSE]: true, [NARROW]: true });
        const host = document.body.appendChild(document.createElement("div"));
        host.style.cssText = `width: 100%; height: ${height}px; background: #282c34;`;
        const root = createRoot(host);
        root.render(
          <QueryClientProvider client={new QueryClient()}>
            <TodoPane
              commands={stubCommands()}
              onOpen={() => {}}
              onCycle={() => {}}
              onAdd={() => {}}
              onSubtask={() => {}}
              onEdit={() => {}}
              onBlock={() => {}}
              onTimer={() => {}}
              onAgent={() => {}}
              onRefile={() => {}}
              onNotice={() => {}}
              focusSignal={0}
              today={TODAY}
              archive={false}
            />
          </QueryClientProvider>,
        );
        await expect.poll(() => host.querySelector("[data-row]")).not.toBeNull();
        host
          .querySelector("section[aria-label='Todos']")
          ?.dispatchEvent(new KeyboardEvent("keydown", { key: "c", bubbles: true }));
        await expect.poll(() => host.querySelector("[data-testid='todo-card']")).not.toBeNull();
        if (phone) {
          const tab = [...host.querySelectorAll<HTMLElement>("[role='tab']")].find((one) =>
            one.textContent?.startsWith("Review"),
          );
          tab?.click();
          await expect.poll(() => tab?.getAttribute("aria-selected")).toBe("true");
        }
        expect(await shot(host, `review-board-${width}`)).toBe(width);
        root.unmount();
        host.remove();
        vi.unstubAllGlobals();
      }
    } finally {
      vi.unstubAllGlobals();
      await page.viewport(414, 896);
    }
  },
);
