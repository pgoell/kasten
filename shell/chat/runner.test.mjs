import assert from "node:assert/strict";
import { createServer } from "node:http";
import { afterEach, test } from "node:test";
import { createChat } from "./runner.mjs";

const QUESTIONS = [
  {
    question: "Which day?",
    header: "Day",
    options: [
      { label: "Today", description: "The day that is ending" },
      { label: "Yesterday", description: "The day before" },
    ],
    multiSelect: false,
  },
];

/**
 * A stand-in for the SDK's `query`, driven by a script.
 *
 * The script is called once per user turn with the text and the options the
 * runner passed, and yields the SDK messages that turn produces. It records
 * what the runner did to it, which is what the tests assert on.
 *
 * A string prompt is a proposal: the script is called once with the prompt and
 * its messages are the whole answer.
 */
function fakeQuery(script) {
  const seen = { calls: [], prompts: [], interrupted: 0, closed: 0 };

  function query({ prompt, options }) {
    seen.calls.push(options);
    if (typeof prompt === "string") {
      seen.prompts.push(prompt);
      return script(prompt, options);
    }
    let stop;
    const stopped = new Promise((resolve) => {
      stop = resolve;
    });

    async function* run() {
      const turns = prompt[Symbol.asyncIterator]();
      for (;;) {
        const next = await Promise.race([turns.next(), stopped]);
        if (next === undefined || next.done) return;
        yield* script(next.value.message.content, options);
      }
    }

    const stream = run();
    return {
      [Symbol.asyncIterator]: () => stream,
      interrupt: async () => {
        seen.interrupted += 1;
        if (seen.failInterrupt) throw new Error("ProcessTransport is not ready for writing");
      },
      close: () => {
        seen.closed += 1;
        stop();
      },
    };
  }

  return { query, seen };
}

let server;

afterEach(() => {
  server?.closeAllConnections();
  server?.close();
  server = undefined;
});

async function serve(script) {
  const fake = fakeQuery(script);
  const chat = createChat({ query: fake.query, claudePath: "/bin/claude", cwd: "/vault" });
  server = createServer(chat.handle);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const host = `127.0.0.1:${server.address().port}`;

  function post(path, body, headers = {}) {
    return fetch(`http://${host}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: `http://${host}`, ...headers },
      body: JSON.stringify(body),
    });
  }

  /** Read the stream until `until` says the events so far are enough. */
  async function events(until) {
    const response = await fetch(`http://${host}/chat/events`);
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    const seen = [];
    let buffer = "";
    for (;;) {
      if (until(seen)) break;
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const frames = buffer.split("\n\n");
      buffer = frames.pop();
      for (const frame of frames) {
        const event = JSON.parse(frame.slice("data: ".length));
        // The log rides in the `reset`. Unfolded here, so a test reads a run
        // as one list whether it connected before the run or after it.
        if (event.type === "reset") seen.splice(0, seen.length, { type: "reset" }, ...event.log);
        else seen.push(event);
      }
    }
    await reader.cancel();
    return seen;
  }

  const ended = (seen) => seen.some((event) => event.type === "done" || event.type === "error");
  const has = (type) => (seen) => seen.some((event) => event.type === type);

  return { ...fake, host, post, events, ended, has };
}

