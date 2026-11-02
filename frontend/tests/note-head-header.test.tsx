import { undo } from "@codemirror/commands";
import { EditorView } from "@codemirror/view";
import { act, fireEvent, render } from "@testing-library/react";
import { Editor } from "@/components/editor";
import cases from "@/lib/tag-cases.json";
import { stubCommands } from "./stub-commands";

const PATH = "02 Projects/Kasten/Reader.md";
const DOC = [
  "---",
  "type: Concept",
  "modified: 2026-10-21T10:00:00+00:00",
  "tags: [design, reading]",
  "---",
  "# Reader",
  "",
  "Some words here.",
  "",
].join("\n");

function text(container: HTMLElement, selector: string): string {
  return container.querySelector(selector)?.textContent ?? "";
}

function part(container: HTMLElement, name: string): string {
  return container.querySelector(`[data-head="${name}"]`)?.textContent ?? "";
}

function buttonNamed(container: HTMLElement, label: string): HTMLButtonElement | undefined {
  return [...container.querySelectorAll("button")].find((button) => button.textContent === label);
}

function viewIn(container: HTMLElement): EditorView {
  return EditorView.findFromDOM(container.querySelector(".cm-editor") as HTMLElement) as EditorView;
}

beforeEach(() => localStorage.clear());
afterEach(() => localStorage.clear());

it("the header shows the path, the title and the meta line of the note", () => {
  const { container } = render(<Editor initialDoc={DOC} path={PATH} commands={stubCommands()} />);

  expect(part(container, "path")).toBe("02 Projects / Kasten");
  expect(part(container, "title")).toBe("Reader");
  const meta = part(container, "meta");
  expect(meta).toContain("Concept");
  expect(meta).toContain("21 Oct 2026");
  expect(meta).toContain("5 words");
  expect(container.querySelectorAll(".cm-note-tag")).toHaveLength(2);
});

it("A7 the header draws a Graph button after the path, and a press calls onGraph without moving the editor's selection", () => {
  const onGraph = vi.fn();
  const { container } = render(
    <Editor initialDoc={DOC} path={PATH} commands={stubCommands()} onGraph={onGraph} />,
  );
  const graph = container.querySelector<HTMLButtonElement>("[data-head='graph']");
  expect(graph).not.toBeNull();
  expect(graph?.textContent).toBe("Graph");
  if (graph === null) return;
  expect(container.querySelector("[data-head='path']")?.nextElementSibling).toBe(graph);

  const view = viewIn(container);
  act(() => view.dispatch({ selection: { anchor: DOC.indexOf("Some") } }));
  const at = view.state.selection.main.head;

  // The press keeps the editor's focus, as the header's other buttons do.
  expect(fireEvent.mouseDown(graph)).toBe(false);
  fireEvent.click(graph);

  expect(onGraph).toHaveBeenCalledTimes(1);
  expect(view.state.selection.main.head).toBe(at);
});

it("L3 at the vault root the Graph button starts the row, with no empty path before it", () => {
  const { container } = render(
    <Editor initialDoc={DOC} path="Reader.md" commands={stubCommands()} onGraph={vi.fn()} />,
  );
  const graph = container.querySelector<HTMLButtonElement>("[data-head='graph']");
  expect(graph).not.toBeNull();
  if (graph === null) return;

  expect(container.querySelector("[data-head='path']")).toBeNull();
  expect(graph.parentElement?.firstElementChild).toBe(graph);
});

it("a relation line shows as a plain line in the header", () => {
  const { container } = render(
    <Editor initialDoc={`${DOC}part-of:: [[Kasten]]\n`} path={PATH} commands={stubCommands()} />,
  );

  expect(part(container, "relations")).toContain("Part of");
  expect(part(container, "relations")).toContain("Kasten");
});

it("in Read the frontmatter is hidden and Properties lists it", () => {
  const { container } = render(<Editor initialDoc={DOC} path={PATH} commands={stubCommands()} />);

  expect(text(container, ".cm-content")).not.toContain("modified:");

  const properties = buttonNamed(container, "Properties");
  if (properties) fireEvent.click(properties);
  expect(part(container, "property-list")).toContain("type");
  expect(part(container, "property-list")).toContain("Concept");
});

