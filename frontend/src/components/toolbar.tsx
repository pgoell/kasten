import type { EditorCommands, LeaderCommand } from "@/lib/ui/keys/key-bindings";
import { LABEL } from "@/lib/ui/overlay-styles";

/**
 * The thumb row's commands. Each is a leader command with no behaviour of its own.
 * `name` is what a screen reader says, since the button shows a cut word.
 */
const BUTTONS: readonly { command: LeaderCommand; label: string; name: string }[] = [
  { command: "toggleTree", label: "files", name: "File tree" },
  { command: "findNote", label: "find", name: "Find a note" },
  { command: "openDaily", label: "today", name: "Open today's note" },
  // The pane and not the overlay `findTodos` opens: the pane is the one with
  // buttons a finger can cycle and add with. The overlay is a palette row.
  { command: "openTodos", label: "todos", name: "Open the todo pane" },
  { command: "openChat", label: "chat", name: "Open the chat with Claude Code" },
  // One row only. Search, log and timers are palette rows, one tap on `run` away.
  { command: "openPalette", label: "run", name: "Run a command by name" },
];

/** The look every button of the row shares, a finger's 44px square among them. */
const KEY =
  "min-h-11 min-w-11 flex-1 uppercase tabular-nums active:bg-k-surface active:text-k-accent";

interface ToolbarProps {
  commands: EditorCommands;
  /** "1/2" while the tab holds more than one pane, shown on the button that moves to the next. */
  pane?: string;
  /** Out of reach, which the route asks for under the open drawer. */
  inert?: boolean;
}

/**
 * The row along a phone's bottom edge, standing in for the leader key. It stays up while
 * the keyboard is open: the palette opens over an editor, so the button must stay reachable there.
 */
export function Toolbar({ commands, pane, inert }: ToolbarProps) {
  const buttons =
    pane === undefined
      ? BUTTONS
      : [...BUTTONS, { command: "nextPane" as const, label: pane, name: "Move to the next pane" }];

  return (
    <div
      role="toolbar"
      aria-label="Commands"
      inert={inert}
      // Always the page foot where drawn, so it takes the home indicator's inset.
      className={`safe-foot flex shrink-0 gap-px border-k-rule border-t bg-k-paper ${LABEL}`}
    >
      {buttons.map(({ command, label, name }) => (
        <button
          key={command}
          type="button"
          aria-label={name}
          // Out of the tab order and deaf to the press that would focus it,
          // the way the terminal's key row is. The palette reads the focused
          // element to find the editor it opened over, and a keyboard that is
          // up should not fold away because a pane was changed.
          tabIndex={-1}
          onPointerDown={(event) => event.preventDefault()}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => commands[command]()}
          className={KEY}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
