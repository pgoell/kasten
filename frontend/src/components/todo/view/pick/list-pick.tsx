import { type ReactNode, useEffect, useRef, useState } from "react";
import { Popover } from "@/components/todo/view/pick/popover";

export interface Choice<T> {
  value: T;
  label: string;
  icon?: ReactNode;
}

const STEP: Record<string, number> = { j: 1, ArrowDown: 1, k: -1, ArrowUp: -1 };

/** A short list to pick one from: j and k or the arrows move, Enter or its number picks. */
export function ListPick<T>(props: {
  label: string;
  anchor: HTMLElement | null;
  choices: Choice<T>[];
  current: T;
  onPick: (value: T) => void;
  onClose: () => void;
}) {
  const { choices } = props;
  const [at, setAt] = useState(() =>
    Math.max(
      choices.findIndex((choice) => choice.value === props.current),
      0,
    ),
  );
  const list = useRef<HTMLUListElement>(null);
  useEffect(() => {
    list.current?.querySelectorAll("button")[at]?.focus();
  }, [at]);
  const pick = (index: number) => {
    const choice = choices[index];
    if (choice === undefined) return;
    props.onPick(choice.value);
    props.onClose();
  };
  const onKey = (event: React.KeyboardEvent) => {
    const step = STEP[event.key];
    if (step !== undefined) setAt((now) => (now + step + choices.length) % choices.length);
    else if (/^[1-9]$/.test(event.key)) pick(Number(event.key) - 1);
    else return false;
    return true;
  };

  return (
    <Popover anchor={props.anchor} label={props.label} onClose={props.onClose} onKey={onKey}>
      <ul ref={list} aria-label={props.label}>
        {choices.map((choice, index) => (
          <li key={String(choice.value)}>
            <button
              type="button"
              aria-current={choice.value === props.current || undefined}
              onPointerEnter={() => setAt(index)}
              onClick={() => pick(index)}
              className={`flex h-9 w-full items-center gap-2.5 rounded-md px-2.5 text-left text-[15px] text-k-ink outline-none ${
                index === at ? "bg-k-inset" : ""
              }`}
            >
              {choice.icon}
              <span className="flex-1">{choice.label}</span>
              {choice.value === props.current && <span className="text-k-muted text-sm">now</span>}
              <kbd className="rounded border border-k-rule px-1.5 font-mono text-k-muted text-xs">
                {index + 1}
              </kbd>
            </button>
          </li>
        ))}
      </ul>
    </Popover>
  );
}
