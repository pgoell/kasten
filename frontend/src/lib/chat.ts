/**
 * What the chat runner says, and what the chat pane makes of it. Pure: no `EventSource`, no DOM,
 * so a run can be tested as a list of events. `shell/chat/runner.mjs` must agree on these events.
 */

export interface ChatOption {
  label: string;
  description: string;
}

/** One question of an `AskUserQuestion` call, as Claude wrote it. */
export interface ChatQuestion {
  question: string;
  header: string;
  options: ChatOption[];
  multiSelect: boolean;
}

/** An answer per question, keyed by the question's own text. */
export type ChatAnswers = Record<string, string>;

export type ChatEvent =
  | { type: "reset"; log: ChatEvent[] }
  | { type: "user"; text: string }
  | { type: "delta"; text: string }
  | { type: "text"; text: string }
  | { type: "tool"; id: string; name: string; input: unknown }
  | { type: "tool_result"; id: string; text: string; error: boolean }
  | { type: "ask"; id: string; questions: ChatQuestion[] }
  | { type: "answered"; id: string; answers?: ChatAnswers }
  | { type: "done"; error?: string }
  | { type: "error"; text: string };

export type ChatItem =
  | { kind: "user"; text: string }
  | { kind: "text"; text: string }
  | {
      kind: "tool";
      id: string;
      name: string;
      input: unknown;
      result?: { text: string; error: boolean };
    }
  | {
      kind: "ask";
      id: string;
      questions: ChatQuestion[];
      /** Whether it still waits for an answer. */
      open: boolean;
      /** Absent on one that was stopped rather than answered. */
      answers?: ChatAnswers;
    }
  | { kind: "error"; text: string };

export interface ChatState {
  items: ChatItem[];
  /** The text block now arriving, a few words at a time. */
  streaming: string;
  /**
   * Turns sent and not yet finished. A count, not a flag: a message sent mid-run queues,
   * so the first `done` is not the end.
   */
  running: number;
}

export const EMPTY: ChatState = { items: [], streaming: "", running: 0 };

export function reduce(state: ChatState, event: ChatEvent): ChatState {
  const add = (item: ChatItem): ChatState => ({
    ...state,
    items: [...state.items, item],
    streaming: "",
  });

  switch (event.type) {
    // First on every connection, with the whole log: a reconnect swaps in the run so far,
    // and a half-filled form stays on screen.
    case "reset":
      return event.log.reduce(reduce, EMPTY);
    case "user":
      return { ...add({ kind: "user", text: event.text }), running: state.running + 1 };
    case "delta":
      return { ...state, streaming: state.streaming + event.text };
    // The whole block, replacing the streamed pieces before it.
    case "text":
      return add({ kind: "text", text: event.text });
    case "tool":
      return add({ kind: "tool", id: event.id, name: event.name, input: event.input });
    case "tool_result":
      return {
        ...state,
        items: state.items.map((item) =>
          item.kind === "tool" && item.id === event.id
            ? { ...item, result: { text: event.text, error: event.error } }
            : item,
        ),
      };
    case "ask":
      return add({ kind: "ask", id: event.id, questions: event.questions, open: true });
    case "answered":
      return {
        ...state,
        items: state.items.map((item) =>
          item.kind === "ask" && item.id === event.id
            ? { ...item, open: false, answers: event.answers }
            : item,
        ),
      };
    case "done": {
      const next = event.error === undefined ? state : add({ kind: "error", text: event.error });
      return { ...next, streaming: "", running: Math.max(0, state.running - 1) };
    }
    // The session ended, and whatever was queued behind it with it.
    case "error":
      return { ...add({ kind: "error", text: event.text }), running: 0 };
  }
}

/** The fields that say what a tool call is about, most telling first. */
const TELLING = ["command", "file_path", "skill", "pattern", "url", "query", "description"];

/**
 * One line for a folded tool call, from the first telling field. A guess: every tool names
 * its own fields, and a tool with none shows its name alone.
 */
export function toolLine(input: unknown): string {
  if (typeof input !== "object" || input === null) return "";
  const fields = input as Record<string, unknown>;
  for (const name of TELLING) {
    const value = fields[name];
    if (typeof value === "string" && value !== "") return value;
  }
  return "";
}

/** What was picked and what was typed for one question. */
export interface Pick {
  labels: string[];
  other: string;
}

/**
 * The answers a form holds, or undefined while a question has none. Keyed by question text,
 * joined with `", "` as the tool reads them. Typed text is one more answer, never "Other".
 */
export function answersFor(
  questions: ChatQuestion[],
  picks: Record<string, Pick | undefined>,
): ChatAnswers | undefined {
  const answers: ChatAnswers = {};
  for (const { question } of questions) {
    const pick = picks[question];
    const parts = [...(pick?.labels ?? []), pick?.other.trim() ?? ""].filter((part) => part !== "");
    if (parts.length === 0) return undefined;
    answers[question] = parts.join(", ");
  }
  return answers;
}

/**
 * Says something to the runner; the answer is whether it took it. JSON on purpose: the runner
 * refuses other content types, which keeps a form on another site from posting here.
 */
export async function postChat(
  path: "send" | "answer" | "stop" | "new",
  body: object = {},
): Promise<boolean> {
  try {
    const response = await fetch(`/chat/${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    return response.ok;
  } catch (error: unknown) {
    // fetch throws a TypeError with no network; the caller reads that as not heard.
    if (error instanceof TypeError) return false;
    throw error;
  }
}
