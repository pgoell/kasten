import {
  answersFor,
  type ChatEvent,
  type ChatQuestion,
  EMPTY,
  postChat,
  proposeFolder,
  reduce,
  toolLine,
} from "@/lib/chat";

const QUESTIONS: ChatQuestion[] = [
  {
    question: "Which day?",
    header: "Day",
    multiSelect: false,
    options: [
      { label: "Today", description: "" },
      { label: "Yesterday", description: "" },
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
];

const play = (events: ChatEvent[]) => events.reduce(reduce, EMPTY);

describe("reduce", () => {
  it("builds a run out of its events", () => {
    const state = play([
      { type: "reset", log: [] },
      { type: "user", text: "/close-day" },
      { type: "delta", text: "Rea" },
      { type: "text", text: "Reading." },
      { type: "tool", id: "t1", name: "Read", input: { file_path: "a.md" } },
      { type: "tool_result", id: "t1", text: "hello", error: false },
      { type: "done" },
    ]);

    expect(state).toEqual({
      items: [
        { kind: "user", text: "/close-day" },
        { kind: "text", text: "Reading." },
        {
          kind: "tool",
          id: "t1",
          name: "Read",
          input: { file_path: "a.md" },
          result: { text: "hello", error: false },
        },
      ],
      streaming: "",
      running: 0,
    });
  });

  it("holds the text that is still arriving until the block lands", () => {
    const arriving = play([
      { type: "user", text: "hi" },
      { type: "delta", text: "Hel" },
      { type: "delta", text: "lo" },
    ]);
    expect(arriving.streaming).toBe("Hello");
    expect(arriving.running).toBe(1);

    expect(reduce(arriving, { type: "text", text: "Hello." }).streaming).toBe("");
  });

  it("forgets everything on a reset, which every connection begins with", () => {
    const state = play([
      { type: "user", text: "old" },
      { type: "reset", log: [] },
    ]);

    expect(state).toEqual(EMPTY);
  });

  it("closes a question with its answers, or with none when the run was stopped", () => {
    const asked = play([{ type: "ask", id: "ask1", questions: QUESTIONS }]);
    expect(asked.items[0]).toMatchObject({ kind: "ask", open: true });

    const answers = { "Which day?": "Today" };
    expect(reduce(asked, { type: "answered", id: "ask1", answers }).items[0]).toMatchObject({
      open: false,
      answers,
    });
    expect(reduce(asked, { type: "answered", id: "ask1" }).items[0]).toMatchObject({
      open: false,
      answers: undefined,
    });
  });

  it("takes the run so far out of a reset, in one step", () => {
    const state = play([
      { type: "user", text: "old" },
      {
        type: "reset",
        log: [
          { type: "user", text: "/close-day" },
          { type: "text", text: "Reading." },
        ],
      },
    ]);

    expect(state.items).toEqual([
      { kind: "user", text: "/close-day" },
      { kind: "text", text: "Reading." },
    ]);
    expect(state.running).toBe(1);
  });

  it("stays running while a message is queued behind the one that finished", () => {
    const state = play([
      { type: "user", text: "one" },
      { type: "user", text: "two" },
      { type: "done" },
    ]);

    expect(state.running).toBe(1);
  });

  it("shows why a turn failed, and stops running when the session ends", () => {
    const failed = play([
      { type: "user", text: "one" },
      { type: "done", error: "Not logged in" },
    ]);
    expect(failed.items.at(-1)).toEqual({ kind: "error", text: "Not logged in" });
    expect(failed.running).toBe(0);

    const ended = play([
      { type: "user", text: "one" },
      { type: "user", text: "two" },
      { type: "error", text: "exited" },
    ]);
    expect(ended.running).toBe(0);
  });
});

describe("toolLine", () => {
  it.each([
    [{ command: "rg todo", description: "Search" }, "rg todo"],
    [{ file_path: "/vault/a.md" }, "/vault/a.md"],
    [{ skill: "close-day" }, "close-day"],
    [{ limit: 3 }, ""],
    [null, ""],
  ])("reads %j as %j", (input, line) => {
    expect(toolLine(input)).toBe(line);
  });
});

describe("answersFor", () => {
  it("joins what was picked, keyed by the question", () => {
    const answers = answersFor(QUESTIONS, {
      "Which day?": { labels: ["Today"], other: "" },
      "Which sections?": { labels: ["Focus", "Errands"], other: " Reading " },
    });

    expect(answers).toEqual({
      "Which day?": "Today",
      "Which sections?": "Focus, Errands, Reading",
    });
  });

  it("takes typed text as the answer itself", () => {
    const answers = answersFor(QUESTIONS.slice(0, 1), {
      "Which day?": { labels: [], other: "last Friday" },
    });

    expect(answers).toEqual({ "Which day?": "last Friday" });
  });

  it("has nothing to send while a question is unanswered", () => {
    expect(answersFor(QUESTIONS, { "Which day?": { labels: ["Today"], other: "" } })).toBe(
      undefined,
    );
  });
});

describe("postChat", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("posts JSON, which is the one content type the runner takes", async () => {
    const fetched = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetched);

    expect(await postChat("send", { text: "/close-day" })).toBe(true);
    expect(fetched).toHaveBeenCalledWith("/chat/send", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: '{"text":"/close-day"}',
    });
  });

  it("counts no network as not taken", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      }),
    );

    expect(await postChat("stop")).toBe(false);
  });

  it("says when the runner refused", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 409 })),
    );

    expect(await postChat("answer", { id: "ask1", answers: {} })).toBe(false);
  });
});

describe("proposeFolder", () => {
  afterEach(() => vi.unstubAllGlobals());

  const input = {
    path: "00 Inbox/a.md",
    content: "# A",
    ontology: "",
    folders: [{ path: "reading", examples: ["Borges"] }],
  };

  it("posts JSON to the runner and returns its answer", async () => {
    const fetched = vi.fn(
      async () => new Response(JSON.stringify({ folder: "reading", reason: "A book." })),
    );
    vi.stubGlobal("fetch", fetched);

    expect(await proposeFolder(input)).toEqual({ folder: "reading", reason: "A book." });
    expect(fetched).toHaveBeenCalledWith("/chat/propose", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    });
  });

  it("passes the signal to fetch, so a dropped request reaches the runner", async () => {
    const fetched = vi.fn(
      async () => new Response(JSON.stringify({ folder: "reading", reason: "A book." })),
    );
    vi.stubGlobal("fetch", fetched);
    const controller = new AbortController();

    await proposeFolder(input, controller.signal);

    expect(fetched).toHaveBeenCalledWith(
      "/chat/propose",
      expect.objectContaining({ signal: controller.signal }),
    );
  });

  it("throws on an answer that is not ok", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 502 })),
    );

    await expect(proposeFolder(input)).rejects.toThrow("POST /chat/propose failed with 502");
  });
});
