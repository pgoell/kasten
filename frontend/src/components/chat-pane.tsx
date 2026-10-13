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
import { type EditorCommands, heldModifier, leaderAction, leaderPrefix } from "@/lib/key-bindings";
import { LABEL } from "@/lib/overlay-styles";
import { useViewport } from "@/lib/use-viewport";

/** The two skills this pane exists to start, each one press away. */
const SKILLS = ["/close-day", "/process-meeting"];

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
  /** The keys of an unfinished leader sequence, starting with the space. */
  const [pending, setPending] = useState("");
  /** Whether the transcript is at its foot, which is when it follows new text. */
  const following = useRef(true);
  const { coarse } = useViewport();

  useEffect(() => {
    // `EventSource` reconnects on its own, and the runner answers every
    // connection with a `reset` and the whole log, so nothing here keeps count
    // of what it has seen.
    const source = new EventSource("/chat/events");
    source.onopen = () => setReached(true);
    source.onerror = () => setReached(false);
    source.onmessage = (message) => dispatch(JSON.parse(message.data) as ChatEvent);
    return () => source.close();
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

  function send(text: string) {
    if (text.trim() === "") return;
    setDraft("");
    void postChat("send", { text });
  }

  function onKeyDown(event: React.KeyboardEvent) {
    // Typing is typing: a space in the box or in a form's field is a space.
    if (event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLInputElement) {
      return;
    }
    const { key } = event;

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
          <button key={skill} type="button" className={BUTTON} onClick={() => send(skill)}>
            {skill}
          </button>
        ))}
        <span className="flex-1" />
        {running && (
          <button
            type="button"
            className={`${BUTTON} text-one-warn`}
            onClick={() => void postChat("stop")}
          >
            Stop
          </button>
        )}
        <button
          type="button"
          aria-label="New session"
          className={BUTTON}
          onClick={() => void postChat("new")}
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
          <Item key={at} item={item} />
        ))}
        {state.streaming !== "" && <p className="whitespace-pre-wrap">{state.streaming}</p>}
        {running && state.streaming === "" && <p className="text-one-muted">Working…</p>}
      </div>

      <form
        className="flex items-end gap-2 border-t border-one-line px-3 py-2"
        onSubmit={(event) => {
          event.preventDefault();
          send(draft);
        }}
      >
        <textarea
          ref={box}
          value={draft}
          rows={Math.min(6, draft.split("\n").length)}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              panel.current?.focus();
            }
            // Enter sends from a keyboard. On a phone's it breaks the line as
            // it does everywhere else there, and the button sends.
            if (event.key === "Enter" && !event.shiftKey && !coarse) {
              event.preventDefault();
              send(draft);
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

function Item({ item }: { item: ChatItem }) {
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
      return item.open ? <Ask item={item} /> : <Answered item={item} />;
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
function Ask({ item }: { item: Extract<ChatItem, { kind: "ask" }> }) {
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
        if (answers !== undefined) void postChat("answer", { id: item.id, answers });
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
