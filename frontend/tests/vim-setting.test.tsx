import { EditorView } from "@codemirror/view";
import { act, fireEvent, render, waitFor } from "@testing-library/react";
import { Editor } from "@/components/editor";
import { paletteEntries } from "@/lib/palette";
import { toggleVim } from "@/lib/vim-setting";
import { COARSE, stubMatchMedia } from "./match-media";
import { stubCommands } from "./stub-commands";

const DOC = "line one\nline two";

function content(container: HTMLElement) {
  return container.querySelector(".cm-content") as HTMLElement;
}

/** `dd` deletes a line under vim and is two letters nobody typed without it. */
function pressDd(container: HTMLElement) {
  fireEvent.keyDown(content(container), { key: "d" });
  fireEvent.keyDown(content(container), { key: "d" });
  return content(container).textContent;
}

function gutter(container: HTMLElement) {
  return [...container.querySelectorAll<HTMLElement>(".cm-lineNumbers .cm-gutterElement")]
    .filter((n) => n.style.visibility !== "hidden")
    .map((n) => n.textContent ?? "");
}

function entry(view: EditorView | null, label: string) {
  const found = paletteEntries(stubCommands(), view).find((row) => row.label === label);
  if (!found) throw new Error(`no palette row called ${label}`);
  return found;
}

function viewIn(container: HTMLElement) {
  const view = EditorView.findFromDOM(content(container));
  if (!view) throw new Error("no view");
  return view;
}

beforeEach(() => localStorage.clear());
afterEach(() => vi.unstubAllGlobals());

describe("the vim setting", () => {
  it("runs vim on a fine pointer", () => {
    const { container } = render(<Editor initialDoc={DOC} />);

    expect(pressDd(container)).toBe("line two");
  });

  it("leaves vim out on a coarse pointer", () => {
    stubMatchMedia({ [COARSE]: true });
    const { container } = render(<Editor initialDoc={DOC} />);

    expect(pressDd(container)).toBe("line oneline two");
  });

  it("keeps vim on a coarse pointer once it was turned on by hand", () => {
    stubMatchMedia({ [COARSE]: true });
    localStorage.setItem("kasten.vim", "on");
    const { container } = render(<Editor initialDoc={DOC} />);

    expect(pressDd(container)).toBe("line two");
  });

  it("leaves vim out on a fine pointer once it was turned off by hand", () => {
    localStorage.setItem("kasten.vim", "off");
    const { container } = render(<Editor initialDoc={DOC} />);

    expect(pressDd(container)).toBe("line oneline two");
  });

  it("toggles from the palette, stores the answer, and keeps the buffer", () => {
    const { container } = render(<Editor initialDoc={DOC} />);
    // An edit the vault never saw, which a remount would lose.
    pressDd(container);

    act(() => entry(null, "Toggle vim keys").run());

    expect(localStorage.getItem("kasten.vim")).toBe("off");
    expect(pressDd(container)).toBe("line two");

    act(() => toggleVim());

    expect(localStorage.getItem("kasten.vim")).toBe("on");
    expect(pressDd(container)).toBe("");
  });

  it("opens the palette on ctrl+shift+p with vim on, past vim's own keymap", () => {
    const commands = stubCommands();
    const { container } = render(<Editor initialDoc={DOC} commands={commands} />);

    fireEvent.keyDown(content(container), {
      key: "P",
      keyCode: 80,
      ctrlKey: true,
      shiftKey: true,
    });

    expect(commands.openPalette).toHaveBeenCalledTimes(1);
  });

  it("turns every mounted editor off at once", () => {
    const first = render(<Editor initialDoc={DOC} />);
    const second = render(<Editor initialDoc={DOC} />);

    act(() => toggleVim());

    expect(pressDd(first.container)).toBe("line oneline two");
    expect(pressDd(second.container)).toBe("line oneline two");
  });
});

