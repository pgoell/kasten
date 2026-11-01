/**
 * The runner with a scripted session in place of Claude, for work on the pane.
 *
 *   node shell/chat/stub.mjs
 *
 * No SDK, no login and no vault: it plays one made-up `/close-day` whatever is
 * sent, slowly enough to watch, with a tool call, a question and a closing
 * line. `mise run fe:dev` proxies `/chat` to the port this listens on. Never
 * copied into the image.
 */
import { createServer } from "node:http";
import { setTimeout as pause } from "node:timers/promises";
import { createChat } from "./runner.mjs";

const assistant = (content) => ({
  type: "assistant",
  parent_tool_use_id: null,
  message: { content },
});

async function* say(text) {
  for (const word of text.split(/(?<= )/)) {
    await pause(90);
    yield {
      type: "stream_event",
      parent_tool_use_id: null,
      event: { type: "content_block_delta", delta: { type: "text_delta", text: word } },
    };
  }
  yield assistant([{ type: "text", text }]);
}

async function* tool(id, name, input, output) {
  yield assistant([{ type: "tool_use", id, name, input }]);
  await pause(700);
  yield {
    type: "user",
    parent_tool_use_id: null,
    message: { content: [{ type: "tool_result", tool_use_id: id, content: output }] },
  };
}

const QUESTIONS = [
  {
    question: "Three todos are still open today. What should happen to them?",
    header: "Open todos",
    multiSelect: false,
    options: [
      { label: "Move to tomorrow", description: "Carry all three into tomorrow's note" },
      { label: "Leave them", description: "Keep them on today's note" },
    ],
  },
  {
    question: "Which sections should tomorrow's plan have?",
    header: "Sections",
    multiSelect: true,
    options: [
      { label: "Focus", description: "The one thing that must happen" },
      { label: "Errands", description: "Calls and small jobs" },
      { label: "Reading", description: "What to read in the evening" },
    ],
  },
];

const steps = (made, options) => [
  () =>
    say(
      "Closing the day. I will read today's note first, then count the todos that are still open across the vault, and then ask you what to do with them before I write tomorrow's plan.",
    ),
  () =>
    tool(
      `read${made}`,
      "Read",
      { file_path: "/vault/10 Daily/2026-10-13.md" },
      "# 2026-10-13\n\n## Dump\n\nCall the plumber about the kitchen tap.\nIdea: a reading list per quarter.\n",
    ),
  () =>
    tool(
      `bash${made}`,
      "Bash",
      { command: "rg --count '^- \\[ \\]' /vault", description: "Count open todos" },
      "10 Daily/2026-10-13.md:3\n20 Projects/Garden.md:2\n",
    ),
  // The one step that says nothing itself: the runner draws the question.
  () => options.canUseTool("AskUserQuestion", { questions: QUESTIONS }),
  () =>
    tool(
      `edit${made}`,
      "Edit",
      { file_path: "/vault/10 Daily/2026-10-14.md", old_string: "", new_string: "## Focus\n" },
      "The file /vault/10 Daily/2026-10-14.md has been updated.",
    ),
  () => say("Done. Tomorrow's note has the three todos and the plan. Good night."),
];

function query({ prompt, options }) {
  let interrupted = false;
  let made = 0;

  async function* play() {
    // Checked between steps, which is as fine as a script needs to stop.
    for (const step of steps(made, options)) {
      if (interrupted) return;
      const said = step();
      if (Symbol.asyncIterator in said) yield* said;
      else await said;
    }
  }

  async function* run() {
    for await (const _turn of prompt) {
      interrupted = false;
      made += 1;
      yield* play();
      yield interrupted
        ? { type: "result", subtype: "error_during_execution", is_error: true, result: "Stopped." }
        : { type: "result", subtype: "success", is_error: false, result: "" };
    }
  }

  const stream = run();
  return {
    [Symbol.asyncIterator]: () => stream,
    interrupt: async () => {
      interrupted = true;
    },
    close: () => {},
  };
}

const port = Number(process.argv[2] ?? 7682);
createServer(createChat({ query, claudePath: "", cwd: "." }).handle).listen(port, "127.0.0.1");
console.log(`kasten chat stub on http://127.0.0.1:${port}`);
