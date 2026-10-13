/**
 * The chat runner: one Claude Agent SDK session in the vault, served over HTTP.
 *
 * The chat pane is a view of what this holds. Every SDK message is turned into
 * a small event, the events are kept in a log, and `GET /chat/events` sends the
 * whole log to whoever connects before it sends anything new. That is what
 * lets a reloaded page, or a phone picking up where a laptop left off, see the
 * run that is still going.
 *
 * `query` is handed in rather than imported, so the tests drive this with a
 * script and `main.mjs` is the only file that needs the SDK installed.
 *
 * `POST /chat/propose` is a one-shot agent that files one inbox note into a
 * folder. It runs its own query, outside the session and the log: the inbox
 * screen wants an answer, not a conversation, and `/chat/new` must not reach it.
 *
 * Plain HTTP and server-sent events rather than a WebSocket: node has no
 * WebSocket server of its own, and `EventSource` reconnects without being
 * asked.
 */

const REFUSED =
  "The chat pane has no way to ask for approval. Do this another way, or tell the user to run it from the terminal pane.";

const PROPOSE_SYSTEM =
  "You file one note from a personal markdown vault's inbox. Pick the one folder from the list where the note belongs, judging by the note's text, its `type:` frontmatter, the ontology and the example note names in each folder. Give the reason in one short sentence.";

function isFolder(folder) {
  return (
    typeof folder === "object" &&
    folder !== null &&
    typeof folder.path === "string" &&
    folder.path !== "" &&
    Array.isArray(folder.examples) &&
    folder.examples.every((example) => typeof example === "string")
  );
}

function isProposal(body) {
  return (
    typeof body.path === "string" &&
    body.path !== "" &&
    typeof body.content === "string" &&
    typeof body.ontology === "string" &&
    Array.isArray(body.folders) &&
    body.folders.length > 0 &&
    body.folders.every(isFolder)
  );
}

/** The note and the folders as the agent reads them. Long notes are cut, the ask is short. */
function proposePrompt({ path, content, ontology, folders }) {
  return [
    `Note: ${path}`,
    "",
    content.slice(0, 8000),
    "",
    "Ontology:",
    ontology,
    "",
    "Folders:",
    ...folders.map((folder) => `- ${folder.path} (e.g. ${folder.examples.slice(0, 5).join(", ")})`),
  ].join("\n");
}

/** User turns, handed to the SDK as they arrive. The SDK reads it for the life of the session. */
function turns() {
  const waiting = [];
  let closed = false;
  let wake = () => {};

  return {
    push(text) {
      waiting.push({
        type: "user",
        message: { role: "user", content: text },
        parent_tool_use_id: null,
      });
      wake();
    },
    end() {
      closed = true;
      wake();
    },
    async *[Symbol.asyncIterator]() {
      for (;;) {
        while (waiting.length > 0) yield waiting.shift();
        if (closed) return;
        await new Promise((resolve) => {
          wake = resolve;
        });
      }
    },
  };
}

/** What a tool handed back, as text. The SDK sends a string or a list of blocks. */
function resultText(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((block) => (block.type === "text" ? block.text : `[${block.type}]`))
    .join("\n");
}

async function readJson(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch (error) {
    if (error instanceof SyntaxError) return undefined;
    throw error;
  }
}

/**
 * Whether a post came from kasten's own page.
 *
 * The login gate in front is not enough on its own. Under basic auth the
 * browser resends the password with any post to this host, from any site, and
 * a post here runs an agent with a shell in the vault. So the post has to name
 * this host as its origin, and has to be JSON, which a page on another site
 * cannot send without a preflight this server never answers.
 */
function fromOwnPage(request) {
  const { origin, host } = request.headers;
  if (!request.headers["content-type"]?.startsWith("application/json")) return false;
  return origin !== undefined && URL.canParse(origin) && new URL(origin).host === host;
}

