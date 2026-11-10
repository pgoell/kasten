import { useEffect, useReducer, useRef, useState } from "react";
import { type ChatEvent, EMPTY, postChat, reduce } from "@/lib/terminal/chat";
import type { EditorCommands } from "@/lib/ui/keys/key-bindings";
import { useLeader } from "@/lib/ui/keys/use-leader";
import { Composer } from "./composer";
import { Markdown } from "./markdown";
import { rows, Turn, Working } from "./transcript";

/** Everything else: quiet until hovered. */
const GHOST =
  "inline-flex shrink-0 items-center gap-1.5 rounded-lg px-2 py-1 text-[13px] text-k-muted transition-colors hover:bg-k-surface hover:text-k-ink disabled:opacity-40 pointer-coarse:min-h-11 pointer-coarse:px-3";

/** The two skills this pane exists to start, each one press away. */
const SKILLS = [
  { name: "/close-day", what: "Wrap up today and plan tomorrow" },
  { name: "/process-meeting", what: "Turn a meeting into notes and todos" },
];

/** How long a pane waits before it asks a runner that was not there again. */
const RETRY_MS = 3000;

interface ChatPaneProps {
  /** What a leader sequence reaches. The same object every other pane is given. */
  commands: EditorCommands;
  /** Raised when the pane this sits in has been moved to. See `Editor`. */
  focusSignal?: number;
}

/** The session lives in the runner. This draws its stream, which replays the whole run on each connect. */
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
  const leader = useLeader(commands);
  /** Whether the transcript is at its foot, which is when it follows new text. */
  const following = useRef(true);

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
    if (element === null || !following.current) return;
    // A question taller than the pane shows from its top, or its first options sit out of sight.
    const ask = element.querySelector<HTMLElement>("[data-open-ask]");
    element.scrollTop =
      ask !== null && ask.offsetHeight > element.clientHeight
        ? ask.offsetTop - 16
        : element.scrollHeight;
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
    following.current = true;
    const taken = await tell("send", { text });
    if (!taken && typed) setDraft((now) => (now === "" ? text : now));
  }

  function onKeyDown(event: React.KeyboardEvent) {
    // Typing is typing, and a button's keys are the button's: a space in the
    // box is a space, and Enter on a tool call opens it.
    if ((event.target as Element).closest("textarea, input, button, summary") !== null) {
      // One way back to the pane from anything in it, the message box included.
      if (event.key === "Escape") {
        event.preventDefault();
        panel.current?.focus();
      }
      return;
    }

    if (leader.feed(event)) return;
    if (event.ctrlKey || event.altKey || event.metaKey) return;

    if (event.key === " ") {
      leader.start(event);
      event.preventDefault();
      return;
    }
    // Vim's way into a place to type, and the one a hand already knows here.
    if (event.key === "i" || event.key === "Enter") {
      event.preventDefault();
      box.current?.focus();
    }
  }

  const running = state.running > 0;
  // A run that waits on the form is not working, it is waiting for you.
  const asking = state.items.some((item) => item.kind === "ask" && item.open);
  const blank = state.items.length === 0 && state.streaming === "";

  return (
    <section
      ref={panel}
      tabIndex={-1}
      onKeyDown={onKeyDown}
      aria-label="chat"
      className="flex h-full flex-col bg-k-bg font-sans text-k-ink outline-none"
    >
      <header className="flex items-center gap-2 border-k-rule border-b px-3 py-1.5">
        <span className="font-semibold text-k-15">Claude</span>
        <Status reached={reached} running={running} asking={asking} />
        <span className="flex-1" />
        <button
          type="button"
          aria-label="New session"
          title="Start a new session"
          className={GHOST}
          onClick={() => void tell("new")}
        >
          <span aria-hidden="true" className="text-base leading-none">
            +
          </span>
          New
        </button>
      </header>

      {reached === false && (
        <p role="status" className="bg-k-danger/10 px-3 py-1.5 text-[12px] text-k-danger">
          Could not reach the chat runner. Trying again… If this stays, check that the shell
          container is running, that the /chat route is in place, and that you are logged in.
        </p>
      )}

      {refused !== null && reached !== false && (
        <p role="alert" className="bg-k-danger/10 px-3 py-1.5 text-[12px] text-k-danger">
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
        className="relative min-h-0 flex-1 overflow-y-auto text-k-15 leading-relaxed pointer-coarse:text-base"
      >
        <div className="mx-auto max-w-3xl space-y-4 px-4 py-4">
          {blank && <Welcome send={(text) => void send(text)} />}
          {rows(state.items).map((row) => (
            // The log only grows and a reset replaces all of it, so a position
            // names the same row for as long as the row is there.
            <Turn key={row.at} row={row} onAnswer={(body) => void tell("answer", body)} />
          ))}
          {state.streaming !== "" && <Markdown text={state.streaming} />}
          {running && state.streaming === "" && !asking && <Working />}
        </div>
      </div>

      <Composer
        box={box}
        draft={draft}
        setDraft={setDraft}
        send={(text) => void send(text)}
        onStop={running ? () => void tell("stop") : undefined}
        skills={blank ? [] : SKILLS.map((skill) => skill.name)}
      />
    </section>
  );
}

/** What the pane says before anything is said: who is here, and the two skills as cards. */
function Welcome({ send }: { send: (text: string) => void }) {
  return (
    <div className="flex min-h-[40vh] flex-col justify-center gap-5 py-6">
      <div className="space-y-1">
        <p className="font-serif text-k-23">Claude Code, in your vault</p>
        <p className="text-k-muted">Start a skill, or ask anything below.</p>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        {SKILLS.map(({ name, what }) => (
          <button
            key={name}
            type="button"
            aria-label={name}
            onClick={() => send(name)}
            className="rounded-xl border border-k-rule bg-k-paper px-4 py-3 text-left transition-colors hover:border-k-accent hover:bg-k-accent-wash"
          >
            <span className="block font-mono text-[13px] text-k-accent">{name}</span>
            <span className="block text-[13px] text-k-muted">{what}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

/** A dot and a word for where the session stands, so the header says it without a banner. */
function Status({
  reached,
  running,
  asking,
}: {
  reached: boolean | null;
  running: boolean;
  asking: boolean;
}) {
  const [label, tone] =
    reached === false
      ? ["offline", "bg-k-danger"]
      : asking
        ? ["waiting for you", "bg-k-warn"]
        : running
          ? ["working", "bg-k-accent motion-safe:animate-pulse"]
          : reached
            ? ["ready", "bg-k-ok"]
            : ["connecting", "bg-k-muted"];
  return (
    <span className="flex items-center gap-1.5 text-[12px] text-k-muted">
      <span aria-hidden="true" className={`size-1.5 rounded-full ${tone}`} />
      {label}
    </span>
  );
}