describe("the editor without vim", () => {
  beforeEach(() => {
    stubMatchMedia({ [COARSE]: true });
  });

  it("saves on ctrl+s", () => {
    const onSave = vi.fn();
    const { container } = render(<Editor initialDoc="# hello" onSave={onSave} />);

    fireEvent.keyDown(content(container), { key: "s", ctrlKey: true });

    expect(onSave).toHaveBeenCalledWith("# hello");
  });

  it("shows the source of the line the cursor is on, and renders the rest", () => {
    const { container } = render(<Editor initialDoc={"## Notes\n\n**bold** text"} />);

    expect(content(container).textContent).toContain("## Notes");
    expect(content(container).textContent).not.toContain("**");
  });

  it("counts lines from the top, there being no `5j` to count for", () => {
    const { container } = render(<Editor initialDoc={"one\ntwo\nthree"} startLine={2} />);

    expect(gutter(container)).toEqual(["1", "2", "3"]);
  });

  it("opens the palette on ctrl+shift+p", () => {
    const commands = stubCommands();
    const { container } = render(<Editor initialDoc={DOC} commands={commands} />);

    fireEvent.keyDown(content(container), {
      key: "P",
      // CodeMirror reads a shifted letter off the key code.
      keyCode: 80,
      ctrlKey: true,
      shiftKey: true,
    });

    expect(commands.openPalette).toHaveBeenCalledTimes(1);
  });

  it("follows a link on a tap", () => {
    const onFollow = vi.fn();
    const { container } = render(
      <Editor initialDoc={"intro\n\nsee [[reading/borges]]"} onFollow={onFollow} />,
    );
    const link = container.querySelector(".cm-wikilink") as HTMLElement;

    fireEvent.pointerDown(link, { pointerType: "touch" });
    fireEvent.click(link);

    expect(onFollow).toHaveBeenCalledWith("reading/borges");
  });

  it("does not follow a link the finger only scrolled from", () => {
    const onFollow = vi.fn();
    const { container } = render(
      <Editor initialDoc={"intro\n\nsee [[reading/borges]]"} onFollow={onFollow} />,
    );

    // No click: a drag ends without one.
    fireEvent.pointerDown(container.querySelector(".cm-wikilink") as HTMLElement, {
      pointerType: "touch",
    });
    fireEvent.pointerDown(content(container), { pointerType: "touch" });
    fireEvent.click(content(container));

    expect(onFollow).not.toHaveBeenCalled();
  });

  it("leaves a mouse click to the cursor", () => {
    const onFollow = vi.fn();
    const { container } = render(
      <Editor initialDoc={"intro\n\nsee [[reading/borges]]"} onFollow={onFollow} />,
    );
    const link = container.querySelector(".cm-wikilink") as HTMLElement;

    fireEvent.pointerDown(link, { pointerType: "mouse" });
    fireEvent.click(link);

    expect(onFollow).not.toHaveBeenCalled();
  });

  it("leaves a tap in the link the cursor is in to the cursor", () => {
    const onFollow = vi.fn();
    // The cursor opens on the first line, which is the link's.
    const { container } = render(<Editor initialDoc="[[reading/borges]]" onFollow={onFollow} />);
    const link = container.querySelector(".cm-wikilink") as HTMLElement;
    expect(content(container).textContent).toBe("[[reading/borges]]");

    fireEvent.pointerDown(link, { pointerType: "touch" });
    fireEvent.click(link);

    expect(onFollow).not.toHaveBeenCalled();
  });

  it("goes back to hiding marks by mode when vim is turned on", async () => {
    const { container } = render(<Editor initialDoc={"## Notes\n\nplain"} />);
    expect(content(container).textContent).toContain("##");

    act(() => toggleVim());

    // Normal mode reads, so the marks go.
    await waitFor(() => expect(content(container).textContent).not.toContain("##"));

    // And the vim that arrived after the view did is listened to.
    fireEvent.keyDown(content(container), { key: "i" });
    await waitFor(() => expect(content(container).textContent).toContain("## Notes"));
  });
});

describe("what vim's own keys reach, by name", () => {
  beforeEach(() => {
    stubMatchMedia({ [COARSE]: true });
  });

  it("writes the note", () => {
    const onSave = vi.fn();
    const { container } = render(<Editor initialDoc="# hello" onSave={onSave} />);

    entry(viewIn(container), "Write the note").run();

    expect(onSave).toHaveBeenCalledWith("# hello");
  });

  it("rereads the note, with and without the bang", () => {
    const onReload = vi.fn().mockResolvedValue(null);
    const { container } = render(<Editor initialDoc="text" onReload={onReload} />);
    const view = viewIn(container);

    entry(view, "Read the note off the vault again").run();
    entry(view, "Read the note off the vault again, throwing away unsaved text").run();

    expect(onReload.mock.calls).toEqual([[false], [true]]);
  });

  it("follows the link under the cursor", () => {
    const onFollow = vi.fn();
    const { container } = render(<Editor initialDoc="[[reading/borges]]" onFollow={onFollow} />);

    entry(viewIn(container), "Open what the wikilink or highlight under the cursor names").run();

    expect(onFollow).toHaveBeenCalledWith("reading/borges");
  });

  it("copies the selection for Slack, or the whole note with none", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
    const onNotice = vi.fn();
    const { container } = render(<Editor initialDoc="**bold** and more" onNotice={onNotice} />);
    const view = viewIn(container);

    entry(view, "Copy for Slack").run();
    act(() => view.dispatch({ selection: { anchor: 0, head: 8 } }));
    entry(view, "Copy as markdown").run();

    expect(writeText.mock.calls).toEqual([["*bold* and more"], ["**bold**"]]);
    await waitFor(() => expect(onNotice).toHaveBeenCalledWith("Copied for Slack"));
  });

  it("goes to a tab by number, which no leader row names", () => {
    const commands = stubCommands();
    const row = paletteEntries(commands, null).find((r) => r.label === "Go to tab 3");

    row?.run();

    expect(commands.goToTab).toHaveBeenCalledWith(2);
    expect(row?.keys).toBe("Space 3");
  });

  it("lists none of them over a view that is not a note's editor", () => {
    const labels = paletteEntries(stubCommands(), new EditorView()).map((row) => row.label);

    expect(labels).not.toContain("Write the note");
  });
});
