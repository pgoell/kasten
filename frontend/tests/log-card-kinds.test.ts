import { history, undo } from "@codemirror/commands";
import { EditorState, type Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { vim } from "@replit/codemirror-vim";
import { fireEvent } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchNote, NoteMissing } from "@/lib/api";
import { logCard } from "@/lib/log-card";
import { notePath } from "@/lib/todo-commands";
import { vimKeys, vimModeField, vimModeState } from "@/lib/vim-mode";

vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  fetchNote: vi.fn(),
}));

const DAILY = "01 Periodic/00 Daily/2026-10-20.md";
const LOG = "99 Misc/01 Config/log.md";
const NOTE = "# 2026-10-20 Tuesday\n\n## Log\n- 💧 500 ml\n\n## Done\n- [ ] write";

/** The three kinds of the default config, which every config note that names a tea keeps. */
const DEFAULTS = "- 💧 water: 250 ml\n- ☕ coffee: 1\n- 🍺 alcohol: 1";

const mounted: EditorView[] = [];

beforeEach(() => {
  // A vault with no config note: the card draws the three default kinds.
  vi.mocked(fetchNote).mockRejectedValue(new NoteMissing(LOG));
});

afterEach(() => {
  for (const view of mounted.splice(0)) {
    view.destroy();
    view.dom.parentElement?.remove();
  }
});

/** A view on `doc` with the card and `extra`, the cursor at `anchor`. */
function mount(doc: string, path = DAILY, extra: Extension[] = [], anchor = 0): EditorView {
  const parent = document.body.appendChild(document.createElement("div"));
  const view = new EditorView({
    state: EditorState.create({
      doc,
      selection: { anchor },
      extensions: [notePath.of(path), history(), logCard, ...extra],
    }),
    parent,
  });
  mounted.push(view);
  return view;
}

const amount = (view: EditorView) => view.dom.querySelector(".cm-log-amount") as HTMLInputElement;
const why = (view: EditorView) => view.dom.querySelector(".cm-log-why")?.textContent;
const text = (view: EditorView) => view.state.doc.toString();
const totals = (view: EditorView) => view.dom.querySelector(".cm-log-totals")?.textContent ?? "";
const broken = (view: EditorView) => view.dom.querySelector(".cm-log-broken")?.textContent ?? "";

/** Presses the card's button with this aria-label, or fails the test where there is none. */
function press(view: EditorView, label: string): void {
  const found = view.dom.querySelector<HTMLButtonElement>(`.cm-log button[aria-label='${label}']`);
  if (found === null) throw new Error(`no ${label} button on the card`);
  found.click();
}

/** Waits for the note's config to be drawn, which a button with this label shows. */
async function arrived(view: EditorView, label: string): Promise<void> {
  await vi.waitFor(() =>
    expect(view.dom.querySelector(`.cm-log button[aria-label='${label}']`)).not.toBeNull(),
  );
}

