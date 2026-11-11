import type { KeyboardEvent, MouseEvent } from "react";
import type { SearchFlags } from "@/lib/core/api";
import { TAP } from "@/lib/ui/overlay-styles";

/** Each toggle: its flag, its label, what a screen reader calls it, and its Alt key's code. */
const TOGGLES = [
  { flag: "regex", label: ".*", name: "Regular expression", code: "KeyR", key: "Alt+R" },
  { flag: "word", label: "W", name: "Whole word", code: "KeyW", key: "Alt+W" },
] as const;

/**
 * The flag an Alt key toggles, or undefined. Read by `code`, because Option on a Mac types a
 * character, so `key` is `®` there and not `r`.
 */
export function toggleOf(event: KeyboardEvent): keyof SearchFlags | undefined {
  if (!event.altKey || event.ctrlKey || event.metaKey) return undefined;
  return TOGGLES.find((toggle) => toggle.code === event.code)?.flag;
}

/** Tapping does not take the focus from the input: the keys have to keep working after it. */
const keepFocus = (event: MouseEvent) => event.preventDefault();

/** The regex and whole word switches beside the query, each pressed while its flag is on. */
export function SearchToggles({
  flags,
  onToggle,
}: {
  flags: SearchFlags;
  onToggle: (flag: keyof SearchFlags) => void;
}) {
  return (
    <div className="flex shrink-0 gap-1">
      {TOGGLES.map((toggle) => {
        const on = flags[toggle.flag] === true;
        return (
          <button
            key={toggle.flag}
            type="button"
            aria-label={toggle.name}
            aria-pressed={on}
            aria-keyshortcuts={toggle.key}
            title={`${toggle.name} (${toggle.key})`}
            onMouseDown={keepFocus}
            onClick={() => onToggle(toggle.flag)}
            className={`${TAP} flex min-w-9 pointer-coarse:min-w-11 cursor-pointer justify-center rounded-sm border px-2 py-1 font-mono text-k-13 ${on ? "border-k-accent bg-k-surface text-k-accent" : "border-k-rule text-k-muted"}`}
          >
            {toggle.label}
          </button>
        );
      })}
    </div>
  );
}
