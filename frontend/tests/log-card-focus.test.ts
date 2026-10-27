import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { fetchNote } from "@/lib/api";
import { fetchLog } from "@/lib/food-api";
import { logCard } from "@/lib/log-card";
import { notePath } from "@/lib/todo/todo-commands";

vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  fetchNote: vi.fn(),
}));
vi.mock("@/lib/food-api", () => ({
  searchFood: vi.fn(),
  readBarcode: vi.fn(),
  fetchLog: vi.fn(),
}));

beforeEach(() => {
  vi.mocked(fetchLog).mockResolvedValue([]);
});

const DAILY = "01 Periodic/00 Daily/2026-10-20.md";
const NOTE = "# 2026-10-20 Tuesday\n\n## Log\n- 💧 500 ml\n\n## Done";

const mounted: EditorView[] = [];

afterEach(() => {
  for (const view of mounted.splice(0)) {
    view.destroy();
    view.dom.parentElement?.remove();
  }
});

function mount(doc: string): EditorView {
  const parent = document.body.appendChild(document.createElement("div"));
  const view = new EditorView({
    state: EditorState.create({
      doc,
      extensions: [notePath.of(DAILY), logCard],
    }),
    parent,
  });
  mounted.push(view);
  return view;
}

/** Presses the card's button with this aria-label, or fails the test where there is none. */
function press(view: EditorView, label: string): void {
  const found = view.dom.querySelector<HTMLButtonElement>(`.cm-log button[aria-label='${label}']`);
  expect(found, `the ${label} button`).not.toBeNull();
  found?.click();
}

it("#814 + food focuses the query without the browser's own scroll and reveals it the least way", async () => {
  // The config never arrives here, so the card's own refocus, which runs once it does,
  // cannot land after the test has taken its stubs away. Only the tap's focus is read.
  vi.mocked(fetchNote).mockReturnValue(new Promise(() => {}));
  const view = mount(NOTE);
  // jsdom has no scrollIntoView, so the test gives the element one and takes it away after.
  const scrollIntoView = vi.fn();
  Object.defineProperty(Element.prototype, "scrollIntoView", {
    value: scrollIntoView,
    configurable: true,
    writable: true,
  });
  const focus = vi.spyOn(HTMLElement.prototype, "focus");
  try {
    press(view, "Log food");
    // The panel's query is focused at once and again in a microtask, so both calls are read.
    await Promise.resolve();
    const query = view.dom.querySelector(".cm-log-food-query");
    expect(query).not.toBeNull();

    const queryFocus = focus.mock.calls.filter((_, at) => focus.mock.contexts[at] === query);
    expect(queryFocus.length, "focus calls on the query").toBeGreaterThan(0);
    for (const args of queryFocus) {
      expect(args, "a focus on the query").toEqual([{ preventScroll: true }]);
    }

    expect(scrollIntoView.mock.calls.length, "scrollIntoView calls").toBeGreaterThan(0);
    scrollIntoView.mock.calls.forEach((args, at) => {
      expect(scrollIntoView.mock.contexts[at], "scrollIntoView's element").toBe(query);
      expect(args, "scrollIntoView's options").toEqual([{ block: "nearest", inline: "nearest" }]);
    });
  } finally {
    focus.mockRestore();
    Reflect.deleteProperty(Element.prototype, "scrollIntoView");
  }
});
