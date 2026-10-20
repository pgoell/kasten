import { useEffect, useReducer, useRef, useState } from "react";
import {
  answersFor,
  type ChatEvent,
  type ChatItem,
  EMPTY,
  type Pick,
  postChat,
  reduce,
  toolLine,
} from "@/lib/chat";
import type { EditorCommands } from "@/lib/key-bindings";
import { heldModifier, leaderAction, leaderPrefix } from "@/lib/leader-keys";
import { LABEL } from "@/lib/overlay-styles";
import { useViewport } from "@/lib/use-viewport";

/** The two skills this pane exists to start, each one press away. */
const SKILLS = ["/close-day", "/process-meeting"];

/** How long a pane waits before it asks a runner that was not there again. */
const RETRY_MS = 3000;

// `min-h-11` under a finger, which is the 44px the phone's toolbar holds to.
const BUTTON =
  "shrink-0 rounded border border-one-line px-2 py-0.5 text-[12px] text-one-fg hover:bg-one-hover disabled:opacity-40 pointer-coarse:min-h-11 pointer-coarse:px-3 pointer-coarse:text-sm";

interface ChatPaneProps {
  /** What a leader sequence reaches. The same object every other pane is given. */
  commands: EditorCommands;
  /** Raised when the pane this sits in has been moved to. See `Editor`. */
  focusSignal?: number;
}

/**
 * A chat with Claude Code in the vault: the terminal pane's agent without the
 * terminal.
 *
 * The session is not here. It lives in the runner in the shell container, and
 * this draws what the runner's stream says: every connection begins with the
 * whole run so far, so a reload, a second pane and a phone all see the one
 * session. Everything read off the stream is `chat.ts`, which is where that is
 * tested.
 *
 * Tools run without asking. The one thing a run stops for is a question, drawn
 * as a form. Why that is no wider a door than the terminal pane is in
 * docs/explanation/security-model.md.
 */
