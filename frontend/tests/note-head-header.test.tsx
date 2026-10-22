import { EditorView } from "@codemirror/view";
import { act, fireEvent, render } from "@testing-library/react";
import { Editor } from "@/components/editor";
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
