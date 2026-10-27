import { history, undo } from "@codemirror/commands";
import { EditorState, type Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { vim } from "@replit/codemirror-vim";
import { fireEvent } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { logCard } from "@/lib/log-card";
import { notePath } from "@/lib/todo/todo-commands";
import { vimKeys, vimModeField, vimModeState } from "@/lib/vim-mode";

const DAILY = "01 Periodic/00 Daily/2026-10-20.md";
const OTHER = "02 Projects/Plan.md";
const NOTE = "# 2026-10-20 Tuesday\n\n## Log\n- 💧 500 ml\n\n## Done\n- [ ] write";
const FENCED = "# 2026-10-20 Tuesday\n\n## Log\n- 💧 500 ml\n```\ncode\n";

const mounted: EditorView[] = [];

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

const card = (view: EditorView) => view.dom.querySelector<HTMLElement>(".cm-log");
const amount = (view: EditorView) => view.dom.querySelector(".cm-log-amount") as HTMLInputElement;
const why = (view: EditorView) => view.dom.querySelector(".cm-log-why")?.textContent;
const text = (view: EditorView) => view.state.doc.toString();
// The kinds' totals sit in their quick buttons, beside the words of their taps (#803).
const totals = (view: EditorView) =>
  [...view.dom.querySelectorAll(".cm-log-button-total")].map((node) => node.textContent).join("");

/** Presses the card's button with this aria-label, or fails the test where there is none. */
function press(view: EditorView, label: string): void {
  const found = view.dom.querySelector<HTMLButtonElement>(`.cm-log button[aria-label='${label}']`);
  if (found === null) throw new Error(`no ${label} button on the card`);
  found.click();
}

describe("the log card", () => {
  it("shows the card on a daily note", () => {
    expect(card(mount(NOTE))).not.toBeNull();
  });

  it("shows no card on another note", () => {
    expect(card(mount(NOTE, OTHER))).toBeNull();
  });

  it("totals only the lines under this note's ## Log", () => {
    const view = mount("# 2026-10-20\n\n## Log\n- 💧 500 ml\n\n## Done\n- 💧 300 ml");
    expect(view.dom.querySelector(".cm-log-totals")?.textContent).toContain("💧 500 ml");
  });

  it("a tap appends the default line at the end of ## Log", () => {
    const view = mount(NOTE);
    press(view, "Log water");
    expect(text(view)).toBe(
      "# 2026-10-20 Tuesday\n\n## Log\n- 💧 500 ml\n- 💧 250 ml\n\n## Done\n- [ ] write",
    );
  });

  it("a tap makes ## Log where the note has none", () => {
    const view = mount("# 2026-10-20 Tuesday\n\nsome text");
    press(view, "Log coffee");
    expect(text(view)).toBe("# 2026-10-20 Tuesday\n\nsome text\n\n## Log\n- ☕ 1\n");
  });

  it("writes the amount typed in the field", () => {
    const view = mount(NOTE);
    amount(view).value = "330";
    press(view, "Log water");
    expect(text(view)).toContain("- 💧 330 ml\n\n## Done");
  });

  it("a bad amount writes nothing and shows why", () => {
    const view = mount(NOTE);
    amount(view).value = "500 g";
    press(view, "Log water");
    expect(text(view)).toBe(NOTE);
    expect(why(view)).toBe("not a water amount: 500 g");
  });

  it("two quick taps both land, in order", () => {
    const view = mount(NOTE);
    press(view, "Log water");
    press(view, "Log coffee");
    expect(text(view)).toContain("- 💧 500 ml\n- 💧 250 ml\n- ☕ 1\n\n## Done");
  });

  it("Undo takes the tapped line out", () => {
    const view = mount(NOTE);
    press(view, "Log water");
    view.dom.querySelector<HTMLButtonElement>(".cm-log-undo")?.click();
    expect(text(view)).toBe(NOTE);
  });

  it("no Undo once the tapped line was edited", () => {
    const view = mount(NOTE);
    press(view, "Log water");
    const at = text(view).indexOf("- 💧 250 ml");
    view.dispatch({ changes: { from: at + 2, insert: "x" } });
    expect(view.dom.querySelector(".cm-log-undo")).toBeNull();
  });

  it("a tap leaves the selection where it was", () => {
    const view = mount(NOTE, DAILY, [], NOTE.indexOf("500"));
    press(view, "Log water");
    expect(view.state.selection.main.from).toBe(NOTE.indexOf("500"));
    expect(view.state.selection.main.to).toBe(NOTE.indexOf("500"));
  });

  it("an unrelated edit keeps the typed amount in the field", () => {
    const view = mount(NOTE);
    const field = amount(view);
    field.value = "330";
    view.dispatch({ changes: { from: text(view).length, insert: "\nnote" } });
    expect(amount(view)).toBe(field);
    expect(amount(view).value).toBe("330");
  });

  it("with vim on, a tap leaves vim in normal mode and u takes it back", () => {
    const view = mount(NOTE, DAILY, [vim(), vimModeState()]);
    press(view, "Log water");
    expect(view.state.field(vimModeField)).toBe("normal");
    fireEvent.keyDown(view.contentDOM, { key: "u" });
    expect(text(view)).toBe(NOTE);
  });

  it("with vim off, undo takes a tap back", () => {
    const view = mount(NOTE, DAILY, [vimKeys.of(false)]);
    press(view, "Log water");
    undo(view);
    expect(text(view)).toBe(NOTE);
  });

  it("two quick taps come back one undo each", () => {
    const view = mount(NOTE, DAILY, [vimKeys.of(false)]);
    press(view, "Log water");
    press(view, "Log coffee");
    undo(view);
    expect(text(view)).toBe(
      "# 2026-10-20 Tuesday\n\n## Log\n- 💧 500 ml\n- 💧 250 ml\n\n## Done\n- [ ] write",
    );
    undo(view);
    expect(text(view)).toBe(NOTE);
  });

  it("the totals follow a tap, a typed line and an undo", () => {
    const view = mount(NOTE);
    press(view, "Log water");
    expect(totals(view)).toContain("💧 750 ml");
    const end = text(view).indexOf("- 💧 250 ml") + "- 💧 250 ml".length;
    view.dispatch({ changes: { from: end, insert: "\n- ☕ 1" } });
    expect(totals(view)).toContain("☕ 1");
    undo(view);
    expect(totals(view)).toContain("☕ 0");
    expect(totals(view)).not.toContain("☕ 1");
  });

  it("typing in the amount field leaves the note as it was", () => {
    const view = mount(NOTE);
    const field = amount(view);
    field.focus();
    field.value = "330";
    field.dispatchEvent(new Event("input", { bubbles: true }));
    field.dispatchEvent(new KeyboardEvent("keydown", { key: "x", bubbles: true }));
    expect(text(view)).toBe(NOTE);
    expect(amount(view).value).toBe("330");
  });

  it("an edit above the log keeps the typed amount while Undo shows", () => {
    const view = mount(NOTE);
    press(view, "Log water");
    expect(view.dom.querySelector(".cm-log-undo")).not.toBeNull();
    amount(view).value = "500";
    // The end of the title, not the start: a letter before the `#` would stop the title reading as one.
    const at = NOTE.indexOf("\n");
    view.dispatch({ changes: { from: at, insert: "x" } });
    expect(amount(view).value).toBe("500");
    view.dom.querySelector<HTMLButtonElement>(".cm-log-undo")?.click();
    expect(text(view)).toBe(`${NOTE.slice(0, at)}x${NOTE.slice(at)}`);
  });

  it("with vim on, a tap into a ## Log ending in an unclosed fence closes it and u takes both back", () => {
    const view = mount(FENCED, DAILY, [vim(), vimModeState()]);
    press(view, "Log water");
    const after = text(view);
    fireEvent.keyDown(view.contentDOM, { key: "u" });
    expect([after, text(view)]).toEqual([
      "# 2026-10-20 Tuesday\n\n## Log\n- 💧 500 ml\n```\ncode\n```\n- 💧 250 ml\n",
      FENCED,
    ]);
  });

  it("with vim off, a tap into a ## Log ending in an unclosed fence closes it and undo takes both back", () => {
    const view = mount(FENCED, DAILY, [vimKeys.of(false)]);
    press(view, "Log water");
    const after = text(view);
    undo(view);
    expect([after, text(view)]).toEqual([
      "# 2026-10-20 Tuesday\n\n## Log\n- 💧 500 ml\n```\ncode\n```\n- 💧 250 ml\n",
      FENCED,
    ]);
  });
});