export function ChatPane({ commands, focusSignal }: ChatPaneProps) {
  const panel = useRef<HTMLElement>(null);
  const box = useRef<HTMLTextAreaElement>(null);
  const log = useRef<HTMLDivElement>(null);
  const [state, dispatch] = useReducer(reduce, EMPTY);
  const [draft, setDraft] = useState("");
  /** Unknown until the stream opens or fails, so a pane does not flash a warning on its way up. */
  const [reached, setReached] = useState<boolean | null>(null);
  /** The last thing said to the runner that it did not take, if it took none since. */
  const [refused, setRefused] = useState<string | null>(null);
  /** The keys of an unfinished leader sequence, starting with the space. */
  const [pending, setPending] = useState("");
  /** Whether the transcript is at its foot, which is when it follows new text. */
  const following = useRef(true);
  const { coarse } = useViewport();

  useEffect(() => {
    let source: EventSource;
    let retry: ReturnType<typeof setTimeout> | undefined;

    // The runner answers every connection with a `reset` and the whole log, so
    // nothing here keeps count of what it has seen.
    function connect() {
      source = new EventSource("/chat/events");
      source.onopen = () => setReached(true);
      source.onmessage = (message) => dispatch(JSON.parse(message.data) as ChatEvent);
      source.onerror = () => {
        setReached(false);
        // `EventSource` reconnects by itself after a dropped connection and
        // gives up for good after an answer that is not a stream: the proxy's
        // 502 while the shell container restarts, which is the one moment a
        // pane most needs to come back unasked.
        if (source.readyState === EventSource.CLOSED) retry = setTimeout(connect, RETRY_MS);
      };
    }
    connect();

    return () => {
      clearTimeout(retry);
      source.close();
    };
  }, []);

  // The panel and not the box. A box that took the focus would take the space
  // bar with it, and with it every leader key, the moment the pane opened; on
  // a phone it would raise the keyboard over a pane nobody has read yet.
  useEffect(() => {
    if (focusSignal) panel.current?.focus();
  }, [focusSignal]);

  // Follow the run down the page, unless the reader has scrolled up to read.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the transcript is what moved, though the effect reads only the element.
  useEffect(() => {
    const element = log.current;
    if (element !== null && following.current) element.scrollTop = element.scrollHeight;
  }, [state]);

  /**
   * Say something to the runner, and say so in the pane when it was not taken:
   * a login that ran out, a proxy answering for a runner that is down, a
   * question somebody else answered first. Silence there reads as a run that
   * is about to start.
   */
  async function tell(path: Parameters<typeof postChat>[0], body?: object): Promise<boolean> {
    const taken = await postChat(path, body);
    setRefused(taken ? null : path);
    return taken;
  }

  async function send(text: string) {
    if (text.trim() === "") return;
    // Cleared at once, so a second Enter cannot send it twice, and put back
    // when the runner did not take it, so it is still there to send again.
    const typed = text === draft;
    if (typed) setDraft("");
    const taken = await tell("send", { text });
    if (!taken && typed) setDraft((now) => (now === "" ? text : now));
  }

  function onKeyDown(event: React.KeyboardEvent) {
    const { key } = event;
    const inside = (event.target as Element).closest("textarea, input, button, summary");

    // One way back to the pane from anything in it, the message box included.
    if (key === "Escape" && inside !== null) {
      event.preventDefault();
      panel.current?.focus();
      return;
    }
    // Typing is typing, and a button's keys are the button's: a space in the
    // box is a space, and Enter on a tool call opens it.
    if (inside !== null) return;

    if (heldModifier(key)) return;

    if (pending) {
      const sequence = pending + key;
      const wanted = sequence.slice(1);
      const run = leaderAction(wanted, commands);
      setPending(!run && leaderPrefix(wanted) ? sequence : "");

      if (run) {
        event.preventDefault();
        run();
      }
      return;
    }

    if (event.ctrlKey || event.altKey || event.metaKey) return;

    if (key === " ") {
      setPending(key);
      event.preventDefault();
    }
    // Vim's way into a place to type, and the one a hand already knows here.
    if (key === "i" || key === "Enter") {
      event.preventDefault();
      box.current?.focus();
    }
  }

  const running = state.running > 0;
  // A run that waits on the form above is not working, it is waiting for you.
  const asking = state.items.some((item) => item.kind === "ask" && item.open);

  return (
    <section
      ref={panel}
      tabIndex={-1}
      onKeyDown={onKeyDown}
      aria-label="chat"
      className="flex h-full flex-col bg-one-bg font-mono outline-none"
    >
      <header className="flex flex-wrap items-center gap-2 border-b border-one-line px-3 py-1">
        <span className={`${LABEL} shrink-0`}>chat</span>
        {SKILLS.map((skill) => (
          <button key={skill} type="button" className={BUTTON} onClick={() => void send(skill)}>
            {skill}
          </button>
        ))}
        <span className="flex-1" />
        {running && (
          <button
            type="button"
            className={`${BUTTON} text-one-warn`}
            onClick={() => void tell("stop")}
          >
            Stop
          </button>
        )}
        <button
          type="button"
          aria-label="New session"
          className={BUTTON}
          onClick={() => void tell("new")}
        >
          New
        </button>
      </header>

      {reached === false && (
        <p role="status" className="border-b border-one-line px-3 py-1 text-[12px] text-one-warn">
          Could not reach the chat runner at /chat/events. Check that the shell container is
          running, that the /chat route is in place, and that you are logged in.
        </p>
      )}

      {refused !== null && reached !== false && (
        <p role="alert" className="border-b border-one-line px-3 py-1 text-[12px] text-one-warn">
          The chat runner did not take that ({refused}). Try again, or reload if your login ran out.
        </p>
      )}

      <div
        ref={log}
        role="log"
        aria-label="Conversation"
        onScroll={(event) => {
          const { scrollHeight, scrollTop, clientHeight } = event.currentTarget;
          following.current = scrollHeight - scrollTop - clientHeight < 40;
        }}
        className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-3 text-[13px] text-one-fg pointer-coarse:text-base"
      >
        {state.items.length === 0 && state.streaming === "" && (
          <p className="text-one-muted">
            Claude Code, in the vault. Start a skill above, or write a message below.
          </p>
        )}
        {state.items.map((item, at) => (
          // The log only grows and a reset replaces all of it, so a position
          // names the same item for as long as the item is there.
          // biome-ignore lint/suspicious/noArrayIndexKey: see above.
          <Item key={at} item={item} onAnswer={(body) => void tell("answer", body)} />
        ))}
        {state.streaming !== "" && <p className="whitespace-pre-wrap">{state.streaming}</p>}
        {running && state.streaming === "" && !asking && <p className="text-one-muted">Working…</p>}
      </div>

      <form
        className="flex items-end gap-2 border-t border-one-line px-3 py-2"
        onSubmit={(event) => {
          event.preventDefault();
          void send(draft);
        }}
      >
        <textarea
          ref={box}
          value={draft}
          rows={Math.min(6, draft.split("\n").length)}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            // Enter sends from a keyboard. On a phone's it breaks the line as
            // it does everywhere else there, and the button sends.
            // Not the Enter that picks a word in an input method's list.
            const composing = event.nativeEvent.isComposing;
            if (event.key === "Enter" && !event.shiftKey && !coarse && !composing) {
              event.preventDefault();
              void send(draft);
            }
          }}
          aria-label="Message"
          placeholder="Message, or /skill"
          autoComplete="off"
          // 16px under a finger: Safari zooms the page on the focus of anything smaller.
          className="min-w-0 flex-1 resize-none bg-transparent text-[13px] text-one-fg outline-none placeholder:text-one-muted pointer-coarse:text-base"
        />
        <button type="submit" className={BUTTON} disabled={draft.trim() === ""}>
          Send
        </button>
      </form>
    </section>
  );
}

