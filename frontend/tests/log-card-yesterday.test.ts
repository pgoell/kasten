import { history, undo } from "@codemirror/commands";
import { EditorState, type Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { vim } from "@replit/codemirror-vim";
import { fireEvent } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchNote, NoteMissing } from "@/lib/api";
import { fetchLog, type LogDay } from "@/lib/food-api";
import { logCard, reloadLogConfig } from "@/lib/log-card";
import { notePath } from "@/lib/todo-commands";
import { vimKeys, vimModeState } from "@/lib/vim-mode";

vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  fetchNote: vi.fn(),
}));
vi.mock("@/lib/food-api", () => ({
  searchFood: vi.fn(),
  readBarcode: vi.fn(),
  fetchLog: vi.fn(),
}));

const DAILY = "01 Periodic/00 Daily/2026-10-20.md";
const OTHER = "02 Projects/Plan.md";
const NOTE = "# 2026-10-20 Tuesday\n\n## Log\n- 💧 500 ml\n\n## Done\n- [ ] write";
const YESTERDAY = "2026-10-19";

/** Yesterday's note as the log read gives it: its food lines, with their text as written. */
function yesterdayDay(lines: { text: string; meal?: string }[], date = YESTERDAY): LogDay {
  return {
    date,
    path: `01 Periodic/00 Daily/${date}.md`,
    entries: lines.map((line, index) => ({
      line: index + 2,
      kind: "food",
      text: line.text,
      meal: line.meal ?? null,
    })),
    totals: {},
  } as unknown as LogDay;
}

const DINNER = [
  { text: "- 🍽 dinner:  Pasta   🔥 500 kcal 🥩 20 g", meal: "dinner" },
  { text: "- 🍽 dinner: Salad 🔥 100 kcal", meal: "dinner" },
];

const mounted: EditorView[] = [];

beforeEach(() => {
  vi.mocked(fetchNote).mockRejectedValue(new NoteMissing("99 Misc/01 Config/log.md"));
  reloadLogConfig();
  vi.mocked(fetchLog).mockResolvedValue([yesterdayDay(DINNER)]);
});

afterEach(() => {
  for (const view of mounted.splice(0)) {
    view.destroy();
    view.dom.parentElement?.remove();
  }
});

/** A view on `doc` with the card and `extra`. */
function mount(doc: string, extra: Extension[] = [], path = DAILY): EditorView {
  const parent = document.body.appendChild(document.createElement("div"));
  const view = new EditorView({
    state: EditorState.create({
      doc,
      extensions: [notePath.of(path), history(), logCard, ...extra],
    }),
    parent,
  });
  mounted.push(view);
  return view;
}

const text = (view: EditorView) => view.state.doc.toString();

/** The copy offer on the card, or null where none is offered. */
const offer = (view: EditorView) =>
  view.dom.querySelector<HTMLButtonElement>(".cm-log button.cm-log-copy");

/** Lets the answer of a read that is already settled reach the card. */
const settle = () => new Promise((done) => setTimeout(done, 0));

describe("copying yesterday's meal", () => {
  it("#803 A7 an empty meal offers Copy yesterday's dinner with how many lines", async () => {
    const view = mount(NOTE);
    await vi.waitFor(() => expect(offer(view)).not.toBeNull());
    expect(offer(view)?.textContent).toBe("Copy yesterday's dinner (2 lines)");
    expect(offer(view)?.getAttribute("aria-label")).toBe("Copy yesterday's dinner (2 lines)");
  });

  it("#803 A7 Copy yesterday writes yesterday's lines byte for byte at the end of ## Log", async () => {
    const view = mount(NOTE);
    await vi.waitFor(() => expect(offer(view)).not.toBeNull());
    offer(view)?.click();
    expect(text(view)).toBe(
      "# 2026-10-20 Tuesday\n\n## Log\n- 💧 500 ml\n- 🍽 dinner:  Pasta   🔥 500 kcal 🥩 20 g\n- 🍽 dinner: Salad 🔥 100 kcal\n\n## Done\n- [ ] write",
    );
  });

  it("#803 I1 with vim on, u takes back every copied line at once", async () => {
    const view = mount(NOTE, [vim(), vimModeState()]);
    await vi.waitFor(() => expect(offer(view)).not.toBeNull());
    offer(view)?.click();
    expect(text(view)).not.toBe(NOTE);
    fireEvent.keyDown(view.contentDOM, { key: "u" });
    expect(text(view)).toBe(NOTE);
  });

  it("#803 I1 with vim off, undo and the card's Undo take back every copied line at once", async () => {
    const view = mount(NOTE, [vimKeys.of(false)]);
    await vi.waitFor(() => expect(offer(view)).not.toBeNull());
    offer(view)?.click();
    undo(view);
    expect(text(view)).toBe(NOTE);

    offer(view)?.click();
    view.dom.querySelector<HTMLButtonElement>(".cm-log-undo")?.click();
    expect(text(view)).toBe(NOTE);
  });

  it("#803 I2 no lines yesterday, no note or a failed read offers nothing", async () => {
    // The same note with lines yesterday does offer, so the nothing below is the reads' doing.
    const control = mount(NOTE);
    await vi.waitFor(() => expect(offer(control)).not.toBeNull());

    vi.mocked(fetchLog).mockResolvedValueOnce([yesterdayDay([])]);
    const none = mount(NOTE);
    await settle();
    expect(offer(none)).toBeNull();

    vi.mocked(fetchLog).mockRejectedValueOnce(new Error("GET /api/log failed with 500"));
    const failed = mount(NOTE);
    await settle();
    expect(offer(failed)).toBeNull();
    expect(text(failed)).toBe(NOTE);

    const asked = vi.mocked(fetchLog).mock.calls.length;
    const plain = mount(NOTE, [], OTHER);
    await settle();
    expect(offer(plain)).toBeNull();
    expect(vi.mocked(fetchLog).mock.calls.length).toBe(asked);
  });

  it("#803 I2 an answer for yesterday that comes after the note changed is dropped", async () => {
    let answer!: (days: LogDay[]) => void;
    vi.mocked(fetchLog).mockImplementation((from: string) => {
      if (from === YESTERDAY) return new Promise<LogDay[]>((done) => (answer = done));
      // The note the change moves to: its yesterday holds one soup.
      return Promise.resolve([
        yesterdayDay([{ text: "- 🍽 dinner: Soup 🔥 90 kcal", meal: "dinner" }], "2026-10-20"),
      ]);
    });
    const view = mount(NOTE);
    // The change: the same view now shows the next day's note, so the answer for yesterday is late.
    view.setState(
      EditorState.create({
        doc: NOTE,
        extensions: [notePath.of("01 Periodic/00 Daily/2026-10-21.md"), history(), logCard],
      }),
    );
    await vi.waitFor(() =>
      expect(offer(view)?.textContent).toBe("Copy yesterday's dinner (1 line)"),
    );
    answer([yesterdayDay(DINNER)]);
    await settle();
    expect(offer(view)?.textContent).toBe("Copy yesterday's dinner (1 line)");
  });
});