it("the frontmatter shows while the cursor is inside it", () => {
  const { container } = render(<Editor initialDoc={DOC} path={PATH} commands={stubCommands()} />);
  expect(container.querySelector(".cm-note-head")).not.toBeNull();

  act(() => viewIn(container).dispatch({ selection: { anchor: 0 } }));

  expect(text(container, ".cm-content")).toContain("type: Concept");
});

it("in Edit the frontmatter shows as text", () => {
  const { container } = render(
    <Editor initialDoc={DOC} path={PATH} commands={stubCommands()} preview={false} />,
  );

  expect(text(container, ".cm-content")).toContain("modified:");
  expect(buttonNamed(container, "Edit")?.getAttribute("aria-pressed")).toBe("true");
});

it("the Read and Edit switch calls the preview toggle", () => {
  const commands = stubCommands();
  const { container } = render(<Editor initialDoc={DOC} path={PATH} commands={commands} />);

  const edit = buttonNamed(container, "Edit");
  if (edit) fireEvent.click(edit);

  expect(commands.togglePreview).toHaveBeenCalledTimes(1);
  expect(viewIn(container).state.doc.toString()).toBe(DOC);
});

it("the header follows a typed heading and tag", () => {
  const onOutline = vi.fn();
  const { container } = render(
    <Editor initialDoc={DOC} path={PATH} commands={stubCommands()} onOutline={onOutline} />,
  );

  const view = viewIn(container);
  act(() =>
    view.dispatch({ changes: { from: view.state.doc.length, insert: "\n## New part #fresh" } }),
  );

  const headings = (onOutline.mock.calls.at(-1)?.[0]?.headings ?? []) as { text: string }[];
  expect(headings.some((heading) => heading.text.startsWith("New part"))).toBe(true);
  expect(part(container, "meta")).toContain("#fresh");
});

it("with vim on, i and a typed word edit the note under the header", () => {
  localStorage.setItem("kasten.vim", "on");
  const { container } = render(<Editor initialDoc={DOC} path={PATH} commands={stubCommands()} />);
  expect(container.querySelector(".cm-note-head")).not.toBeNull();

  const view = viewIn(container);
  const at = DOC.indexOf("Some");
  act(() => view.dispatch({ selection: { anchor: at } }));
  fireEvent.keyDown(container.querySelector(".cm-content") as HTMLElement, { key: "i" });
  act(() => view.dispatch({ changes: { from: at, insert: "fresh " }, userEvent: "input.type" }));

  expect(view.state.doc.toString()).toContain("fresh Some words here.");
  expect(container.querySelector(".cm-note-head")).not.toBeNull();
});

it("with vim off, a typed word edits the note under the header", () => {
  localStorage.setItem("kasten.vim", "off");
  const { container } = render(<Editor initialDoc={DOC} path={PATH} commands={stubCommands()} />);
  expect(container.querySelector(".cm-note-head")).not.toBeNull();

  const view = viewIn(container);
  const at = DOC.indexOf("Some");
  act(() =>
    view.dispatch({
      selection: { anchor: at },
      changes: { from: at, insert: "fresh " },
      userEvent: "input.type",
    }),
  );

  expect(view.state.doc.toString()).toContain("fresh Some words here.");
  expect(container.querySelector(".cm-note-head")).not.toBeNull();
});

it("with vim off, Backspace at the start of the first body line in Read shows the YAML", () => {
  localStorage.setItem("kasten.vim", "off");
  const { container } = render(<Editor initialDoc={DOC} path={PATH} commands={stubCommands()} />);
  const view = viewIn(container);
  act(() => view.dispatch({ selection: { anchor: DOC.indexOf("# Reader") } }));

  // The Backspace joins the closing fence to the heading, so the block no longer closes.
  fireEvent.keyDown(container.querySelector(".cm-content") as HTMLElement, { key: "Backspace" });
  expect(text(container, ".cm-content")).toContain("type: Concept");

  act(() => undo(view));
  expect(view.state.doc.toString()).toBe(DOC);
});