describe("the log card's kinds", () => {
  it("#623 with no config note the card shows the three default kinds as before", async () => {
    const view = mount(NOTE);
    await vi.waitFor(() => expect(fetchNote).toHaveBeenCalledWith(LOG));
    // The missing note's rejection is in once it settles; the defaults drawn meanwhile are the same.
    await expect(vi.mocked(fetchNote).mock.results[0]?.value).rejects.toBeInstanceOf(NoteMissing);
    await Promise.resolve();
    expect(totals(view)).toBe("💧 500 ml☕ 0🍺 0");
    const labels = [...view.dom.querySelectorAll<HTMLButtonElement>(".cm-log-button")].map(
      (button) => button.textContent,
    );
    expect(labels).toEqual(["+ 💧 250 ml", "+ ☕ 1", "+ 🍺 1", "+ 🍽 food"]);
  });

  it("#623 a tea line in the config note puts a tea button on the card and its tap writes - 🍵 1 cup", async () => {
    vi.mocked(fetchNote).mockResolvedValue(`${DEFAULTS}\n- 🍵 tea: 1 cup, min 3`);
    const view = mount(NOTE);
    await arrived(view, "Log tea");
    press(view, "Log tea");
    expect(text(view)).toBe(
      "# 2026-10-20 Tuesday\n\n## Log\n- 💧 500 ml\n- 🍵 1 cup\n\n## Done\n- [ ] write",
    );
  });

  it("#623 the card counts the tea lines under ## Log", async () => {
    vi.mocked(fetchNote).mockResolvedValue(`${DEFAULTS}\n- 🍵 tea: 1 cup`);
    const view = mount("# 2026-10-20\n\n## Log\n- 🍵 1 cup\n- 🍵 2 cup\n\n## Done\n- 🍵 4 cup");
    await vi.waitFor(() => expect(totals(view)).toContain("🍵 3 cup"));
    expect(totals(view)).not.toContain("🍵 7 cup");
  });

  it("#623 food goals show for kcal and each macro", async () => {
    vi.mocked(fetchNote).mockResolvedValue(
      `${DEFAULTS}\n- 🍽 food: kcal max 2200, protein min 120, carbs max 250, fat max 80`,
    );
    const view = mount(`${NOTE}\n\n## Log\n- 🍽 lunch: Skyr 🔥 160 kcal 🥩 27 g 🍞 10 g 🧈 2 g`);
    await vi.waitFor(() => expect(totals(view)).toContain("🔥 160 / 2200 kcal"));
    expect(totals(view)).toContain("🥩 27 / 120 g");
    expect(totals(view)).toContain("🍞 10 / 250 g");
    expect(totals(view)).toContain("🧈 2 / 80 g");
  });

  it("#623 a floor short of its goal shows progress and a met floor says so", async () => {
    vi.mocked(fetchNote).mockResolvedValue(
      "- 💧 water: 250 ml, min 2000\n- ☕ coffee: 1\n- 🍺 alcohol: 1\n- 🍽 food: protein min 20",
    );
    const view = mount(`${NOTE}\n\n## Log\n- 🍽 lunch: Skyr 🥩 27 g`);
    await vi.waitFor(() => expect(view.dom.querySelector(".cm-log-short")).not.toBeNull());
    const short = view.dom.querySelector<HTMLElement>(".cm-log-short");
    expect(short?.textContent).toBe("💧 500 / 2000 ml");
    expect(short?.getAttribute("style")).toContain("--log-progress: 25%");
    const met = view.dom.querySelector<HTMLElement>(".cm-log-met");
    expect(met?.textContent).toBe("🥩 27 / 20 g ✓");
  });

  it("#623 a ceiling passed warns", async () => {
    vi.mocked(fetchNote).mockResolvedValue(
      "- 💧 water: 250 ml\n- ☕ coffee: 1\n- 🍺 alcohol: 1, max 1\n- 🍽 food: kcal max 2200",
    );
    const view = mount(`${NOTE}\n\n## Log\n- 🍺 1 0.5 l 5%\n- 🍺 1\n- 🍽 lunch: Pizza 🔥 2300 kcal`);
    await vi.waitFor(() => expect(view.dom.querySelector(".cm-log-over")).not.toBeNull());
    const over = [...view.dom.querySelectorAll<HTMLElement>(".cm-log-over")].map(
      (span) => span.textContent,
    );
    expect(over).toHaveLength(2);
    expect(over[0]).toContain("🍺 2 / 1");
    expect(over[0]?.endsWith("⚠")).toBe(true);
    expect(over[1]).toBe("🔥 2300 / 2200 kcal ⚠");
  });

  it("#623 a broken config line is named on the card and the other kinds still work", async () => {
    vi.mocked(fetchNote).mockResolvedValue(`${DEFAULTS}\n- 🧃 juice: lots`);
    const view = mount(NOTE);
    await vi.waitFor(() => expect(broken(view)).toMatch(/Skipped line \d+ of log\.md: .*juice/));
    press(view, "Log water");
    expect(text(view)).toContain("- 💧 500 ml\n- 💧 250 ml\n\n## Done");
  });

  it("#623 with vim on, a tea tap leaves vim in normal mode and u takes it back", async () => {
    vi.mocked(fetchNote).mockResolvedValue(`${DEFAULTS}\n- 🍵 tea: 1 cup, min 3`);
    const view = mount(NOTE, DAILY, [vim(), vimModeState()]);
    await arrived(view, "Log tea");
    press(view, "Log tea");
    expect(view.state.field(vimModeField)).toBe("normal");
    fireEvent.keyDown(view.contentDOM, { key: "u" });
    expect(text(view)).toBe(NOTE);
  });

  it("#623 with vim off, undo takes a tea tap back", async () => {
    vi.mocked(fetchNote).mockResolvedValue(`${DEFAULTS}\n- 🍵 tea: 1 cup, min 3`);
    const view = mount(NOTE, DAILY, [vimKeys.of(false)]);
    await arrived(view, "Log tea");
    press(view, "Log tea");
    undo(view);
    expect(text(view)).toBe(NOTE);
  });

  it("#623 a config note that fails to load gives the default kinds", async () => {
    const message = "GET /api/files/99 Misc/01 Config/log.md failed with 500";
    vi.mocked(fetchNote).mockRejectedValue(new Error(message));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const view = mount(NOTE);
    await vi.waitFor(() => expect(warn).toHaveBeenCalledWith(message));
    const labels = [...view.dom.querySelectorAll<HTMLButtonElement>(".cm-log-button")].map(
      (button) => button.textContent,
    );
    expect(labels).toEqual(["+ 💧 250 ml", "+ ☕ 1", "+ 🍺 1", "+ 🍽 food"]);
    expect(broken(view)).toBe("");
    warn.mockRestore();
  });

  it("#623 a config line can change water's tap to 500 ml", async () => {
    vi.mocked(fetchNote).mockResolvedValue("- 💧 water: 500 ml\n- ☕ coffee: 1\n- 🍺 alcohol: 1");
    const view = mount(NOTE);
    await vi.waitFor(() =>
      expect(view.dom.querySelector(".cm-log button[aria-label='Log water']")?.textContent).toBe(
        "+ 💧 500 ml",
      ),
    );
    press(view, "Log water");
    expect(text(view)).toContain("- 💧 500 ml\n- 💧 500 ml\n\n## Done");
  });

  it("#623 a repeated emoji or a food marker as a kind is named as broken", async () => {
    vi.mocked(fetchNote).mockResolvedValue(`${DEFAULTS}\n- 💧 juice: 250 ml\n- 🔥 spice: 1`);
    const view = mount(NOTE);
    await vi.waitFor(() => expect(broken(view)).toContain("juice"));
    expect(broken(view)).toContain("spice");
    expect(view.dom.querySelectorAll(".cm-log-broken > div")).toHaveLength(2);
  });

  it("#623 tea lines with a wrong unit, a zero or trailing words count for nothing", async () => {
    vi.mocked(fetchNote).mockResolvedValue(`${DEFAULTS}\n- 🍵 tea: 1 cup`);
    const view = mount(
      "# 2026-10-20\n\n## Log\n- 🍵 1 ml\n- 🍵 0 cup\n- 🍵 1 cup of green\n- 🍵 2 cup\n\n## Done",
    );
    await vi.waitFor(() => expect(totals(view)).toContain("🍵 2 cup"));
    expect(totals(view)).not.toContain("🍵 3");
  });

  it("#623 the amount field writes 2 cups of tea and refuses text that is no amount", async () => {
    vi.mocked(fetchNote).mockResolvedValue(`${DEFAULTS}\n- 🍵 tea: 1 cup`);
    const view = mount(NOTE);
    await arrived(view, "Log tea");
    amount(view).value = "2";
    press(view, "Log tea");
    expect(text(view)).toContain("- 💧 500 ml\n- 🍵 2 cup\n\n## Done");

    const before = text(view);
    amount(view).value = "lots";
    press(view, "Log tea");
    expect(text(view)).toBe(before);
    expect(why(view)).toBeTruthy();
  });

  it("#623 the card's Undo takes a tea tap back", async () => {
    vi.mocked(fetchNote).mockResolvedValue(`${DEFAULTS}\n- 🍵 tea: 1 cup, min 3`);
    const view = mount(NOTE);
    await arrived(view, "Log tea");
    press(view, "Log tea");
    view.dom.querySelector<HTMLButtonElement>(".cm-log-undo")?.click();
    expect(text(view)).toBe(NOTE);
  });

  it("#623 prose, headings and frontmatter in the config note are not named as broken", async () => {
    vi.mocked(fetchNote).mockResolvedValue(
      `---\ntype: Config\n---\n# Log kinds\n\nOne kind a line, and the tap it writes.\n\n${DEFAULTS}\n- 🍵 tea: 1 cup\n`,
    );
    const view = mount(NOTE);
    // The tea is in only once the config is, so its button shows the config has arrived.
    await arrived(view, "Log tea");
    expect(view.dom.querySelector(".cm-log-broken")).toBeNull();
  });

  it("#623 a config note without coffee shows no coffee button and keeps the food button", async () => {
    vi.mocked(fetchNote).mockResolvedValue("- 💧 water: 250 ml\n- 🍺 alcohol: 1");
    const view = mount(NOTE);
    await vi.waitFor(() => expect(fetchNote).toHaveBeenCalledWith(LOG));
    await vi.waitFor(() =>
      expect(view.dom.querySelector(".cm-log button[aria-label='Log coffee']")).toBeNull(),
    );
    expect(view.dom.querySelector(".cm-log button[aria-label='Log food']")).not.toBeNull();
  });

  it("#623 a food floor reads as short before the first food", async () => {
    vi.mocked(fetchNote).mockResolvedValue(`${DEFAULTS}\n- 🍽 food: protein min 120`);
    const view = mount(NOTE);
    await vi.waitFor(() => expect(totals(view)).toContain("🥩 0 / 120 g"));
    expect(view.dom.querySelector(".cm-log-short")?.textContent).toBe("🥩 0 / 120 g");
  });

  it("#623 a config arriving while the food search is open keeps the query's focus", async () => {
    // The note answers only when the test says so, so the card is drawn before the arrival.
    let answer: (note: string) => void = () => undefined;
    vi.mocked(fetchNote).mockReturnValue(
      new Promise<string>((resolve) => {
        answer = resolve;
      }),
    );
    const view = mount(NOTE);
    press(view, "Log food");
    const query = view.dom.querySelector<HTMLInputElement>(".cm-log-food-query");
    query?.focus();
    expect(document.activeElement).toBe(query);

    answer(`${DEFAULTS}\n- 🍵 tea: 1 cup, min 3`);
    await arrived(view, "Log tea");
    expect(document.activeElement).toBe(view.dom.querySelector(".cm-log-food-query"));
    expect(view.dom.querySelector(".cm-log-food-query")).not.toBeNull();
  });
});