/** Poll until `done` holds, for at most two seconds. */
async function waitFor(done) {
  for (let i = 0; i < 200 && !done(); i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.ok(done(), "timed out waiting");
}

const assistant = (content) => ({
  type: "assistant",
  parent_tool_use_id: null,
  message: { content },
});
const result = { type: "result", subtype: "success", is_error: false, result: "ok" };

const FOLDERS = [
  { path: "01 Projects", examples: ["Garden redesign", "Tax return"] },
  { path: "03 Areas", examples: ["Health", "Finances"] },
];
const PROPOSAL = {
  path: "00 Inbox/Foo.md",
  content: "Ask the bank about the fee.",
  ontology: "",
  folders: FOLDERS,
};
const picked = (structured_output) => ({
  type: "result",
  subtype: "success",
  is_error: false,
  result: "",
  structured_output,
});

test("a turn becomes a log of user, text, tool, tool result and done", async () => {
  const chat = await serve(async function* () {
    yield {
      type: "stream_event",
      parent_tool_use_id: null,
      event: { type: "content_block_delta", delta: { type: "text_delta", text: "Rea" } },
    };
    yield assistant([{ type: "text", text: "Reading." }]);
    yield assistant([{ type: "tool_use", id: "t1", name: "Read", input: { file_path: "a.md" } }]);
    // A subagent's own traffic, which the pane shows as the one Agent call.
    yield { ...assistant([{ type: "text", text: "inner" }]), parent_tool_use_id: "t9" };
    yield {
      type: "user",
      parent_tool_use_id: null,
      message: {
        content: [{ type: "tool_result", tool_use_id: "t1", content: "hello", is_error: false }],
      },
    };
    yield result;
  });

  assert.equal((await chat.post("/chat/send", { text: "/close-day" })).status, 204);

  assert.deepEqual(await chat.events(chat.ended), [
    { type: "reset" },
    { type: "user", text: "/close-day" },
    { type: "text", text: "Reading." },
    { type: "tool", id: "t1", name: "Read", input: { file_path: "a.md" } },
    { type: "tool_result", id: "t1", text: "hello", error: false },
    { type: "done" },
  ]);
});

test("the session runs in the vault, unprompted, on the installed claude", async () => {
  const chat = await serve(async function* () {
    yield result;
  });
  await chat.post("/chat/send", { text: "hi" });
  await chat.events(chat.ended);

  const [options] = chat.seen.calls;
  assert.equal(options.cwd, "/vault");
  assert.equal(options.permissionMode, "bypassPermissions");
  assert.equal(options.allowDangerouslySkipPermissions, true);
  assert.equal(options.pathToClaudeCodeExecutable, "/bin/claude");
  assert.equal(options.includePartialMessages, true);
  // Never: `env` replaces the child's environment, PATH and the login with it.
  assert.equal("env" in options, false);
});

test("a second turn goes to the same session", async () => {
  const chat = await serve(async function* (text) {
    yield assistant([{ type: "text", text: `re: ${text}` }]);
    yield result;
  });
  await chat.post("/chat/send", { text: "one" });
  await chat.events(chat.ended);
  await chat.post("/chat/send", { text: "two" });
  const seen = await chat.events((all) => all.filter((e) => e.type === "done").length === 2);

  assert.equal(chat.seen.calls.length, 1);
  assert.deepEqual(
    seen.filter((event) => event.type === "text").map((event) => event.text),
    ["re: one", "re: two"],
  );
});

test("a question waits for its answer and hands it to the tool", async () => {
  let decision;
  const chat = await serve(async function* (_text, options) {
    decision = await options.canUseTool(
      "AskUserQuestion",
      { questions: QUESTIONS },
      { signal: new AbortController().signal },
    );
    yield result;
  });

  await chat.post("/chat/send", { text: "/close-day" });
  const asked = (await chat.events(chat.has("ask"))).at(-1);
  assert.deepEqual(asked, { type: "ask", id: asked.id, questions: QUESTIONS });

  const answers = { "Which day?": "Today" };
  assert.equal((await chat.post("/chat/answer", { id: asked.id, answers })).status, 204);
  const seen = await chat.events(chat.ended);

  assert.deepEqual(decision, {
    behavior: "allow",
    updatedInput: { questions: QUESTIONS, answers },
  });
  assert.deepEqual(seen.at(-2), { type: "answered", id: asked.id, answers });
  // Spent: a second answer has nothing to go to.
  assert.equal((await chat.post("/chat/answer", { id: asked.id, answers })).status, 409);
});

test("any other tool that reaches the callback is refused", async () => {
  let decision;
  const chat = await serve(async function* (_text, options) {
    decision = await options.canUseTool("Bash", { command: "rm -rf /" }, {});
    yield result;
  });
  await chat.post("/chat/send", { text: "go" });
  await chat.events(chat.ended);

  assert.equal(decision.behavior, "deny");
});

test("stop interrupts the run and refuses the open question", async () => {
  let decision;
  const chat = await serve(async function* (_text, options) {
    decision = await options.canUseTool("AskUserQuestion", { questions: QUESTIONS }, {});
    yield { type: "result", subtype: "error_during_execution", is_error: true };
  });
  await chat.post("/chat/send", { text: "go" });
  const asked = (await chat.events(chat.has("ask"))).at(-1);

  assert.equal((await chat.post("/chat/stop", {})).status, 204);
  const seen = await chat.events(chat.ended);

  assert.equal(chat.seen.interrupted, 1);
  assert.equal(decision.behavior, "deny");
  assert.deepEqual(seen.slice(-2), [
    { type: "answered", id: asked.id },
    { type: "done", error: "error_during_execution" },
  ]);
});

test("a stop the SDK refuses is an error answer, not the end of the runner", async () => {
  const chat = await serve(async function* (_text, options) {
    await options.canUseTool("AskUserQuestion", { questions: QUESTIONS }, {});
    yield result;
  });
  chat.seen.failInterrupt = true;
  await chat.post("/chat/send", { text: "go" });
  await chat.events(chat.has("ask"));

  assert.equal((await chat.post("/chat/stop", {})).status, 500);
  // Still serving, and the stream says the question was let go.
  assert.equal((await chat.events(chat.ended)).at(-1).type, "done");
});

test("new ends the session and empties the log", async () => {
  const chat = await serve(async function* () {
    yield assistant([{ type: "text", text: "old" }]);
    yield result;
  });
  await chat.post("/chat/send", { text: "one" });
  await chat.events(chat.ended);

  assert.equal((await chat.post("/chat/new", {})).status, 204);
  assert.equal(chat.seen.closed, 1);

  await chat.post("/chat/send", { text: "two" });
  const seen = await chat.events(chat.ended);
  assert.equal(chat.seen.calls.length, 2);
  assert.deepEqual(seen.slice(0, 2), [{ type: "reset" }, { type: "user", text: "two" }]);
});

test("a session that fails says so, and the next message starts another", async () => {
  let first = true;
  const chat = await serve(async function* () {
    if (first) {
      first = false;
      throw new Error("Claude Code process exited with code 1");
    }
    yield result;
  });
  await chat.post("/chat/send", { text: "one" });
  const seen = await chat.events(chat.ended);
  assert.deepEqual(seen.at(-1), { type: "error", text: "Claude Code process exited with code 1" });

  await chat.post("/chat/send", { text: "two" });
  await chat.events((all) => all.at(-1)?.type === "done");
  assert.equal(chat.seen.calls.length, 2);
});

test("a session that ends on its own says so and lets its question go", async () => {
  const chat = await serve(async function* (_text, options) {
    yield assistant([{ type: "text", text: "One question." }]);
    // Not awaited: the process dies with the question still on screen.
    void options.canUseTool("AskUserQuestion", { questions: QUESTIONS }, {});
    throw new Error("Claude Code process exited with code 1");
  });
  await chat.post("/chat/send", { text: "go" });
  const seen = await chat.events((all) => all.some((event) => event.type === "answered"));

  assert.deepEqual(
    seen.slice(-3).map((event) => event.type),
    ["ask", "error", "answered"],
  );
});

test("a request that goes wrong does not take the runner down", async () => {
  const chat = await serve(async function* () {
    yield result;
  });

  // An address `URL` cannot read, which only something on the docker network
  // could send, and a body that is an array where an object was asked for.
  assert.equal((await fetch(`http://${chat.host}//`)).status, 500);
  assert.equal((await chat.post("/chat/new", [])).status, 400);
  assert.equal((await chat.post("/chat/send", { text: "hi" })).status, 204);
});

test("a post from another site is refused before it reaches the session", async () => {
  const chat = await serve(async function* () {
    yield result;
  });

  const foreign = await chat.post("/chat/send", { text: "x" }, { origin: "https://evil.example" });
  // A plain form post: no preflight, and the one content type a page can send
  // across sites without asking.
  const form = await chat.post("/chat/send", { text: "x" }, { "content-type": "text/plain" });
  const bare = await fetch(`http://${chat.host}/chat/send`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  });

  assert.deepEqual([foreign.status, form.status, bare.status], [403, 403, 403]);
  assert.equal(chat.seen.calls.length, 0);
});

