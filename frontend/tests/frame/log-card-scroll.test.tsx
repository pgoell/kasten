/**
 * The food search opened from the card keeps the note where it was (#814). A focus
 * scrolls the note to show what it lands on, and Firefox does that on a tap where
 * Chrome does not. So each case scrolls the card's row to the pane's bottom edge,
 * which puts the food panel below the fold, then checks the note did not move.
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
/** The line of the card's row: the title, a blank line, then the links. */
const ROW_LINE = ABOVE.length + 3;

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

/** The note in a pane of this size, its card drawn and its row on the pane's bottom edge. */
async function mountAtFold(
  width: number,
  height: number,
  keys: Extension[] = [],
): Promise<EditorView> {
  await page.viewport(width, height);
  const host = document.body.appendChild(document.createElement("div"));
  host.style.cssText = `width: 100%; height: ${height}px; background: #282c34;`;
  const view = new EditorView({
    state: EditorState.create({
      doc: [...ABOVE, ...NOTE].join("\n"),
      // As the app mounts it: a long wikilink line wraps, rather than widening the card.
      extensions: [notePath.of(DAILY), logCard, EditorView.lineWrapping, ...keys],
    }),
    parent: host,
  });
  live = { host, view };
  // The card is below the first screen, so CodeMirror draws it once the note scrolls there.
  view.scrollDOM.scrollTop = view.lineBlockAt(view.state.doc.line(ROW_LINE).from).top;
  await expect.poll(() => view.dom.querySelector(".cm-log-row")).not.toBeNull();
  scrollRowToFold(view);
  return view;
}

/** Presses the card's 🍽 button as a mouse does, or fails the test where there is none. */
function pressFood(view: EditorView): void {
  const button = view.dom.querySelector<HTMLButtonElement>(".cm-log button[aria-label='Log food']");
  expect(button).not.toBeNull();
  button?.click();
}

/**
 * The food query has the focus, and the note and the page are where they were before
 * the tap. The query sits below the pane's bottom edge, so the note had to move for it.
 */
async function expectKept(view: EditorView, before: Position): Promise<void> {
  const query = view.dom.querySelector<HTMLInputElement>(".cm-log-food-query");
  expect(query).not.toBeNull();
  await expect.poll(() => document.activeElement).toBe(query);
  expect(view.scrollDOM.scrollTop, "the note's scrollTop").toBe(before.note);
  expect(window.scrollY, "the page's scrollY").toBe(before.page);
  expect(
    query?.getBoundingClientRect().top,
    "the query's top, below the pane's bottom edge",
  ).toBeGreaterThanOrEqual(view.scrollDOM.getBoundingClientRect().bottom);
}

it("#814 tapping + food keeps the note's scroll position on a desktop", async () => {
  const view = await mountAtFold(1200, 480);
  const before = positions(view);
  pressFood(view);
  await expectKept(view, before);
});

it("#814 tapping + food keeps the note's scroll position with vim mode on", async () => {
  const view = await mountAtFold(1200, 480, [vim()]);
  const before = positions(view);
  pressFood(view);
  await expectKept(view, before);
});

it("#814 tapping + food keeps the note's scroll position at 414 by touch", async () => {
  const view = await mountAtFold(414, 480);
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
  const view = await mountAtFold(1200, 480);
  const before = positions(view);
  const food = paletteEntries(stubCommands(), view).find((entry) => entry.label === "Log food");
  expect(food, "the palette's Log food").toBeDefined();
  food?.run();
  await expectKept(view, before);
});

it("#814 a kind tap while the food search is open keeps the note's scroll position", async () => {
  const view = await mountAtFold(1200, 480);
  pressFood(view);
  // Opening the panel moves the note on main, so the row goes back to the fold, the query below it.
  scrollRowToFold(view);
  expect(document.activeElement).toBe(view.dom.querySelector(".cm-log-food-query"));
  const before = positions(view);
  const amount = view.dom.querySelector<HTMLInputElement>(".cm-log-amount");
  expect(amount).not.toBeNull();
  if (amount) amount.value = "250";
  view.dom.querySelector<HTMLButtonElement>(".cm-log button[aria-label='Log water']")?.click();
  await expectKept(view, before);
});
