import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { ChatPane } from "@/components/chat-pane";
import type { ChatEvent } from "@/lib/chat";
import { stubCommands } from "./stub-commands";

/** The runner's stream, which the test speaks through by hand. */
class FakeSource {
  static CLOSED = 2;
  static last: FakeSource | null = null;
  static made = 0;
  readyState = 1;
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((message: { data: string }) => void) | null = null;
  closed = false;
  url: string;
  constructor(url: string) {
    this.url = url;
    FakeSource.last = this;
    FakeSource.made += 1;
  }
  close() {
    this.closed = true;
  }
}

const posts: { path: string; body: unknown }[] = [];

beforeEach(() => {
  posts.length = 0;
  vi.stubGlobal("EventSource", FakeSource);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (path: string, init: RequestInit) => {
      posts.push({ path, body: JSON.parse(init.body as string) });
      return new Response(null, { status: 204 });
    }),
  );
});

afterEach(() => vi.unstubAllGlobals());

function say(...events: ChatEvent[]) {
  act(() => {
    FakeSource.last?.onopen?.();
    for (const event of events) FakeSource.last?.onmessage?.({ data: JSON.stringify(event) });
  });
}

function mount() {
  const commands = stubCommands();
  const view = render(<ChatPane commands={commands} focusSignal={1} />);
  return { commands, ...view };
}

const ASK: ChatEvent = {
  type: "ask",
  id: "ask1",
  questions: [
    {
      question: "Which day?",
      header: "Day",
      multiSelect: false,
      options: [
        { label: "Today", description: "The day that is ending" },
        { label: "Yesterday", description: "The day before" },
      ],
    },
    {
      question: "Which sections?",
      header: "Sections",
      multiSelect: true,
      options: [
        { label: "Focus", description: "" },
        { label: "Errands", description: "" },
      ],
    },
  ],
};