it("with vim on, dd on the closing fence line in Read shows the YAML it broke, and u puts it back", () => {
  localStorage.setItem("kasten.vim", "on");
  const { container } = render(<Editor initialDoc={DOC} path={PATH} commands={stubCommands()} />);
  const view = viewIn(container);
  // The cursor goes onto the fence by dispatch: vim's own motions need a layout jsdom lacks.
  act(() => view.dispatch({ selection: { anchor: DOC.indexOf("---\n# Reader") } }));

  // Without the fence the YAML above it is unclosed, so it shows as text.
  const content = container.querySelector(".cm-content") as HTMLElement;
  fireEvent.keyDown(content, { key: "d" });
  fireEvent.keyDown(content, { key: "d" });
  expect(view.state.doc.toString()).toBe(DOC.replace("---\n# Reader", "# Reader"));
  expect(text(container, ".cm-content")).toContain("type: Concept");

  fireEvent.keyDown(content, { key: "u" });
  expect(view.state.doc.toString()).toBe(DOC);
});

it("a select-all and delete in Read empties the note", () => {
  localStorage.setItem("kasten.vim", "off");
  const { container } = render(<Editor initialDoc={DOC} path={PATH} commands={stubCommands()} />);
  const view = viewIn(container);
  act(() => view.dispatch({ selection: { anchor: 0, head: DOC.length } }));

  fireEvent.keyDown(container.querySelector(".cm-content") as HTMLElement, { key: "Backspace" });
  expect(view.state.doc.toString()).toBe("");
});

it("a write with no user event still reaches the hidden frontmatter", () => {
  localStorage.setItem("kasten.vim", "off");
  const { container } = render(<Editor initialDoc={DOC} path={PATH} commands={stubCommands()} />);
  const view = viewIn(container);
  act(() => view.dispatch({ selection: { anchor: DOC.indexOf("# Reader") } }));

  act(() => view.dispatch({ changes: { from: 0, insert: "x" } }));
  expect(view.state.doc.toString().startsWith("x---")).toBe(true);
});

it("undo of a frontmatter edit works from the body in Read", () => {
  localStorage.setItem("kasten.vim", "off");
  const { container } = render(<Editor initialDoc={DOC} path={PATH} commands={stubCommands()} />);
  const view = viewIn(container);
  // The edit is made with the cursor in the block, where the YAML shows.
  act(() => view.dispatch({ selection: { anchor: 0 } }));
  const at = DOC.indexOf("Concept") + "Concept".length;
  act(() => view.dispatch({ changes: { from: at, insert: " extra" }, userEvent: "input.type" }));
  // Then the cursor goes into the body, where the block hides again.
  act(() => view.dispatch({ selection: { anchor: DOC.indexOf("# Reader") } }));

  act(() => undo(view));
  expect(view.state.doc.toString()).toBe(DOC);
});

it("a log line written into an empty body in Read is kept", () => {
  localStorage.setItem("kasten.vim", "off");
  const note = "---\ntype: X\n---\n";
  const { container } = render(<Editor initialDoc={note} path={PATH} commands={stubCommands()} />);
  const view = viewIn(container);
  // The line break that closes the block: the closing fence ends at 15.
  const frontEnd = 15;

  act(() =>
    view.dispatch({ changes: { from: frontEnd, insert: "\nlog" }, userEvent: "input.log" }),
  );
  expect(view.state.doc.toString()).toContain("log");
});

it("dd on the only body line in Read deletes it", () => {
  localStorage.setItem("kasten.vim", "on");
  const note = "---\ntype: X\n---\nonly line";
  const { container } = render(<Editor initialDoc={note} path={PATH} commands={stubCommands()} />);
  const view = viewIn(container);
  expect(view.state.selection.main.head).toBe(note.indexOf("only line"));

  const content = container.querySelector(".cm-content") as HTMLElement;
  fireEvent.keyDown(content, { key: "d" });
  fireEvent.keyDown(content, { key: "d" });
  expect(view.state.doc.toString()).toBe("---\ntype: X\n---");
});