export function createChat({ query, claudePath, cwd }) {
  let log = [];
  const clients = new Set();
  let session = null;
  let asked = 0;

  function emit(event, { live = false } = {}) {
    // A text delta is live only: the whole block follows it, and a log of
    // every few characters would be most of what a late reader has to replay.
    if (!live) log.push(event);
    for (const client of clients) client.write(`data: ${JSON.stringify(event)}\n\n`);
  }

  function start() {
    const input = turns();
    /** Questions waiting for an answer, by the id the pane was given. */
    const pending = new Map();
    /** Tool calls the pane was shown, so a result with no call beside it is dropped. */
    const shown = new Set();
    const mine = { input, pending, running: null };
    // The session that was replaced goes on yielding for a moment after `new`.
    // Nothing it says belongs in the next one's log.
    const say = (event, how) => {
      if (session === mine) emit(event, how);
    };

    function canUseTool(toolName, toolInput) {
      // Everything else runs unasked under `bypassPermissions`. What still
      // reaches here beside a question is what no mode approves, such as an
      // `rm` of a critical path, and there is no form to approve it with.
      if (toolName !== "AskUserQuestion") return { behavior: "deny", message: REFUSED };

      asked += 1;
      const id = `ask${asked}`;
      say({ type: "ask", id, questions: toolInput.questions });
      return new Promise((resolve) => {
        pending.set(id, (answers) =>
          resolve(
            answers === undefined
              ? { behavior: "deny", message: "The user stopped the run instead of answering." }
              : {
                  behavior: "allow",
                  updatedInput: { questions: toolInput.questions, answers },
                },
          ),
        );
      });
    }

    function read(message) {
      // A subagent's own messages. The pane shows the Agent call and its
      // result, which is the part the user asked for.
      if (message.parent_tool_use_id) return;

      if (message.type === "stream_event") {
        const { event } = message;
        if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
          say({ type: "delta", text: event.delta.text }, { live: true });
        }
      } else if (message.type === "assistant") {
        for (const block of message.message.content) {
          if (block.type === "text") say({ type: "text", text: block.text });
          // A question is drawn as a form, from `canUseTool`, not as a tool call.
          if (block.type === "tool_use" && block.name !== "AskUserQuestion") {
            shown.add(block.id);
            say({ type: "tool", id: block.id, name: block.name, input: block.input });
          }
        }
      } else if (message.type === "user" && Array.isArray(message.message.content)) {
        for (const block of message.message.content) {
          if (block.type === "tool_result" && shown.has(block.tool_use_id)) {
            say({
              type: "tool_result",
              id: block.tool_use_id,
              text: resultText(block.content),
              error: block.is_error === true,
            });
          }
        }
      } else if (message.type === "result") {
        // One per turn. The session stays open for the next message.
        say(
          message.is_error
            ? { type: "done", error: message.result || message.subtype }
            : { type: "done" },
        );
      }
    }

    mine.running = query({
      prompt: input,
      options: {
        cwd,
        pathToClaudeCodeExecutable: claudePath,
        // Claude Code's own prompt, so a skill runs here as it does in the
        // terminal pane. The SDK's default is a minimal one.
        systemPrompt: { type: "preset", preset: "claude_code" },
        // The container is a shell behind the same login gate, so a prompt
        // would add a tap and no safety. Named rather than left out: with no
        // mode the SDK may pick `auto`. See docs/explanation/security-model.md.
        permissionMode: "bypassPermissions",
        allowDangerouslySkipPermissions: true,
        includePartialMessages: true,
        canUseTool,
      },
    });

    (async () => {
      try {
        for await (const message of mine.running) read(message);
        // The stream ran out with nobody having asked it to. Without a word
        // the pane would go on showing a run that is not there.
        say({ type: "error", text: "The session ended." });
      } catch (error) {
        // Whatever ended the session, the person looking at the pane is the
        // one who can act on it: no login, no network, a crashed process.
        if (!(error instanceof Error)) throw error;
        say({ type: "error", text: error.message });
      } finally {
        // Ended either way. A question it left open has nobody to hear the
        // answer, and the next message starts another session.
        if (session === mine) {
          refuse(mine);
          session = null;
        }
      }
    })();

    return mine;
  }

  /** Let go of every open question, which is what stopping means for one. */
  function refuse(current) {
    for (const [id, settle] of current.pending) {
      settle(undefined);
      emit({ type: "answered", id });
    }
    current.pending.clear();
  }

  async function propose(body, response) {
    if (!isProposal(body)) return 400;
    const folders = body.folders.map((folder) => folder.path);
    // The pane drops a request when the user walks on. Nobody is left to read
    // the answer, so the run stops instead of finishing for nothing.
    const abortController = new AbortController();
    response.on("close", () => {
      if (!response.writableEnded) abortController.abort();
    });
    // No `maxTurns`: structured output takes a turn after the answer, so a cap of one cuts it off.
    const running = query({
      prompt: proposePrompt(body),
      options: {
        cwd,
        pathToClaudeCodeExecutable: claudePath,
        systemPrompt: PROPOSE_SYSTEM,
        // Nothing here may run a tool. `tools: []` only empties the built-in set,
        // and without `strictMcpConfig` a `.mcp.json` in the vault or the account's
        // connectors would still load. The prompt holds a note that may have come
        // from the web, so a tool that slips in is refused, not run. Also no vault
        // skills or CLAUDE.md, since it answers from what it was sent.
        tools: [],
        strictMcpConfig: true,
        settingSources: [],
        persistSession: false,
        model: "haiku",
        permissionMode: "dontAsk",
        abortController,
        outputFormat: {
          type: "json_schema",
          schema: {
            type: "object",
            properties: {
              folder: { type: "string", enum: folders },
              reason: { type: "string" },
            },
            required: ["folder", "reason"],
            additionalProperties: false,
          },
        },
      },
    });

    let answer;
    try {
      for await (const message of running) {
        if (message.type === "result") {
          answer = message;
          break;
        }
      }
    } catch (error) {
      // The socket is gone, so nobody reads this status. It only records why the run ended.
      if (!(error instanceof Error) || !abortController.signal.aborted) throw error;
      return 499;
    }
    const picked = answer?.is_error ? undefined : answer?.structured_output;
    if (
      typeof picked !== "object" ||
      picked === null ||
      !folders.includes(picked.folder) ||
      typeof picked.reason !== "string"
    ) {
      return 502;
    }
    return { status: 200, json: { folder: picked.folder, reason: picked.reason } };
  }

  const posts = {
    "/chat/propose": propose,
    "/chat/send": ({ text }) => {
      if (typeof text !== "string" || text.trim() === "") return 400;
      session ??= start();
      emit({ type: "user", text });
      session.input.push(text);
      return 204;
    },
    "/chat/answer": ({ id, answers }) => {
      const settle = session?.pending.get(id);
      if (settle === undefined) return 409;
      if (typeof answers !== "object" || answers === null) return 400;
      session.pending.delete(id);
      settle(answers);
      emit({ type: "answered", id, answers });
      return 204;
    },
    "/chat/stop": async () => {
      if (session === null) return 204;
      refuse(session);
      await session.running.interrupt();
      return 204;
    },
    "/chat/new": () => {
      if (session !== null) {
        const ending = session;
        session = null;
        for (const settle of ending.pending.values()) settle(undefined);
        ending.input.end();
        ending.running.close();
      }
      log = [];
      emit({ type: "reset", log }, { live: true });
      return 204;
    },
  };

  async function route(request, response) {
    const { pathname } = new URL(request.url, "http://runner");

    if (request.method === "GET" && pathname === "/chat/events") {
      response.writeHead(200, {
        "content-type": "text/event-stream",
        // `no-transform` asks a proxy not to compress this. A compressor
        // that buffers the stream leaves the pane connected and empty.
        "cache-control": "no-store, no-transform",
      });
      // The whole log in the one `reset`, so a pane that reconnects swaps what
      // it had for this in a single step, with no bookkeeping of what it saw
      // and no moment in between where it has nothing to draw.
      response.write(`data: ${JSON.stringify({ type: "reset", log })}\n\n`);
      clients.add(response);
      request.on("close", () => clients.delete(response));
      return;
    }

    const post = request.method === "POST" ? posts[pathname] : undefined;
    if (post === undefined) {
      response.writeHead(404).end();
      return;
    }
    if (!fromOwnPage(request)) {
      response.writeHead(403).end();
      return;
    }
    const body = await readJson(request);
    const isObject = typeof body === "object" && body !== null && !Array.isArray(body);
    const answer = isObject ? await post(body, response) : 400;
    if (typeof answer === "number") response.writeHead(answer).end();
    else {
      response.writeHead(answer.status, { "content-type": "application/json" });
      response.end(JSON.stringify(answer.json));
    }
  }

  async function handle(request, response) {
    try {
      await route(request, response);
    } catch (error) {
      // A request that went wrong is that request's problem: a body cut off
      // as a phone lost its signal, an address `URL` cannot read, an interrupt
      // the SDK refused. Left to reject, any of them is an unhandled rejection,
      // which ends the runner and the session with it.
      if (!(error instanceof Error)) throw error;
      console.error(`kasten-chat: ${request.method} ${request.url}: ${error.message}`);
      if (!response.headersSent) response.writeHead(500);
      response.end();
    }
  }

  return { handle };
}
