import { history, undo } from "@codemirror/commands";
import { EditorState, type Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { vim } from "@replit/codemirror-vim";
import { fireEvent } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchNote, NoteMissing } from "@/lib/api";
import { fetchLog, type LogDay } from "@/lib/log/food-api";
import { logCard, reloadLogConfig } from "@/lib/log/log-card";
import { notePath } from "@/lib/todo/todo-commands";
import { vimKeys, vimModeField, vimModeState } from "@/lib/vim-mode";

vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  fetchNote: vi.fn(),
}));
vi.mock("@/lib/log/food-api", () => ({
  searchFood: vi.fn(),
  readBarcode: vi.fn(),
  fetchLog: vi.fn(),
}));

const DAILY = "01 Periodic/00 Daily/2026-10-20.md";
const LOG = "99 Misc/01 Config/log.md";
const NOTE = "# 2026-10-20 Tuesday\n\n## Log\n- 💧 500 ml\n\n## Done\n- [ ] write";
const DEFAULTS = "- 💧 water: 250 ml\n- ☕ coffee: 1\n- 🍺 alcohol: 1";
const WEIGHT = `${DEFAULTS}\n- ⚖ weight: kg, last`;
const WEIGHT_MAX = `${DEFAULTS}\n- ⚖ weight: kg, last, max 80`;
/** The 30 days before the note's day, 2026-10-20, as the card reads them. */
const THIRTY = ["2026-09-20", "2026-10-19"] as const;

const mounted: EditorView[] = [];

