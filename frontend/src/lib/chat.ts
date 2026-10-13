/**
 * What the chat runner says, and what the chat pane makes of it.
 *
 * Pure: no `EventSource`, no DOM. `chat-pane.tsx` owns the stream and the
 * markup, and this owns the reading of it, so a run can be tested as a list of
 * events without mounting anything. The other end is `shell/chat/runner.mjs`,
 * and the two have to agree on the events below.
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
   * Turns sent and not yet finished. A count and not a flag, because a message
   * sent during a run is queued behind it, and the first `done` is not the end.
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
    // First on every connection, with the whole log inside it. So a pane that
    // reconnects swaps what it had for the run so far in one step, and a form
    // half filled in is still on screen afterwards to be finished.
    case "reset":
      return event.log.reduce(reduce, EMPTY);
    case "user":
      return { ...add({ kind: "user", text: event.text }), running: state.running + 1 };
    case "delta":
      return { ...state, streaming: state.streaming + event.text };
    // The whole block, which takes the place of the pieces that led up to it.
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
    // The session itself ended, and whatever was queued behind it with it.
    case "error":
      return { ...add({ kind: "error", text: event.text }), running: 0 };
  }
}

/** The fields that say what a tool call is about, most telling first. */
const TELLING = ["command", "file_path", "skill", "pattern", "url", "query", "description"];

/**
 * One line for a tool call while it is folded: the command, the file, the skill.
 *
 * A guess at which field matters, since every tool names its own. A tool with
 * none of these shows its name alone, and the whole input is one tap away.
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
 * The answers a form holds, or nothing while a question still has none.
 *
 * Keyed by the question's text and joined with `", "`, which is the shape the
 * tool reads. Typed text stands beside the picked labels as one more answer,
 * never as the word "Other".
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
 * Say something to the runner. Whether it took it is the answer.
 *
 * JSON on purpose, and not only because the runner parses it: the runner
 * refuses any other content type, which is what keeps a form on another site
 * from posting here. See `fromOwnPage` in `shell/chat/runner.mjs`.
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
    // What `fetch` throws when there is no network or no server, which to the
    // person who pressed the button is one more way of not having been heard.
    if (error instanceof TypeError) return false;
    throw error;
  }
}

/** One folder a note could be filed in, with a few of the notes already there. */
export interface TriageFolder {
  path: string;
  examples: string[];
}

/** What the agent is asked about: one note, the vocabulary, and the folders it may pick. */
export interface ProposeInput {
  path: string;
  content: string;
  /** The vault's ontology note, or `""` when there is none. */
  ontology: string;
  /** Never empty: the runner refuses a request with no folder to choose from. */
  folders: TriageFolder[];
}

/** The agent's pick: a folder from the list it was given, and why. */
export interface Proposal {
  folder: string;
  reason: string;
}

/**
 * Ask the runner which folder a note belongs in.
 *
 * Throws on any answer but a 200, so a TanStack Query `queryFn` shows the
 * failure. JSON for the same reason as `postChat`: the runner refuses any other
 * content type. The signal goes to `fetch` because the runner stops the agent
 * when the request is dropped, so a note walked past stops costing.
 */
export async function proposeFolder(input: ProposeInput, signal?: AbortSignal): Promise<Proposal> {
  const response = await fetch("/chat/propose", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
    signal,
  });
  if (!response.ok) throw new Error(`POST /chat/propose failed with ${response.status}`);
  return (await response.json()) as Proposal;
}