it("with vim on, a line selection from the top keeps the frontmatter shown", () => {
  localStorage.setItem("kasten.vim", "on");
  const { container } = render(<Editor initialDoc={DOC} path={PATH} commands={stubCommands()} />);
  const content = container.querySelector(".cm-content") as HTMLElement;
  // gg, V, then j down past the closing fence.
  fireEvent.keyDown(content, { key: "g" });
  fireEvent.keyDown(content, { key: "g" });
  fireEvent.keyDown(content, { key: "V" });
  for (let i = 0; i < 5; i += 1) fireEvent.keyDown(content, { key: "j" });

  expect(text(container, ".cm-content")).toContain("type: Concept");
});

it("#1453 the header reads a tag after a comment on an ordered line past 1 as the editor does", () => {
  const tagsIn = (body: string) => {
    const { container, unmount } = render(
      <Editor initialDoc={`${body}\n`} path={PATH} commands={stubCommands()} />,
    );
    const meta = part(container, "meta");
    unmount();
    return ["#real", "#hidden"].filter((tag) => meta.includes(tag));
  };

  expect({
    paragraph: tagsIn("text\n2. <!-- x --> #real"),
    list: tagsIn("1. a\n2. <!-- x --> #hidden"),
    item: tagsIn("- a\n  2. <!-- x --> #real"),
    alone: tagsIn("2. <!-- x --> #hidden"),
  }).toEqual({ paragraph: ["#real"], list: [], item: ["#real"], alone: [] });
});

describe("#1452 the header skips the tags inside a comment the editor parses as a block", () => {
  const tagsIn = (body: string, vim = false) => {
    if (vim) localStorage.setItem("kasten.vim", "on");
    const { container, unmount } = render(
      <Editor initialDoc={`${body}\n`} path={PATH} commands={stubCommands()} />,
    );
    const meta = part(container, "meta");
    unmount();
    return ["#p", "#q"].filter((tag) => meta.includes(tag));
  };

  it("#1452 a tag in a comment of several lines or one indented under an item is not in the header", () => {
    expect({
      block: tagsIn("<!--\n#p\n-->\n#q"),
      closing: tagsIn("<!--\nx\n--> #p\n\n#q"),
      indented: tagsIn("- a\n    <!-- x --> #p\n- #q"),
      loose: tagsIn("- a\n\n    <!-- x --> #p"),
      nested: tagsIn("- a\n    - <!-- x --> #p\n- #q"),
      tab: tagsIn("- a\n\t* <!-- x --> #p\n- #q"),
      mixed: tagsIn("- a\n    - 1. <!-- x --> #p\n- #q"),
      flipped: tagsIn("- a\n    1. - <!-- x --> #p\n- #q"),
      vim: tagsIn("<!--\n#p\n-->\n#q", true),
    }).toEqual({
      block: ["#q"],
      closing: ["#q"],
      indented: ["#q"],
      loose: [],
      nested: ["#q"],
      tab: ["#q"],
      mixed: ["#q"],
      flipped: ["#q"],
      vim: ["#q"],
    });
  });

  it("#1452 the shapes of #1454 and #1455 read as before", () => {
    expect({
      item: tagsIn("- <!-- x --> #p"),
      quote: tagsIn("> <!-- x --> #p"),
      ordered: tagsIn("1. <!-- x --> #p"),
      box: tagsIn("- [ ] <!-- x --> #p"),
      paragraph: tagsIn("text\n2. <!-- x --> #p"),
    }).toEqual({ item: [], quote: [], ordered: [], box: ["#p"], paragraph: ["#p"] });
  });

  it("#1452 opening and closing a comment above a tag hides and shows it on the next edit", () => {
    const { container } = render(
      <Editor initialDoc={"top\n\n#p\n"} path={PATH} commands={stubCommands()} />,
    );
    const view = viewIn(container);
    act(() => view.dispatch({ changes: { from: 0, insert: "<!--\n" } }));
    const opened = part(container, "meta").includes("#p");
    act(() => view.dispatch({ changes: { from: view.state.doc.line(2).to, insert: "\n-->" } }));
    expect([opened, part(container, "meta").includes("#p")]).toEqual([false, true]);
  });
});

