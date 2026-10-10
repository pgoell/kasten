import type { EditorCommands, LeaderCommand } from "@/lib/key-bindings";
import { LABEL } from "@/lib/overlay-styles";

/**
 * The commands a thumb reaches for, in the order they are drawn.
 *
 * Each names a command the leader already reaches and nothing else, so the
 * row adds no behaviour of its own. `name` is what a screen reader says, the
 * word on the button being cut to what fits seven across a phone.
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
];

interface ToolbarProps {
  commands: EditorCommands;
  /** Whether the tab holds more than one pane, which is when there is a next one. */
  split: boolean;
  /** Out of reach, which the route asks for under the open drawer. */
  inert?: boolean;
}

/**
 * The row along the bottom edge of a phone, standing in for the leader key.
 *
 * It stays on screen while the keyboard is up. The palette lists a note's
 * inserts and edits only when it opens over that note's editor, so the button
 * has to be reachable while the editor holds the focus, and hiding the row
 * whenever something is being typed into would hide it at exactly that moment.
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
      className={`flex shrink-0 gap-px border-one-line border-t bg-one-panel ${LABEL}`}
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
          className="min-h-11 min-w-11 flex-1 uppercase active:bg-one-hover active:text-one-accent"
        >
          {label}
        </button>
      ))}
    </div>
  );
}
