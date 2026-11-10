import type { ReactNode } from "react";
import { type ChatItem, toolLine } from "@/lib/terminal/chat";
import { Answered, AskForm } from "./ask-form";
import { Markdown } from "./markdown";

type Tool = Extract<ChatItem, { kind: "tool" }>;

/** An item, or a run of tool calls side by side, which read as one step of work. */
type Row = { at: number; item: ChatItem } | { at: number; tools: Tool[] };

/** Consecutive tool calls in one row, so a run reads as text between steps rather than a list of boxes. */
export function rows(items: ChatItem[]): Row[] {
  const out: Row[] = [];
  items.forEach((item, at) => {
    const last = out.at(-1);
    if (item.kind !== "tool") out.push({ at, item });
    else if (last !== undefined && "tools" in last) last.tools.push(item);
    else out.push({ at, tools: [item] });
  });
  return out;
}

export function Turn({ row, onAnswer }: { row: Row; onAnswer: (body: object) => void }) {
  if ("tools" in row) {
    return (
      <div className="space-y-px border-k-rule border-l-2 pl-2">
        {row.tools.map((tool) => (
          <ToolCall key={tool.id} item={tool} />
        ))}
      </div>
    );
  }
  const { item } = row;
  switch (item.kind) {
    case "user":
      return (
        <div className="flex justify-end">
          <p
            className={`max-w-[85%] whitespace-pre-wrap break-words rounded-2xl rounded-br-md bg-k-accent-wash px-3.5 py-2 text-k-ink ${item.text.startsWith("/") ? "font-mono text-[0.9em]" : ""}`}
          >
            {item.text}
          </p>
        </div>
      );
    case "text":
      return <Markdown text={item.text} />;
    case "error":
      return (
        <p className="flex items-start gap-2 whitespace-pre-wrap text-[0.93em] text-k-danger">
          <span aria-hidden="true">●</span>
          {item.text}
        </p>
      );
    case "tool":
      return <ToolCall item={item} />;
    case "ask":
      return item.open ? <AskForm item={item} onAnswer={onAnswer} /> : <Answered item={item} />;
  }
}

/** The vault is where every path starts, so it says nothing on a line this short. */
function shortLine(input: unknown): string {
  return toolLine(input).replace(/^\/vault\//, "");
}

/** One tool call, folded to a line until it is opened. */
function ToolCall({ item }: { item: Tool }) {
  const failed = item.result?.error === true;

  return (
    <details className="group rounded-md text-[12.5px] open:bg-k-paper">
      <summary className="flex cursor-pointer list-none items-center gap-2 rounded-md px-2 py-1 text-k-muted hover:bg-k-surface/70 pointer-coarse:min-h-10 [&::-webkit-details-marker]:hidden">
        <Mark state={item.result === undefined ? "running" : failed ? "failed" : "done"} />
        <span className="shrink-0 font-medium text-k-ink-soft">{item.name}</span>
        <span className="min-w-0 flex-1 truncate font-mono text-[11.5px]">
          {shortLine(item.input)}
        </span>
        <span aria-hidden="true" className="shrink-0 transition-transform group-open:rotate-90">
          ›
        </span>
      </summary>
      <div className="space-y-1 px-2 pt-1 pb-2">
        <Output>{JSON.stringify(item.input, null, 2)}</Output>
        {item.result !== undefined && (
          <Output danger={failed}>{item.result.text || "(no output)"}</Output>
        )}
      </div>
    </details>
  );
}

function Output({ children, danger = false }: { children: ReactNode; danger?: boolean }) {
  return (
    <pre
      className={`max-h-64 overflow-auto whitespace-pre-wrap break-words rounded bg-k-inset px-2 py-1.5 font-mono text-[11.5px] ${danger ? "text-k-danger" : "text-k-ink-soft"}`}
    >
      {children}
    </pre>
  );
}

function Mark({ state }: { state: "running" | "done" | "failed" }) {
  if (state === "running") {
    return (
      <span
        role="img"
        aria-label="running"
        className="size-3 shrink-0 rounded-full border-2 border-k-rule border-t-k-accent motion-safe:animate-spin"
      />
    );
  }
  return (
    <span
      role="img"
      aria-label={state}
      className={`w-3 shrink-0 text-center ${state === "failed" ? "text-k-danger" : "text-k-ok"}`}
    >
      {state === "failed" ? "✗" : "✓"}
    </span>
  );
}

/** Three dots, so a run that is thinking looks alive. Still for anyone who asked for less motion. */
export function Working() {
  return (
    <p className="flex items-center gap-2 text-[0.93em] text-k-muted">
      <span aria-hidden="true" className="flex gap-1">
        {[0, 150, 300].map((delay) => (
          <span
            key={delay}
            style={{ animationDelay: `${delay}ms` }}
            className="size-1.5 rounded-full bg-k-muted motion-safe:animate-pulse"
          />
        ))}
      </span>
      Working…
    </p>
  );
}