describe("#1456 the header skips the tags inside an indented code block, as the editor does", () => {
  const tagsIn = (body: string, vim = false) => {
    if (vim) localStorage.setItem("kasten.vim", "on");
    const { container, unmount } = render(
      <Editor initialDoc={`${body}\n`} path={PATH} commands={stubCommands()} />,
    );
    const meta = part(container, "meta");
    unmount();
    return ["#h", "#k"].filter((tag) => meta.includes(tag));
  };

  it("#1456 a tag in indented code is not in the header, a continuation's tag is", () => {
    expect({
      code: tagsIn("text\n\n    #h"),
      frontmatter: tagsIn(`${DOC}text\n\n    #h\n\n#k`),
      tab: tagsIn("text\n\n\t#h"),
      later: tagsIn("#k\n\n    code\n    #h\n\nafter #k"),
      lazy: tagsIn("text\n    #h"),
      item: tagsIn("- a\n    #h"),
      loose: tagsIn("- a\n\n    #h"),
      nested: tagsIn("- a\n\n      #h\n- #k"),
      comment: tagsIn("text\n\n    <!-- x --> #h"),
      vim: tagsIn("text\n\n    #h\n\n#k", true),
    }).toEqual({
      code: [],
      frontmatter: ["#k"],
      tab: [],
      later: ["#k"],
      lazy: ["#h"],
      item: ["#h"],
      loose: ["#h"],
      nested: ["#k"],
      comment: [],
      vim: ["#k"],
    });
  });

  it("#1456 indenting a line into code hides its tag on that edit, and outdenting shows it", () => {
    const { container } = render(
      <Editor initialDoc={"text\n\n#h\n"} path={PATH} commands={stubCommands()} />,
    );
    const view = viewIn(container);
    const at = view.state.doc.line(3).from;
    act(() => view.dispatch({ changes: { from: at, insert: "    " } }));
    const indented = part(container, "meta").includes("#h");
    act(() => view.dispatch({ changes: { from: at, to: at + 4 } }));
    expect([indented, part(container, "meta").includes("#h")]).toEqual([false, true]);
  });
});

describe("#1459 the header skips a tag in code that opens after a quote or list marker", () => {
  // The rows `test_tag_rule.py` runs through `GET /api/tags`, so both read the same strings.
  // The `html-` rows are #656's HTML blocks, which the header skips the same way.
  const rows = cases.filter((one) => /^(?:container-code|html|empty-comment)-/.test(one.id));
  const shown = (body: string, vim: boolean) => {
    if (vim) localStorage.setItem("kasten.vim", "on");
    const { container, unmount } = render(
      <Editor initialDoc={`${body}\n`} path={PATH} commands={stubCommands()} />,
    );
    const meta = part(container, "meta");
    unmount();
    return ["#hidden", "#box", "#real"].filter((tag) => meta.includes(tag));
  };

  it.each([false, true])(
    "#1459 the header reads the table's rows as the backend does, vim %s",
    (vim) => {
      const read = (of: (one: (typeof rows)[number]) => string[]) =>
        Object.fromEntries(rows.map((one) => [one.id, of(one)]));
      expect(read((one) => shown(one.text, vim))).toEqual(read((one) => one.tags));
    },
  );

  it.each([
    ["#1459 indenting a quoted line into code", "> a\n>\n> #h\n", "    "],
    ["#656 typing <div> before a tag", "text\n\n#h\n", "<div> "],
  ])("%s hides its tag on that edit, and taking it off shows it", (_, doc, typed) => {
    const { container } = render(<Editor initialDoc={doc} path={PATH} commands={stubCommands()} />);
    const view = viewIn(container);
    const at = view.state.doc.line(3).from + (doc.startsWith(">") ? 2 : 0);
    act(() => view.dispatch({ changes: { from: at, insert: typed } }));
    const hidden = part(container, "meta").includes("#h");
    act(() => view.dispatch({ changes: { from: at, to: at + typed.length } }));
    expect([hidden, part(container, "meta").includes("#h")]).toEqual([false, true]);
  });
});