function Item({ item, onAnswer }: { item: ChatItem; onAnswer: (body: object) => void }) {
  switch (item.kind) {
    case "user":
      return (
        <p className="whitespace-pre-wrap border-one-accent border-l-2 pl-2 text-one-accent">
          {item.text}
        </p>
      );
    case "text":
      return <p className="whitespace-pre-wrap">{item.text}</p>;
    case "error":
      return <p className="whitespace-pre-wrap text-one-warn">{item.text}</p>;
    case "tool":
      return <Tool item={item} />;
    case "ask":
      return item.open ? <Ask item={item} onAnswer={onAnswer} /> : <Answered item={item} />;
  }
}

/** One tool call, folded to a line until it is opened. */
function Tool({ item }: { item: Extract<ChatItem, { kind: "tool" }> }) {
  const mark = item.result === undefined ? "…" : item.result.error ? "✗" : "✓";

  return (
    <details className="rounded border border-one-line bg-one-panel">
      <summary className="flex cursor-pointer items-center gap-2 px-2 py-1 pointer-coarse:min-h-11">
        <span className={item.result?.error ? "text-one-warn" : "text-one-green"}>{mark}</span>
        <span className="shrink-0 text-one-yellow">{item.name}</span>
        <span className="min-w-0 flex-1 truncate text-one-muted">{toolLine(item.input)}</span>
      </summary>
      <pre className="overflow-x-auto border-one-line border-t px-2 py-1 text-[12px] text-one-muted">
        {JSON.stringify(item.input, null, 2)}
      </pre>
      {item.result !== undefined && (
        <pre
          className={`max-h-64 overflow-auto whitespace-pre-wrap border-one-line border-t px-2 py-1 text-[12px] ${item.result.error ? "text-one-warn" : ""}`}
        >
          {item.result.text}
        </pre>
      )}
    </details>
  );
}

/** A question the run is waiting on: Claude's options, and a field for anything else. */
function Ask({
  item,
  onAnswer,
}: {
  item: Extract<ChatItem, { kind: "ask" }>;
  onAnswer: (body: object) => void;
}) {
  const [picks, setPicks] = useState<Record<string, Pick | undefined>>({});
  const answers = answersFor(item.questions, picks);

  function pick(question: string, change: (held: Pick) => Pick) {
    setPicks((previous) => ({
      ...previous,
      [question]: change(previous[question] ?? { labels: [], other: "" }),
    }));
  }

  return (
    <form
      className="space-y-3 rounded border border-one-accent bg-one-panel p-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (answers !== undefined) onAnswer({ id: item.id, answers });
      }}
    >
      {item.questions.map(({ question, header, options, multiSelect }) => {
        const held = picks[question];
        return (
          <fieldset key={question} className="space-y-1">
            <legend className="pb-1">
              <span className={`${LABEL} mr-2`}>{header}</span>
              {question}
            </legend>
            {options.map(({ label, description }) => (
              <label
                key={label}
                className="flex cursor-pointer items-start gap-2 rounded px-1 py-0.5 hover:bg-one-hover pointer-coarse:min-h-11 pointer-coarse:items-center"
              >
                <input
                  type={multiSelect ? "checkbox" : "radio"}
                  // The item's id too: two questions in one run can share their text.
                  name={`${item.id}:${question}`}
                  checked={held?.labels.includes(label) ?? false}
                  onChange={(event) =>
                    pick(question, (was) =>
                      multiSelect
                        ? {
                            ...was,
                            labels: event.target.checked
                              ? [...was.labels, label]
                              : was.labels.filter((each) => each !== label),
                          }
                        : // One answer to a question that takes one: the pick
                          // replaces whatever was typed.
                          { labels: [label], other: "" },
                    )
                  }
                  className="mt-1 pointer-coarse:mt-0"
                />
                <span>
                  {label}
                  {description !== "" && <span className="text-one-muted"> {description}</span>}
                </span>
              </label>
            ))}
            <input
              type="text"
              value={held?.other ?? ""}
              onChange={(event) =>
                pick(question, (was) => ({
                  labels: multiSelect ? was.labels : [],
                  other: event.target.value,
                }))
              }
              aria-label={`Other answer to: ${question}`}
              placeholder="Other"
              autoComplete="off"
              className="w-full border-one-line border-b bg-transparent px-1 py-0.5 text-one-fg outline-none placeholder:text-one-muted pointer-coarse:min-h-11 pointer-coarse:text-base"
            />
          </fieldset>
        );
      })}
      <button type="submit" className={BUTTON} disabled={answers === undefined}>
        Answer
      </button>
    </form>
  );
}

/** A question that is over: what was asked and what was said. */
function Answered({ item }: { item: Extract<ChatItem, { kind: "ask" }> }) {
  return (
    <dl className="rounded border border-one-line bg-one-panel px-3 py-2">
      {item.questions.map(({ question }) => (
        <div key={question}>
          <dt className="text-one-muted">{question}</dt>
          <dd className="text-one-accent">{item.answers?.[question] ?? "Not answered"}</dd>
        </div>
      ))}
    </dl>
  );
}