test("a message with no text, and a path nobody serves, are refused", async () => {
  const chat = await serve(async function* () {
    yield result;
  });

  assert.equal((await chat.post("/chat/send", { text: "  " })).status, 400);
  assert.equal((await chat.post("/chat/send", "nope")).status, 400);
  assert.equal((await chat.post("/chat/elsewhere", {})).status, 404);
  assert.equal((await fetch(`http://${chat.host}/`)).status, 404);
});

test("a proposal answers with the folder the agent picked", async () => {
  const chat = await serve(async function* () {
    yield picked({ folder: "03 Areas", reason: "x" });
  });

  const response = await chat.post("/chat/propose", PROPOSAL);
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type"), /^application\/json/);
  assert.deepEqual(await response.json(), { folder: "03 Areas", reason: "x" });

  const [options] = chat.seen.calls;
  const [prompt] = chat.seen.prompts;
  assert.deepEqual(options.tools, []);
  assert.deepEqual(options.settingSources, []);
  assert.equal(options.strictMcpConfig, true);
  assert.equal(options.persistSession, false);
  assert.equal(options.model, "haiku");
  assert.equal(options.permissionMode, "dontAsk");
  assert.equal(options.allowDangerouslySkipPermissions, undefined);
  assert.equal(typeof options.systemPrompt, "string");
  assert.ok(options.abortController instanceof AbortController);
  assert.equal(options.abortController.signal.aborted, false);
  assert.deepEqual(options.outputFormat.schema.properties.folder.enum, ["01 Projects", "03 Areas"]);
  assert.ok(prompt.includes("00 Inbox/Foo.md"));
  assert.ok(prompt.includes("Garden redesign"));
});

