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
 */
function fakeQuery(script) {
  const seen = { calls: [], interrupted: 0, closed: 0 };

  function query({ prompt, options }) {
    seen.calls.push(options);
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

function fold(seen, frame) {
  const event = JSON.parse(frame.slice("data: ".length));
  // The log rides in the `reset`. Unfolded here, so a test reads a run
  // as one list whether it connected before the run or after it.
  if (event.type === "reset") seen.splice(0, seen.length, { type: "reset" }, ...event.log);
  else seen.push(event);
}

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
      for (const frame of frames) fold(seen, frame);
    }
    await reader.cancel();
    return seen;
  }

  const ended = (seen) => seen.some((event) => event.type === "done" || event.type === "error");
  const has = (type) => (seen) => seen.some((event) => event.type === type);

  return { ...fake, host, post, events, ended, has };
}

const assistant = (content) => ({
  type: "assistant",
  parent_tool_use_id: null,
  message: { content },
});
const result = { type: "result", subtype: "success", is_error: false, result: "ok" };

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

test("a user message whose content is plain text adds nothing to the log", async () => {
  const chat = await serve(async function* () {
    yield { type: "user", parent_tool_use_id: null, message: { content: "echoed" } };
    yield result;
  });
  await chat.post("/chat/send", { text: "hi" });
  const seen = await chat.events(chat.ended);

  assert.deepEqual(seen, [{ type: "reset" }, { type: "user", text: "hi" }, { type: "done" }]);
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
