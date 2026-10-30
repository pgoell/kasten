import type { EditorCommands, LeaderCommand } from "@/lib/key-bindings";
import { LABEL } from "@/lib/overlay-styles";
import { leaderFromFocus } from "@/lib/use-key-help-key";

/**
 * The thumb row's commands. Each is a leader command with no behaviour of its own.
 * `name` is what a screen reader says, since the button shows a cut word.
 */
const BUTTONS: readonly { command: LeaderCommand; label: string; name: string }[] = [
  { command: "toggleTree", label: "files", name: "File tree" },
  { command: "findNote", label: "find", name: "Find a note" },
  { command: "searchNotes", label: "search", name: "Search note content" },
  { command: "openPalette", label: "run", name: "Run a command by name" },
  { command: "openDaily", label: "today", name: "Open today's note" },
  // The pane and not the overlay `findTodos` opens: the pane is the one with
  // buttons a finger can cycle and add with. The overlay is a palette row.
  { command: "openTodos", label: "todos", name: "Open the todo pane" },
  { command: "openLog", label: "log", name: "Open the log" },
  // The reason the chat exists: a skill started with a thumb. Eight across a
  // 360px phone is 45px each, one over the 44 a button has to be. Nine at 44px
  // fit neither 360 nor 390, so the row wraps and the ninth goes to a second
  // row rather than off the screen.
  { command: "openChat", label: "chat", name: "Open the chat with Claude Code" },
];

/** The look every button of the row shares, a finger's 44px square among them. */
const KEY = "min-h-11 min-w-11 flex-1 uppercase active:bg-k-surface active:text-k-accent";

interface ToolbarProps {
  commands: EditorCommands;
  /** Whether the tab holds more than one pane, which is when there is a next one. */
  split: boolean;
  /** Out of reach, which the route asks for under the open drawer. */
  inert?: boolean;
}

/**
 * The row along a phone's bottom edge, standing in for the leader key. It stays up while
 * the keyboard is open: the palette opens over an editor, so the button must stay reachable there.
 */
export function Toolbar({ commands, split, inert }: ToolbarProps) {
  const buttons = split
    ? [...BUTTONS, { command: "nextPane" as const, label: "pane", name: "Move to the next pane" }]
    : BUTTONS;

  return (
    <div
      role="toolbar"
      aria-label="Commands"
      inert={inert}
      // Always the page foot where drawn, so it takes the home indicator's inset.
      className={`safe-foot flex shrink-0 flex-wrap gap-px border-k-rule border-t bg-k-paper ${LABEL}`}
    >
      <button
        type="button"
        aria-label="Show the leader keys"
        // Same press handling as the rest, so the panel opens over the editor.
        tabIndex={-1}
        onPointerDown={(event) => event.preventDefault()}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => leaderFromFocus(commands)}
        className={KEY}
      >
        space
      </button>
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