describe("ChatPane", () => {
  it("reads the runner's stream and closes it on the way out", () => {
    const { unmount } = mount();

    expect(FakeSource.last?.url).toBe("/chat/events");
    unmount();
    expect(FakeSource.last?.closed).toBe(true);
  });

  it("starts each skill from a button", async () => {
    mount();
    say({ type: "reset" });

    fireEvent.click(screen.getByRole("button", { name: "/close-day" }));
    fireEvent.click(screen.getByRole("button", { name: "/process-meeting" }));

    await vi.waitFor(() =>
      expect(posts).toEqual([
        { path: "/chat/send", body: { text: "/close-day" } },
        { path: "/chat/send", body: { text: "/process-meeting" } },
      ]),
    );
  });

  it("sends what was typed on Enter and keeps a line break on Shift+Enter", async () => {
    mount();
    say({ type: "reset" });
    const box = screen.getByRole("textbox", { name: "Message" });

    fireEvent.change(box, { target: { value: "hello" } });
    expect(fireEvent.keyDown(box, { key: "Enter", shiftKey: true })).toBe(true);
    expect(posts).toEqual([]);

    fireEvent.keyDown(box, { key: "Enter" });
    await vi.waitFor(() =>
      expect(posts).toEqual([{ path: "/chat/send", body: { text: "hello" } }]),
    );
    expect(box).toHaveValue("");
  });

  it("draws the run: the message, the text as it arrives, a folded tool call", () => {
    mount();
    say(
      { type: "reset" },
      { type: "user", text: "/close-day" },
      { type: "tool", id: "t1", name: "Bash", input: { command: "rg todo /vault" } },
      { type: "tool_result", id: "t1", text: "3 matches", error: false },
      { type: "delta", text: "Three todos are" },
    );
    const log = screen.getByRole("log");

    expect(within(log).getByText("/close-day")).toBeInTheDocument();
    expect(within(log).getByText("Three todos are")).toBeInTheDocument();

    const call = within(log).getByText("rg todo /vault").closest("details");
    expect(call).not.toHaveAttribute("open");
    expect(call).toHaveTextContent("3 matches");
    expect(screen.getByRole("button", { name: "Stop" })).toBeInTheDocument();
  });

  it("offers stop only during a run, and new always", async () => {
    mount();
    say({ type: "reset" }, { type: "user", text: "hi" });

    fireEvent.click(screen.getByRole("button", { name: "Stop" }));
    say({ type: "done", error: "Stopped." });

    expect(screen.queryByRole("button", { name: "Stop" })).toBeNull();
    expect(screen.getByText("Stopped.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "New session" }));
    await vi.waitFor(() =>
      expect(posts.map((post) => post.path)).toEqual(["/chat/stop", "/chat/new"]),
    );
  });

  it("asks a question as a form and sends back what was picked", async () => {
    mount();
    say({ type: "reset" }, { type: "user", text: "/close-day" }, ASK);
    const send = screen.getByRole("button", { name: "Answer" });

    // Nothing to send until every question has an answer.
    expect(send).toBeDisabled();
    fireEvent.click(screen.getByRole("radio", { name: /Today/ }));
    expect(send).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox", { name: /Focus/ }));
    fireEvent.change(screen.getByRole("textbox", { name: "Other answer to: Which sections?" }), {
      target: { value: "Reading" },
    });
    fireEvent.click(send);

    await vi.waitFor(() =>
      expect(posts).toEqual([
        {
          path: "/chat/answer",
          body: {
            id: "ask1",
            answers: { "Which day?": "Today", "Which sections?": "Focus, Reading" },
          },
        },
      ]),
    );
  });

  it("shows an answered question as what was asked and what was said", () => {
    mount();
    say({ type: "reset" }, ASK, {
      type: "answered",
      id: "ask1",
      answers: { "Which day?": "Today", "Which sections?": "Focus" },
    });

    expect(screen.queryByRole("button", { name: "Answer" })).toBeNull();
    expect(screen.getByText("Which day?")).toBeInTheDocument();
    expect(screen.getByText("Today")).toBeInTheDocument();
  });

  it("says when the runner cannot be reached", () => {
    mount();
    act(() => FakeSource.last?.onerror?.());

    expect(screen.getByRole("status")).toHaveTextContent("Could not reach the chat runner");
  });

  it("asks again when the proxy answered for a runner that was not there", () => {
    vi.useFakeTimers();
    mount();
    const made = FakeSource.made;
    const first = FakeSource.last;

    // A dropped stream: the browser reconnects, and a second one would be two.
    act(() => first?.onerror?.());
    act(() => vi.advanceTimersByTime(5000));
    expect(FakeSource.made).toBe(made);

    // A 502: the browser has given up.
    act(() => {
      if (first) first.readyState = FakeSource.CLOSED;
      first?.onerror?.();
    });
    act(() => vi.advanceTimersByTime(5000));
    expect(FakeSource.made).toBe(made + 1);
    vi.useRealTimers();
  });

  it("runs a leader key from the pane, and leaves a typed space alone", () => {
    const { commands } = mount();
    say({ type: "reset" });
    const pane = screen.getByRole("region", { name: "chat" });

    fireEvent.keyDown(pane, { key: " " });
    fireEvent.keyDown(pane, { key: "q" });
    expect(commands.closeNote).toHaveBeenCalledTimes(1);

    const box = screen.getByRole("textbox", { name: "Message" });
    fireEvent.keyDown(box, { key: " " });
    fireEvent.keyDown(box, { key: "q" });
    expect(commands.closeNote).toHaveBeenCalledTimes(1);
  });

  it("goes to the box on i, and back to the pane on Escape", () => {
    mount();
    say({ type: "reset" });
    const pane = screen.getByRole("region", { name: "chat" });
    const box = screen.getByRole("textbox", { name: "Message" });

    expect(pane).toHaveFocus();
    fireEvent.keyDown(pane, { key: "i" });
    expect(box).toHaveFocus();
    fireEvent.keyDown(box, { key: "Escape" });
    expect(pane).toHaveFocus();
  });
});