test("a proposal whose agent fails answers 500, and the runner serves the next", async () => {
  let first = true;
  const chat = await serve(async function* () {
    if (first) {
      first = false;
      throw new Error("spawn failed");
    }
    yield picked({ folder: "03 Areas", reason: "x" });
  });

  assert.equal((await chat.post("/chat/propose", PROPOSAL)).status, 500);
  assert.equal((await chat.post("/chat/propose", PROPOSAL)).status, 200);
});

test("a folder with an empty path is a 400", async () => {
  const chat = await serve(async function* () {
    yield picked({ folder: "03 Areas", reason: "x" });
  });

  const folders = [{ path: "", examples: [] }];
  assert.equal((await chat.post("/chat/propose", { ...PROPOSAL, folders })).status, 400);
  assert.equal(chat.seen.calls.length, 0);
});

test("a proposal the page walks away from stops its agent", async () => {
  const chat = await serve(async function* (_prompt, options) {
    await new Promise((_resolve, reject) => {
      options.abortController.signal.addEventListener("abort", () => reject(new Error("aborted")));
    });
    yield result;
  });

  const walkAway = new AbortController();
  const sent = fetch(`http://${chat.host}/chat/propose`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: `http://${chat.host}` },
    body: JSON.stringify(PROPOSAL),
    signal: walkAway.signal,
  });
  const aborted = assert.rejects(sent, { name: "AbortError" });

  await waitFor(() => chat.seen.calls.length === 1);
  walkAway.abort();
  await aborted;
  await waitFor(() => chat.seen.calls[0]?.abortController.signal.aborted === true);
});

test("a proposal cuts a long note to 8000 characters", async () => {
  const chat = await serve(async function* () {
    yield picked({ folder: "01 Projects", reason: "x" });
  });

  await chat.post("/chat/propose", { ...PROPOSAL, content: "a".repeat(9000) });
  const [prompt] = chat.seen.prompts;
  assert.ok(prompt.includes("a".repeat(8000)));
  assert.ok(!prompt.includes("a".repeat(8001)));
});

test("an answer the page cannot use is a 502", async () => {
  const answers = [
    picked({ folder: "99 Elsewhere", reason: "x" }),
    {
      type: "result",
      subtype: "error_max_structured_output_retries",
      is_error: true,
      result: "no",
    },
    picked(undefined),
    picked({ folder: "03 Areas", reason: 7 }),
  ];
  const chat = await serve(async function* () {
    yield answers.shift();
  });

  for (let i = 0; i < 4; i += 1) {
    assert.equal((await chat.post("/chat/propose", PROPOSAL)).status, 502);
  }
});

test("a proposal with no answer at all is a 502", async () => {
  const chat = await serve(async function* () {});
  assert.equal((await chat.post("/chat/propose", PROPOSAL)).status, 502);
});

test("a proposal with a body that is not the shape asked for is a 400", async () => {
  const chat = await serve(async function* () {
    yield picked({ folder: "03 Areas", reason: "x" });
  });

  const bodies = [
    { ...PROPOSAL, folders: undefined },
    { ...PROPOSAL, folders: [] },
    { ...PROPOSAL, path: 3 },
    { ...PROPOSAL, folders: [{ path: "03 Areas", examples: [1] }] },
  ];
  for (const body of bodies) {
    assert.equal((await chat.post("/chat/propose", body)).status, 400);
  }
  assert.equal(chat.seen.calls.length, 0);
});

test("a proposal from another site is refused", async () => {
  const chat = await serve(async function* () {
    yield picked({ folder: "03 Areas", reason: "x" });
  });

  const foreign = await chat.post("/chat/propose", PROPOSAL, { origin: "https://evil.example" });
  assert.equal(foreign.status, 403);
  assert.equal(chat.seen.calls.length, 0);
});

test("a proposal leaves nothing in the chat and starts no session", async () => {
  const chat = await serve(async function* () {
    yield picked({ folder: "03 Areas", reason: "x" });
  });

  // Open before the proposal, so anything it sent to the chat would reach this reader.
  const watching = chat.events(chat.ended);
  assert.equal((await chat.post("/chat/propose", PROPOSAL)).status, 200);
  assert.equal(chat.seen.calls.length, 1);
  assert.equal((await chat.post("/chat/stop", {})).status, 204);
  assert.equal(chat.seen.interrupted, 0);

  // The first message after it ends the reader's wait, so the reader sees all of it.
  assert.equal((await chat.post("/chat/send", { text: "after" })).status, 204);
  assert.deepEqual(await watching, [
    { type: "reset" },
    { type: "user", text: "after" },
    { type: "done" },
  ]);
});
