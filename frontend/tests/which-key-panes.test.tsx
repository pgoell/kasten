import { EditorView } from "@codemirror/view";
import { getCM } from "@replit/codemirror-vim";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, waitFor } from "@testing-library/react";
import { ChatPane } from "@/components/chat-pane";
import { ExamPane } from "@/components/exam-pane";
import { GraphPane } from "@/components/graph-pane";
import { HistoryPane } from "@/components/history-pane";
import { HtmlPane } from "@/components/html-pane";
import { ImagePane } from "@/components/image-pane";
import { PdfPane } from "@/components/pdf-pane";
import { PersonPane } from "@/components/person-pane";
import { VideoPane } from "@/components/video-pane";
import { hostLeader, type LeaderOpener } from "@/lib/which-key";
import { draw } from "./book-pane-fixture";
import { press, renderTree } from "./file-explorer-fixture";
import { defineFoliateFake } from "./foliate-fake";
import { open, stubCommands, TODAY } from "./keybindings-fixture";
import { renderPane as renderLog } from "./log-pane-fixture";
import { renderPane as renderReview } from "./review-pane-fixture";
import { renderPane as renderTodo } from "./todo-pane-fixture";

// The same doubles the panes' own test files stand in for: what each pane asks
// the vault for, not `fetch`. Spread over the real module so nothing else in
// this file loses an export.
const doubles = vi.hoisted(() => ({
  fetchNote: vi.fn(),
  fetchTodos: vi.fn(),
  fetchFiles: vi.fn(),
  createNote: vi.fn(),
}));
vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  ...doubles,
}));

const graph = vi.hoisted(() => ({ fetchGraph: vi.fn() }));
vi.mock("@/lib/graph/graph-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/graph/graph-api")>()),
  ...graph,
}));

const history = vi.hoisted(() => ({ fetchHistory: vi.fn(), fetchHistoryText: vi.fn() }));
vi.mock("@/lib/history-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/history-api")>()),
  ...history,
}));

// jsdom draws no canvas, and the graph's drawing is not what these tests are about.
vi.mock("@/lib/graph/graph-canvas", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/graph/graph-canvas")>()),
  drawGraph: () => ({
    update: vi.fn(),
    resize: vi.fn(),
    fit: vi.fn(),
    cluster: vi.fn(),
    destroy: vi.fn(),
  }),
}));

vi.mock("@/lib/book/pdf-view", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/book/pdf-view")>()),
  showPdf: vi.fn(),
}));

// The book's reader is a custom element that jsdom does not have, so the fake
// stands in for it, the way the book pane's own key tests do.
vi.mock("foliate-js/view.js", () => ({}));
defineFoliateFake();

const EXAM = "# Drills\n\n### Q1\n\nWhich cast?\n\n- A. one\n- B. two\n\nCorrect: B\n";

/** A stand-in for the runner's stream, which the chat pane opens and never reads here. */
class SilentSource {
  static CLOSED = 2;
  readyState = 1;
  onopen = null;
  onmessage = null;
  onerror = null;
  close() {}
}

/** The opener the panel was handed last, which is what a Space press hands over. */
function openerOf(spy: ReturnType<typeof vi.fn>): LeaderOpener {
  return spy.mock.lastCall?.[0] as LeaderOpener;
}

/** Runs what the typed keys name, and fails the test when they name nothing. */
function runFrom(opener: LeaderOpener, typed: string) {
  const action = opener.resolve(typed);
  if (action === null) throw new Error(`${typed} names nothing`);
  action();
}