beforeEach(() => {
  // A vault with no config note until a test gives one.
  vi.mocked(fetchNote).mockRejectedValue(new NoteMissing(LOG));
  // Resets the call list too, which `thirtyReads` counts across the file's tests.
  vi.mocked(fetchLog).mockReset();
  vi.mocked(fetchLog).mockResolvedValue([]);
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

/** Takes a view out of the page before the test ends, so the next one starts fresh. */
function unmount(view: EditorView): void {
  view.destroy();
  view.dom.parentElement?.remove();
  mounted.splice(mounted.indexOf(view), 1);
}

/** Lets a read that is already settled reach the card. */
const settle = () => new Promise((done) => setTimeout(done, 0));

const amount = (view: EditorView) => view.dom.querySelector(".cm-log-amount") as HTMLInputElement;
const why = (view: EditorView) => view.dom.querySelector(".cm-log-why")?.textContent;
const text = (view: EditorView) => view.state.doc.toString();

/** The card's button with this aria-label, or null where there is none. */
function button(view: EditorView, label: string): HTMLButtonElement | null {
  return view.dom.querySelector<HTMLButtonElement>(`.cm-log button[aria-label='${label}']`);
}

/** Presses the card's button with this aria-label, or fails the test where there is none. */
function press(view: EditorView, label: string): void {
  const found = button(view, label);
  if (found === null) throw new Error(`no ${label} button on the card`);
  found.click();
}

/** Waits for the note's config to be drawn, which a button with this label shows. */
async function arrived(view: EditorView, label: string): Promise<void> {
  await vi.waitFor(() => expect(button(view, label)).not.toBeNull());
}

/** The Weight button's total: its value, or the words for a day with none. */
const weightTotal = (view: EditorView) =>
  button(view, "Log weight")?.querySelector(".cm-log-button-total")?.textContent;

/** The reads of the 30 days before the note, which the card makes once per view and day. */
const thirtyReads = () =>
  vi.mocked(fetchLog).mock.calls.filter(([from, to]) => from === THIRTY[0] && to === THIRTY[1])
    .length;

/** A day of the log read that holds one weigh-in total, as the read gives it. */
function weighDay(date: string, total: number): LogDay {
  return {
    date,
    path: `01 Periodic/00 Daily/${date}.md`,
    entries: [],
    totals: { mine: [{ mark: "⚖", name: "weight", unit: "kg", total }] },
  } as unknown as LogDay;
}

/** The 30-day read answers with one weigh-in on `date`, and every other read with no lines. */
function weighedOn(date: string, total: number): void {
  vi.mocked(fetchLog).mockImplementation((from) =>
    Promise.resolve(from === THIRTY[0] ? [weighDay(date, total)] : []),
  );
}

describe("the log card's weight kind", () => {
  it("#805 A4 the Weight button writes the typed number as a weight line, and Undo takes it back", async () => {
    vi.mocked(fetchNote).mockResolvedValue(WEIGHT);
    const view = mount(NOTE);
    await arrived(view, "Log weight");
    expect(button(view, "Log weight")).not.toBeNull();

    amount(view).value = "82.4";
    press(view, "Log weight");
    expect(text(view)).toBe(
      "# 2026-10-20 Tuesday\n\n## Log\n- 💧 500 ml\n- ⚖ 82.4 kg\n\n## Done\n- [ ] write",
    );
    expect(amount(view).value).toBe("");

    view.dom.querySelector<HTMLButtonElement>(".cm-log-undo")?.click();
    expect(text(view)).toBe(NOTE);
  });

  it("#805 A5 with an empty amount the Weight button asks for the number", async () => {
    vi.mocked(fetchNote).mockResolvedValue(WEIGHT);
    const view = mount(NOTE);
    await arrived(view, "Log weight");
    expect(button(view, "Log weight")).not.toBeNull();

    press(view, "Log weight");
    expect(why(view)).toBe("Type the weight in kg");
    expect(amount(view).placeholder).toBe("weight in kg");
    expect(amount(view).getAttribute("inputmode")).toBe("decimal");
    expect(document.activeElement).toBe(amount(view));
    expect(text(view)).toBe(NOTE);
  });

  it("#805 A5 Enter in the amount field while asking writes the weight line", async () => {
    vi.mocked(fetchNote).mockResolvedValue(WEIGHT);
    const view = mount(NOTE);
    await arrived(view, "Log weight");
    expect(button(view, "Log weight")).not.toBeNull();

    press(view, "Log weight");
    amount(view).value = "81";
    fireEvent.keyDown(amount(view), { key: "Enter" });
    expect(text(view)).toBe(
      "# 2026-10-20 Tuesday\n\n## Log\n- 💧 500 ml\n- ⚖ 81 kg\n\n## Done\n- [ ] write",
    );
  });

  it("#805 I3 with vim on, u takes back a weight line written after an ask", async () => {
    vi.mocked(fetchNote).mockResolvedValue(WEIGHT);
    const view = mount(NOTE, [vim(), vimModeState()]);
    await arrived(view, "Log weight");
    expect(button(view, "Log weight")).not.toBeNull();

    press(view, "Log weight");
    amount(view).value = "82.4";
    fireEvent.keyDown(amount(view), { key: "Enter" });
    expect(text(view)).toContain("- ⚖ 82.4 kg");
    expect(view.state.field(vimModeField)).toBe("normal");
    fireEvent.keyDown(view.contentDOM, { key: "u" });
    expect(text(view)).toBe(NOTE);
  });

  it("#805 I3 with vim off, undo takes a weight line written after an ask back", async () => {
    vi.mocked(fetchNote).mockResolvedValue(WEIGHT);
    const view = mount(NOTE, [vimKeys.of(false)]);
    await arrived(view, "Log weight");
    expect(button(view, "Log weight")).not.toBeNull();

    press(view, "Log weight");
    amount(view).value = "82.4";
    fireEvent.keyDown(amount(view), { key: "Enter" });
    undo(view);
    expect(text(view)).toBe(NOTE);
  });

  it("#805 I3 the question's words and placeholder clear on the next write, and a refused amount keeps its text", async () => {
    vi.mocked(fetchNote).mockResolvedValue(WEIGHT);
    const view = mount(NOTE);
    await arrived(view, "Log weight");
    expect(button(view, "Log weight")).not.toBeNull();

    press(view, "Log weight");
    expect(why(view)).toBe("Type the weight in kg");
    amount(view).value = "abc";
    press(view, "Log weight");
    expect(why(view)).toContain("not a weight amount: abc");
    // The question stays after a refusal, so its placeholder does too.
    expect(amount(view).placeholder).toBe("weight in kg");
    expect(amount(view).value).toBe("abc");

    amount(view).value = "81";
    press(view, "Log weight");
    expect(why(view)).toBeFalsy();
    expect(amount(view).placeholder).toBe("amount");
  });

  it("#805 I3 the question is drawn as a question, not as a refusal", async () => {
    vi.mocked(fetchNote).mockResolvedValue(WEIGHT);
    const view = mount(NOTE);
    await arrived(view, "Log weight");
    expect(button(view, "Log weight")).not.toBeNull();

    press(view, "Log weight");
    expect(why(view)).toBe("Type the weight in kg");
    expect(view.dom.querySelector(".cm-log-why")?.classList.contains("cm-log-ask")).toBe(true);

    amount(view).value = "abc";
    press(view, "Log weight");
    expect(why(view)).toContain("not a weight amount: abc");
    expect(view.dom.querySelector(".cm-log-why")?.classList.contains("cm-log-ask")).toBe(false);
  });

  it("#805 I3 an edit elsewhere in the note while the card asks keeps the typed number and the focus", async () => {
    vi.mocked(fetchNote).mockResolvedValue(WEIGHT);
    const view = mount(NOTE);
    await arrived(view, "Log weight");
    expect(button(view, "Log weight")).not.toBeNull();

    press(view, "Log weight");
    fireEvent.input(amount(view), { target: { value: "82" } });
    // A change to the title, outside `## Log`, moves no total.
    view.dispatch({ changes: { from: 2, insert: "x" } });
    expect(amount(view).value).toBe("82");
    expect(document.activeElement).toBe(amount(view));
    expect(why(view)).toBe("Type the weight in kg");
  });

  it("#805 I3 a line added under ## Log while the card asks keeps the typed number, the focus and the question", async () => {
    vi.mocked(fetchNote).mockResolvedValue(WEIGHT);
    const view = mount(NOTE);
    await arrived(view, "Log weight");
    press(view, "Log weight");
    fireEvent.input(amount(view), { target: { value: "82" } });

    // A water line lands under `## Log`, so the card is drawn again with a new total.
    const at = NOTE.indexOf("- 💧 500 ml") + "- 💧 500 ml".length;
    view.dispatch({ changes: { from: at, insert: "\n- 💧 250 ml" } });
    await settle();
    expect(amount(view).value).toBe("82");
    expect(document.activeElement).toBe(amount(view));
    expect(why(view)).toBe("Type the weight in kg");
  });

  it("#805 I3 a config that drops the weight kind ends the ask", async () => {
    vi.mocked(fetchNote).mockResolvedValue(WEIGHT);
    const view = mount(NOTE);
    await arrived(view, "Log weight");
    press(view, "Log weight");
    expect(why(view)).toBe("Type the weight in kg");

    // The config loses the weight kind and gets it back, with no press in between.
    vi.mocked(fetchNote).mockResolvedValue(DEFAULTS);
    reloadLogConfig();
    await vi.waitFor(() => expect(button(view, "Log weight")).toBeNull());
    vi.mocked(fetchNote).mockResolvedValue(WEIGHT);
    reloadLogConfig();
    await arrived(view, "Log weight");
    expect(why(view)).toBeFalsy();
    expect(amount(view).placeholder).toBe("amount");
  });

  it("#805 I1 after a refused amount, a fixed number and Enter still write the weight line", async () => {
    vi.mocked(fetchNote).mockResolvedValue(WEIGHT);
    const view = mount(NOTE);
    await arrived(view, "Log weight");
    expect(button(view, "Log weight")).not.toBeNull();

    press(view, "Log weight");
    fireEvent.input(amount(view), { target: { value: "abc" } });
    press(view, "Log weight");
    expect(why(view)).toContain("not a weight amount: abc");

    fireEvent.input(amount(view), { target: { value: "82" } });
    fireEvent.keyDown(amount(view), { key: "Enter" });
    expect(text(view)).toBe(
      "# 2026-10-20 Tuesday\n\n## Log\n- 💧 500 ml\n- ⚖ 82 kg\n\n## Done\n- [ ] write",
    );
  });

  it("#805 I1 an amount that is no weight says why, writes nothing and keeps the text", async () => {
    vi.mocked(fetchNote).mockResolvedValue(WEIGHT);
    const view = mount(NOTE);
    await arrived(view, "Log weight");
    expect(button(view, "Log weight")).not.toBeNull();

    for (const typed of ["abc", "0", "82.4 lb"]) {
      amount(view).value = typed;
      press(view, "Log weight");
      expect(text(view)).toBe(NOTE);
      expect(why(view)).toContain("not a weight amount");
      expect(amount(view).value).toBe(typed);
    }
  });

  it("#805 I1 a comma decimal and a typed unit both write the weight line", async () => {
    vi.mocked(fetchNote).mockResolvedValue(WEIGHT);
    const view = mount(NOTE);
    await arrived(view, "Log weight");
    expect(button(view, "Log weight")).not.toBeNull();

    amount(view).value = "82,4";
    press(view, "Log weight");
    expect(text(view)).toContain("- 💧 500 ml\n- ⚖ 82,4 kg\n\n## Done");

    amount(view).value = "82.4 kg";
    press(view, "Log weight");
    expect(text(view)).toContain("- ⚖ 82,4 kg\n- ⚖ 82.4 kg\n\n## Done");
  });

  it("#805 I2 a second weigh-in shows the later value, and Undo shows the earlier one again", async () => {
    vi.mocked(fetchNote).mockResolvedValue(WEIGHT);
    const view = mount(NOTE);
    await arrived(view, "Log weight");
    expect(button(view, "Log weight")).not.toBeNull();

    amount(view).value = "82.4";
    press(view, "Log weight");
    amount(view).value = "81.9";
    press(view, "Log weight");
    expect(weightTotal(view)).toBe("81.9 kg");

    view.dom.querySelector<HTMLButtonElement>(".cm-log-undo")?.click();
    expect(weightTotal(view)).toBe("82.4 kg");
    expect(text(view)).toBe(
      "# 2026-10-20 Tuesday\n\n## Log\n- 💧 500 ml\n- ⚖ 82.4 kg\n\n## Done\n- [ ] write",
    );
  });

  it("#805 I6 the weight goal is read against the value and warns only past a max", async () => {
    vi.mocked(fetchNote).mockResolvedValue(WEIGHT_MAX);
    const view = mount("# 2026-10-20 Tuesday\n\n## Log\n- ⚖ 85 kg\n\n## Done");
    await vi.waitFor(() => expect(weightTotal(view)).toBe("85 / 80 kg ⚠"));
    const bar = button(view, "Log weight")?.querySelector("[role='meter']");
    expect(bar).not.toBeNull();
    expect(button(view, "Log weight")?.querySelector(".cm-log-warn")).not.toBeNull();
  });

  it("#805 A6 with no weigh-in today the Weight button shows the latest one before the day, with its date", async () => {
    vi.mocked(fetchNote).mockResolvedValue(WEIGHT);
    weighedOn("2026-10-18", 82.4);
    const view = mount(NOTE);
    await vi.waitFor(() => expect(weightTotal(view)).toBe("82.4 kg, Oct 18"));
  });

  it("#805 A6 with no weigh-in in the 30 days the Weight button says so, and the read is asked once per view and day", async () => {
    vi.mocked(fetchNote).mockResolvedValue(WEIGHT);
    const view = mount(NOTE);
    await arrived(view, "Log weight");
    expect(thirtyReads()).toBe(1);

    // A selection moves asks nothing more: the day is the same.
    view.dispatch({ selection: { anchor: 2 } });
    await settle();
    expect(thirtyReads()).toBe(1);
    expect(weightTotal(view)).toBe("no weigh-ins yet");
  });

  it("#805 A6 a failed read of the 30 days is no earlier value and warns", async () => {
    vi.mocked(fetchNote).mockResolvedValue(WEIGHT);
    vi.mocked(fetchLog).mockImplementation((from) =>
      from === THIRTY[0]
        ? Promise.reject(new Error("GET /api/log failed with 500"))
        : Promise.resolve([]),
    );
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const view = mount(NOTE);
    await vi.waitFor(() => expect(warn).toHaveBeenCalledWith("GET /api/log failed with 500"));
    expect(weightTotal(view)).toBe("no weigh-ins yet");
    warn.mockRestore();
  });

  it("#805 A6 the 30-day read is asked only where a config has a kind that keeps its last value", async () => {
    vi.mocked(fetchNote).mockResolvedValue(WEIGHT);
    const weighed = mount(NOTE);
    await arrived(weighed, "Log weight");
    expect(thirtyReads()).toBe(1);
    unmount(weighed);
    await settle();

    // A vault with no last kind reads yesterday and nothing more, and has no Weight button.
    vi.mocked(fetchNote).mockResolvedValue(DEFAULTS);
    const plain = mount(NOTE);
    await arrived(plain, "Log water");
    await settle();
    expect(thirtyReads()).toBe(1);
    expect(button(plain, "Log weight")).toBeNull();
  });
});
