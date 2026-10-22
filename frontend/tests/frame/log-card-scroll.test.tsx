/**
 * The food search opened from the card keeps the note where it was (#814). With the
 * card and the panel's query in view, a tap moves nothing. With the card at the
 * pane's bottom edge, the query is revealed by the least scroll that shows it, and
 * nothing is centred or pushed past the edge.
 */

import { EditorState, type Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { vim } from "@replit/codemirror-vim";
import { page } from "vitest/browser";
import { fetchNote, NoteMissing } from "@/lib/api";
import { logCard } from "@/lib/log-card";
import { paletteEntries } from "@/lib/palette";
import { notePath } from "@/lib/todo-commands";
import { stubCommands } from "../stub-commands";
import "@/styles/app.css";

vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  fetchNote: vi.fn(),
}));

vi.mock("@/lib/food-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/food-api")>()),
  fetchLog: async () => [],
}));

// A vault with no config note: the card draws the three default kinds.
beforeEach(() => {
  vi.mocked(fetchNote).mockRejectedValue(new NoteMissing("99 Misc/01 Config/log.md"));
});

const DAILY = "01 Periodic/00 Daily/2026-10-20.md";
/**
 * Lines above the title. The card goes under the title, so these put it low in the
 * note: a short pane can then scroll the card's row to its bottom edge.
 */
const ABOVE = Array.from({ length: 40 }, (_, at) => `Filler line ${at + 1}`);
const NOTE = [
  "# 2026-10-20 Tuesday",
  "",
  "[[01 Periodic/00 Daily/2026-10-19]] | [[01 Periodic/00 Daily/2026-10-21]]",
  "",
  "## Log",
  "- 💧 500 ml",
  "- ☕ 1",
  "- 🍺 1 0.5 l 5%",
  "",
  "## Done",
];

let live: { host: HTMLElement; view: EditorView } | undefined;

afterEach(async () => {
  live?.view.destroy();
  live?.host.remove();
  live = undefined;
  await page.viewport(414, 896);
});

/** Where the note and the page are scrolled to. */
interface Position {
  note: number;
  page: number;
}

function positions(view: EditorView): Position {
  return { note: view.scrollDOM.scrollTop, page: window.scrollY };
}

/** Scrolls the note until the card's row sits on the pane's bottom edge. */
function scrollRowToFold(view: EditorView): void {
  const row = view.dom.querySelector(".cm-log-row");
  expect(row).not.toBeNull();
  const pane = view.scrollDOM.getBoundingClientRect();
  view.scrollDOM.scrollTop += (row?.getBoundingClientRect().bottom ?? 0) - pane.bottom;
}

/** The note in a pane of this size, below `above` lines, with its card drawn. */
async function mountNote(
  width: number,
  height: number,
  above: string[],
  keys: Extension[] = [],
): Promise<EditorView> {
  await page.viewport(width, height);
  const host = document.body.appendChild(document.createElement("div"));
  host.style.cssText = `width: 100%; height: ${height}px; background: #282c34;`;
  const view = new EditorView({
    state: EditorState.create({
      doc: [...above, ...NOTE].join("\n"),
      // As the app mounts it: a long wikilink line wraps, rather than widening the card.
      extensions: [notePath.of(DAILY), logCard, EditorView.lineWrapping, ...keys],
    }),
    parent: host,
  });
  live = { host, view };
  // The card's row is the title's line plus two, and a card below the first screen is
  // drawn only once the note scrolls to it.
  const row = above.length + 3;
  view.scrollDOM.scrollTop = view.lineBlockAt(view.state.doc.line(row).from).top;
  await expect.poll(() => view.dom.querySelector(".cm-log-row")).not.toBeNull();
  return view;
}

/** Presses the card's 🍽 button as a mouse does, or fails the test where there is none. */
function pressFood(view: EditorView): void {
  const button = view.dom.querySelector<HTMLButtonElement>(".cm-log button[aria-label='Log food']");
  expect(button).not.toBeNull();
  button?.click();
}

/**
 * The food query has the focus and sits in the pane, and the note and the page are
 * where they were before the tap.
 */
async function expectKept(view: EditorView, before: Position): Promise<void> {
  const query = view.dom.querySelector<HTMLInputElement>(".cm-log-food-query");
  expect(query).not.toBeNull();
  await expect.poll(() => document.activeElement).toBe(query);
  expect(view.scrollDOM.scrollTop, "the note's scrollTop").toBe(before.note);
  expect(window.scrollY, "the page's scrollY").toBe(before.page);
  const pane = view.scrollDOM.getBoundingClientRect();
  const box = query?.getBoundingClientRect();
  expect(box?.top, "the query's top in the pane").toBeGreaterThanOrEqual(pane.top);
  expect(box?.bottom, "the query's bottom in the pane").toBeLessThanOrEqual(pane.bottom);
}

it("#814 tapping + food keeps the note's scroll position on a desktop", async () => {
  const view = await mountNote(1200, 900, []);
  const before = positions(view);
  pressFood(view);
  await expectKept(view, before);
});

it("#814 tapping + food keeps the note's scroll position with vim mode on", async () => {
  const view = await mountNote(1200, 900, [], [vim()]);
  const before = positions(view);
  pressFood(view);
  await expectKept(view, before);
});

it("#814 tapping + food keeps the note's scroll position at 414 by touch", async () => {
  const view = await mountNote(414, 896, []);
  const before = positions(view);
  const button = view.dom.querySelector<HTMLButtonElement>(".cm-log button[aria-label='Log food']");
  expect(button).not.toBeNull();
  // A touch presses through the pointer and mouse events before the click.
  button?.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
  button?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
  button?.click();
  await expectKept(view, before);
});

it("#814 opening the food search from the palette keeps the note's scroll position", async () => {
  const view = await mountNote(1200, 900, []);
  const before = positions(view);
  const food = paletteEntries(stubCommands(), view).find((entry) => entry.label === "Log food");
  expect(food, "the palette's Log food").toBeDefined();
  food?.run();
  await expectKept(view, before);
});

it("#814 a kind tap while the food search is open keeps the note's scroll position", async () => {
  const view = await mountNote(1200, 900, []);
  pressFood(view);
  expect(document.activeElement).toBe(view.dom.querySelector(".cm-log-food-query"));
  const before = positions(view);
  const amount = view.dom.querySelector<HTMLInputElement>(".cm-log-amount");
  expect(amount).not.toBeNull();
  if (amount) amount.value = "250";
  view.dom.querySelector<HTMLButtonElement>(".cm-log button[aria-label='Log water']")?.click();
  await expectKept(view, before);
});

it("#814 tapping + food with the card at the pane's bottom edge scrolls only so far as to show the query", async () => {
  const view = await mountNote(1200, 480, ABOVE);
  scrollRowToFold(view);
  const before = positions(view);
  pressFood(view);
  const query = view.dom.querySelector<HTMLInputElement>(".cm-log-food-query");
  expect(query).not.toBeNull();
  await expect.poll(() => document.activeElement).toBe(query);
  expect(view.scrollDOM.scrollTop, "the note moved to show the query").toBeGreaterThan(before.note);
  const pane = view.scrollDOM.getBoundingClientRect();
  const bottom = query?.getBoundingClientRect().bottom ?? 0;
  expect(bottom, "the query's bottom in the pane").toBeLessThanOrEqual(pane.bottom + 1);
  // Its bottom sits on the pane's edge, a pixel or two off, not centred and not past it.
  expect(pane.bottom - bottom, "the gap under the query").toBeLessThanOrEqual(2);
});