describe("the which-key panel", () => {
  it("Space in normal mode hands the leader to the panel", () => {
    const commands = stubCommands();
    const spy = vi.fn();
    const off = hostLeader(spy);
    const { editor } = open("plain", commands);

    fireEvent.keyDown(editor, { key: " " });

    expect(spy).toHaveBeenCalledTimes(1);
    runFrom(openerOf(spy), "ff");
    expect(commands.findNote).toHaveBeenCalledTimes(1);
    off();
  });

  it("Space x from the panel cycles the todo on the cursor line", () => {
    const spy = vi.fn();
    const off = hostLeader(spy);
    const { editor, doc } = open("- [/] wire up the pane 🆔 kt-3f9a2c", undefined, "kasten.md");

    fireEvent.keyDown(editor, { key: " " });
    runFrom(openerOf(spy), "x");

    expect(doc()).toBe(`- [x] wire up the pane ✅ ${TODAY} 🆔 kt-3f9a2c`);
    off();
  });

  it("f then Space finds a space", () => {
    const spy = vi.fn();
    const off = hostLeader(spy);
    const { editor, doc } = open("a b");

    fireEvent.keyDown(editor, { key: "f" });
    fireEvent.keyDown(editor, { key: " " });
    // The cursor is on the space now, so vim's `x` cuts it.
    fireEvent.keyDown(editor, { key: "x" });

    expect(spy).not.toHaveBeenCalled();
    expect(doc()).toBe("ab");
    off();
  });

  it("r then Space replaces with a space", () => {
    const spy = vi.fn();
    const off = hostLeader(spy);
    const { editor, doc } = open("xy");

    fireEvent.keyDown(editor, { key: "r" });
    fireEvent.keyDown(editor, { key: " " });

    expect(spy).not.toHaveBeenCalled();
    expect(doc()).toBe(" y");
    off();
  });

  it("d then Space deletes nothing", () => {
    const spy = vi.fn();
    const off = hostLeader(spy);
    const { editor, doc } = open("xy");

    // The built-in Space motion is unmapped in every mode but visual, so `d`
    // followed by Space cancels the delete and deletes nothing, as before.
    fireEvent.keyDown(editor, { key: "d" });
    fireEvent.keyDown(editor, { key: " " });

    expect(spy).not.toHaveBeenCalled();
    expect(doc()).toBe("xy");
    // Vim is back at normal mode, so a plain `x` still cuts.
    fireEvent.keyDown(editor, { key: "x" });
    expect(doc()).toBe("y");
    off();
  });

  it("3 then Space keeps the count", () => {
    const commands = stubCommands();
    const spy = vi.fn();
    const off = hostLeader(spy);
    const { editor } = open("plain", commands);

    // A count makes vim keep the space as the start of its own `<Space>`
    // sequence, so the count goes to the leader's `o` and no panel opens.
    fireEvent.keyDown(editor, { key: "3" });
    fireEvent.keyDown(editor, { key: " " });
    fireEvent.keyDown(editor, { key: "o" });

    expect(spy).not.toHaveBeenCalled();
    expect(commands.nextPane).toHaveBeenCalledTimes(1);
    off();
  });

  it("Space in visual mode moves right", () => {
    const spy = vi.fn();
    const off = hostLeader(spy);
    const { editor, doc } = open("abc");

    fireEvent.keyDown(editor, { key: "v" });
    fireEvent.keyDown(editor, { key: " " });
    fireEvent.keyDown(editor, { key: "d" });

    expect(spy).not.toHaveBeenCalled();
    // The selection grew from `a` to `b`, so the delete takes both.
    expect(doc()).toBe("c");
    off();
  });

  it("Space in insert mode types a space", () => {
    const spy = vi.fn();
    const off = hostLeader(spy);
    const { container, editor } = open("ab");
    const view = EditorView.findFromDOM(container.querySelector(".cm-editor") as HTMLElement);
    if (view === null) throw new Error("no view");

    fireEvent.keyDown(editor, { key: "i" });
    const handled = fireEvent.keyDown(editor, { key: " " });

    expect(spy).not.toHaveBeenCalled();
    // Not prevented, so the browser types the space as it does in any field.
    expect(handled).toBe(true);
    expect(getCM(view)?.state.vim?.insertMode).toBe(true);
    off();
  });

  it("Space in the tree hands the leader with the tree's own create", () => {
    const onCreateNote = vi.fn();
    const spy = vi.fn();
    const off = hostLeader(spy);
    renderTree({ onCreateNote });

    press(" ");

    expect(spy).toHaveBeenCalledTimes(1);
    // Seeded with the cursor's folder, as the tree's own leader seeds it.
    runFrom(openerOf(spy), "cf");
    expect(onCreateNote).toHaveBeenCalledWith("daily/");
    off();
  });

  it("Space in the pdf pane hands the leader to the panel", () => {
    const spy = vi.fn();
    const off = hostLeader(spy);
    const { container } = render(
      <PdfPane path="plan.pdf" opened={1} commands={stubCommands()} onNoteBeside={() => {}} />,
    );

    fireEvent.keyDown(container.querySelector("[data-pdf-pane]") as HTMLElement, { key: " " });

    expect(spy).toHaveBeenCalledTimes(1);
    off();
  });

  it("Space in the book hands the leader to the panel", () => {
    const spy = vi.fn();
    const off = hostLeader(spy);
    const view = draw();

    fireEvent.keyDown(view.wrapper() as HTMLElement, { key: " " });

    expect(spy).toHaveBeenCalledTimes(1);
    off();
  });

  it("Space in the todo pane hands the leader to the panel", () => {
    const spy = vi.fn();
    const off = hostLeader(spy);
    const { press: pressKey } = renderTodo();

    pressKey(" ");

    expect(spy).toHaveBeenCalledTimes(1);
    off();
  });

  it("Space in the graph pane hands the leader to the panel, and Space on a button still presses it", () => {
    const spy = vi.fn();
    const off = hostLeader(spy);
    graph.fetchGraph.mockResolvedValue({
      nodes: [],
      edges: [],
      columns: [],
      rows: [],
      truncated: false,
    });
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        disconnect() {}
      },
    );
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { container } = render(
      <QueryClientProvider client={client}>
        <GraphPane commands={stubCommands()} onOpen={vi.fn()} onFollow={vi.fn()} />
      </QueryClientProvider>,
    );
    const pane = container.querySelector("[data-graph-pane]") as HTMLElement;
    const button = pane.querySelector("button");
    if (button === null) throw new Error("no button in the graph pane");

    fireEvent.keyDown(pane, { key: " " });
    expect(spy).toHaveBeenCalledTimes(1);

    // The button's own Space is the browser's press, so the panel is not handed it.
    expect(fireEvent.keyDown(button, { key: " " })).toBe(true);
    expect(spy).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
    off();
  });

  it("? in the book opens key help", () => {
    const view = draw();

    // `?` is shift and `/`, so the reader's modifier check would drop it.
    fireEvent.keyDown(view.wrapper() as HTMLElement, { key: "?", shiftKey: true });

    expect(view.commands.showHelp).toHaveBeenCalledTimes(1);
  });

  it("after the panel closes in the book, the focus is back on the reader", () => {
    const spy = vi.fn();
    const off = hostLeader(spy);
    const view = draw();
    const wrapper = view.wrapper() as HTMLElement;

    fireEvent.keyDown(wrapper, { key: " " });

    // The reader's own wrapper, not the foliate host the focus was on, which
    // takes no focus and would strand the keys on the body after Esc.
    const opener = openerOf(spy);
    expect(opener.from).toBe(wrapper);
    expect(wrapper.tabIndex).toBe(-1);
    (opener.from as HTMLElement).focus();
    expect(document.activeElement).toBe(wrapper);
    off();
  });

  it("Space in the html pane hands the leader to the panel", () => {
    const spy = vi.fn();
    const off = hostLeader(spy);
    const { container } = render(
      <HtmlPane path="report.html" commands={stubCommands()} onFocus={vi.fn()} />,
    );

    fireEvent.keyDown(container.querySelector("[data-html-pane]") as HTMLElement, { key: " " });

    expect(spy).toHaveBeenCalledTimes(1);
    off();
  });

  it("Space in the image pane hands the leader to the panel", () => {
    const spy = vi.fn();
    const off = hostLeader(spy);
    const { container } = render(
      <ImagePane path="shot.png" commands={stubCommands()} onDelete={vi.fn()} />,
    );

    fireEvent.keyDown(container.querySelector("[data-image-pane]") as HTMLElement, { key: " " });

    expect(spy).toHaveBeenCalledTimes(1);
    off();
  });

  it("Space in the person pane hands the leader to the panel", () => {
    const spy = vi.fn();
    const off = hostLeader(spy);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { container } = render(
      <QueryClientProvider client={client}>
        <PersonPane person="people/ada.md" commands={stubCommands()} onOpen={vi.fn()} />
      </QueryClientProvider>,
    );

    fireEvent.keyDown(container.querySelector("[data-person-pane]") as HTMLElement, { key: " " });

    expect(spy).toHaveBeenCalledTimes(1);
    off();
  });

  it("Space in the review pane hands the leader to the panel", async () => {
    const spy = vi.fn();
    const off = hostLeader(spy);
    // The overview, where no card is showing, so Space is the leader and not a reveal.
    const panel = await renderReview(stubCommands());

    fireEvent.keyDown(panel, { key: " " });

    expect(spy).toHaveBeenCalledTimes(1);
    off();
  });

  it("Space in the log pane hands the leader to the panel", () => {
    const spy = vi.fn();
    const off = hostLeader(spy);
    const view = renderLog();

    fireEvent.keyDown(view.container.querySelector(".log-pane") as HTMLElement, { key: " " });

    expect(spy).toHaveBeenCalledTimes(1);
    off();
  });

  it("Space in the exam pane hands the leader to the panel", async () => {
    const spy = vi.fn();
    const off = hostLeader(spy);
    doubles.fetchNote.mockResolvedValue(EXAM);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <ExamPane note="drills/terraform.md" commands={stubCommands()} onOpen={vi.fn()} />
      </QueryClientProvider>,
    );
    const pane = await waitFor(() => {
      const found = document.querySelector("[data-exam-pane]");
      if (found === null) throw new Error("no exam pane");
      return found as HTMLElement;
    });

    fireEvent.keyDown(pane, { key: " " });

    expect(spy).toHaveBeenCalledTimes(1);
    off();
  });

  it("Space in the video pane hands the leader to the panel", async () => {
    const spy = vi.fn();
    const off = hostLeader(spy);
    doubles.fetchNote.mockResolvedValue("# The talk\n\nNotes below.\n");
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { container } = render(
      <QueryClientProvider client={client}>
        <VideoPane
          note="lit/talk.md"
          commands={stubCommands()}
          focusSignal={0}
          playSignal={0}
          archive={false}
          onTake={async () => null}
          onWatched={vi.fn()}
        />
      </QueryClientProvider>,
    );
    const pane = container.querySelector("[data-video-pane]") as HTMLElement;

    fireEvent.keyDown(pane, { key: " " });

    expect(spy).toHaveBeenCalledTimes(1);
    off();
  });

  it("Space in the chat pane hands the leader to the panel", () => {
    const spy = vi.fn();
    const off = hostLeader(spy);
    vi.stubGlobal("EventSource", SilentSource);
    const { container } = render(<ChatPane commands={stubCommands()} focusSignal={0} />);

    fireEvent.keyDown(container.firstElementChild as HTMLElement, { key: " " });

    expect(spy).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
    off();
  });

  it("Space in the history pane hands the leader to the panel", () => {
    const spy = vi.fn();
    const off = hostLeader(spy);
    history.fetchHistory.mockResolvedValue({ changes: [] });
    doubles.fetchNote.mockResolvedValue("# Note\n");
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { container } = render(
      <QueryClientProvider client={client}>
        <HistoryPane
          note="notes/a.md"
          commands={stubCommands()}
          focusSignal={0}
          onRestore={vi.fn()}
        />
      </QueryClientProvider>,
    );

    fireEvent.keyDown(container.querySelector("[data-history-pane]") as HTMLElement, { key: " " });

    expect(spy).toHaveBeenCalledTimes(1);
    off();
  });

  it("Space in vim's / prompt types a space and opens no panel", () => {
    const spy = vi.fn();
    const off = hostLeader(spy);
    const { container, editor } = open("plain");

    // `/` opens vim's own prompt, a panel inside the editor with its own input.
    fireEvent.keyDown(editor, { key: "/" });
    const input = container.querySelector(".cm-vim-panel input") as HTMLInputElement;
    input.value = "foo";
    fireEvent.keyDown(input, { key: " " });
    // The browser types the space into the input, as it would in any field.
    input.value = "foo bar";

    expect(spy).not.toHaveBeenCalled();
    expect(input.value).toBe("foo bar");
    off();
  });

  it("Ctrl Space opens nothing", () => {
    const spy = vi.fn();
    const off = hostLeader(spy);
    const { editor } = open("plain");

    fireEvent.keyDown(editor, { key: " ", ctrlKey: true });

    expect(spy).not.toHaveBeenCalled();
    off();
  });
});
