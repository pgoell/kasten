import { useState } from "react";
import { answersFor, type ChatItem, type Pick } from "@/lib/terminal/chat";

/** The one action a moment asks for. `min-h-11` under a finger is the 44px the phone toolbar holds to. */
const PRIMARY =
  "inline-flex shrink-0 items-center justify-center gap-1 rounded-lg bg-k-accent px-3 py-1.5 font-medium text-[13px] text-k-paper transition-opacity hover:opacity-90 disabled:opacity-35 pointer-coarse:min-h-11 pointer-coarse:px-4 pointer-coarse:text-sm";

type Ask = Extract<ChatItem, { kind: "ask" }>;

/** A question the run is waiting on: Claude's options as rows to tap, and a field for anything else. */
export function AskForm({ item, onAnswer }: { item: Ask; onAnswer: (body: object) => void }) {
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
      data-open-ask=""
      className="space-y-4 rounded-xl border border-k-accent/40 bg-k-paper p-4 shadow-sm"
      onSubmit={(event) => {
        event.preventDefault();
        if (answers !== undefined) onAnswer({ id: item.id, answers });
      }}
    >
      {item.questions.map(({ question, header, options, multiSelect }) => {
        const held = picks[question];
        return (
          <fieldset key={question} className="space-y-2">
            <legend className="mb-2 space-y-1">
              <span className="block font-medium text-[11px] text-k-accent uppercase tracking-k-label">
                {header}
                {multiSelect && <span className="text-k-muted normal-case"> · pick any</span>}
              </span>
              <span className="block font-medium">{question}</span>
            </legend>
            {options.map(({ label, description }) => {
              const checked = held?.labels.includes(label) ?? false;
              return (
                <label
                  key={label}
                  className={`flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-2 transition-colors pointer-coarse:min-h-11 ${
                    checked
                      ? "border-k-accent bg-k-accent-wash"
                      : "border-k-rule hover:border-k-muted hover:bg-k-surface/60"
                  }`}
                >
                  <input
                    type={multiSelect ? "checkbox" : "radio"}
                    // The item's id too: two questions in one run can share their text.
                    name={`${item.id}:${question}`}
                    checked={checked}
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
                    className="mt-1 shrink-0 accent-k-accent"
                  />
                  <span className="min-w-0">
                    <span className="block">{label}</span>
                    {description !== "" && (
                      <span className="block text-[0.87em] text-k-muted">{description}</span>
                    )}
                  </span>
                </label>
              );
            })}
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
              placeholder="Something else…"
              autoComplete="off"
              className="w-full rounded-lg border border-k-rule border-dashed bg-transparent px-3 py-2 text-k-ink outline-none placeholder:text-k-muted focus:border-k-accent focus:border-solid pointer-coarse:min-h-11 pointer-coarse:text-base"
            />
          </fieldset>
        );
      })}
      <div className="flex justify-end">
        <button type="submit" className={PRIMARY} disabled={answers === undefined}>
          Answer
        </button>
      </div>
    </form>
  );
}

/** A question that is over: what was asked and what was said. */
export function Answered({ item }: { item: Ask }) {
  return (
    <dl className="space-y-2 rounded-xl border border-k-rule px-4 py-3 text-[0.93em]">
      {item.questions.map(({ question }) => (
        <div key={question}>
          <dt className="text-k-muted">{question}</dt>
          <dd
            className={item.answers?.[question] ? "font-medium text-k-ink" : "text-k-muted italic"}
          >
            {item.answers?.[question] ?? "Not answered"}
          </dd>
        </div>
      ))}
    </dl>
  );
}
