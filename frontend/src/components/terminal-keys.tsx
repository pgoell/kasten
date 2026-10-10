/**
 * The keys a phone keyboard does not have, as a row under the terminal.
 *
 * The row sends what a hardware key would send and nothing else: the bytes
 * are worked out here, and `terminal-pane.tsx` puts them on the same path a
 * typed key takes.
 */

export type TerminalKey =
  | "Esc"
  | "Tab"
  | "Ctrl"
  | "Left"
  | "Down"
  | "Up"
  | "Right"
  | "|"
  | "/"
  | "-";

/** In the order they are drawn. The arrows sit the way vim's `hjkl` does. */
const KEYS: { key: TerminalKey; label: string; name?: string }[] = [
  { key: "Esc", label: "Esc" },
  { key: "Tab", label: "Tab" },
  { key: "Ctrl", label: "Ctrl" },
  { key: "Left", label: "←", name: "Left" },
  { key: "Down", label: "↓", name: "Down" },
  { key: "Up", label: "↑", name: "Up" },
  { key: "Right", label: "→", name: "Right" },
  { key: "|", label: "|" },
  { key: "/", label: "/" },
  { key: "-", label: "-" },
];

const ARROW: Partial<Record<TerminalKey, string>> = { Up: "A", Down: "B", Right: "C", Left: "D" };

/**
 * What a keyboard sends for the punctuation with Ctrl held. `Ctrl+/` and
 * `Ctrl+-` are both the unit separator, which is undo in readline, and
 * `Ctrl+|` is `Ctrl+\`, which is SIGQUIT.
 */
const CTRL_PUNCTUATION: Partial<Record<TerminalKey, string>> = {
  "/": "\x1f",
  "-": "\x1f",
  "|": "\x1c",
};

/**
 * The bytes one key of the row sends.
 *
 * `application` is DECCKM, which vim, less and fzf turn on: the arrows then
 * start with SS3 rather than CSI, and a program that asked for one prints
 * letters when handed the other. A Ctrl arrow is the CSI form with modifier 5
 * in either mode. Ctrl changes nothing about Esc and Tab on a keyboard, so it
 * changes nothing here.
 */
export function keyBytes(
  key: Exclude<TerminalKey, "Ctrl">,
  ctrl: boolean,
  application: boolean,
): string {
  const arrow = ARROW[key];
  if (arrow !== undefined) {
    if (ctrl) return `\x1b[1;5${arrow}`;
    return application ? `\x1bO${arrow}` : `\x1b[${arrow}`;
  }
  if (key === "Esc") return "\x1b";
  if (key === "Tab") return "\t";
  return ctrl ? (CTRL_PUNCTUATION[key] ?? key) : key;
}

/**
 * What a typed character becomes with the row's Ctrl armed.
 *
 * Letters only, which is `Ctrl+C`, `Ctrl+D`, `Ctrl+R` and the rest of what a
 * shell binds. Anything else, a pasted run or an escape sequence included,
 * goes through as it came.
 */
export function withCtrl(data: string): string {
  return /^[a-zA-Z]$/.test(data) ? String.fromCharCode(data.charCodeAt(0) & 0x1f) : data;
}

interface TerminalKeysProps {
  /** Whether Ctrl is armed for the next key. */
  ctrl: boolean;
  onKey: (key: TerminalKey) => void;
}

export function TerminalKeys({ ctrl, onKey }: TerminalKeysProps) {
  return (
    <div
      role="toolbar"
      aria-label="Terminal keys"
      className="flex shrink-0 gap-px bg-one-selection"
    >
      {KEYS.map(({ key, label, name }) => (
        <button
          key={key}
          type="button"
          aria-label={name}
          aria-pressed={key === "Ctrl" ? ctrl : undefined}
          // Out of the tab order and deaf to the press that would focus it: a
          // button that takes the focus takes it off the terminal, and the
          // phone folds the keyboard away under the finger.
          tabIndex={-1}
          onPointerDown={(event) => event.preventDefault()}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => onKey(key)}
          className={`h-11 min-w-0 flex-1 font-mono text-sm ${
            key === "Ctrl" && ctrl ? "bg-one-accent text-one-bg" : "bg-one-bg text-one-fg"
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
