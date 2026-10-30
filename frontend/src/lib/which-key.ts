import type { EditorView } from "@codemirror/view";
import { LEADER_EDITS } from "@/lib/editor/buffer-keys";
import type { EditorCommands } from "@/lib/key-bindings";
import { leaderAction, leaderPrefix } from "@/lib/leader-keys";

/**
 * Where a pane hands Space once it has read it as the leader. Each pane knows what the panel
 * does not, such as the tree's cursor folder or the editor's buffer, so the pane says what runs.
 */
export interface LeaderOpener {
  /** What had the focus when Space was pressed. The panel gives it back there. */
  from: Element | null;
  /** What the keys typed after Space run, or null while they run nothing. */
  resolve(typed: string): (() => void) | null;
  /** Whether more keys could still finish the sequence. */
  prefix(typed: string): boolean;
  /** Rows beside `LEADER` this opener runs: the editor's buffer edits. */
  edits?: readonly { key: string; label: string }[];
}

type Host = (opener: LeaderOpener) => void;

let host: Host | null = null;

/** Mounts the panel as the one place Space goes. Returns the unmount. */
export function hostLeader(next: Host): () => void {
  host = next;
  return () => {
    if (host === next) host = null;
  };
}

/** Hands the leader to the panel. False when none is mounted; the pane then keeps its own keys. */
export function beginLeader(opener: LeaderOpener): boolean {
  if (host === null) return false;
  host(opener);
  return true;
}

/** The opener of a pane holding no buffer. */
export function paneOpener(commands: EditorCommands, from?: Element | null): LeaderOpener {
  return {
    from: from ?? document.activeElement,
    resolve: (typed) => leaderAction(typed, commands),
    prefix: leaderPrefix,
  };
}

/** The editor's opener: the leader, and the edits that write to this view. */
export function editorOpener(view: EditorView, commands: EditorCommands): LeaderOpener {
  return {
    from: document.activeElement,
    resolve: (typed) => {
      const edit = LEADER_EDITS.find((each) => each.key === typed);
      if (edit) return () => edit.run(view);
      return leaderAction(typed, commands);
    },
    prefix: (typed) =>
      leaderPrefix(typed) || LEADER_EDITS.some((each) => each.key.startsWith(typed)),
    edits: LEADER_EDITS,
  };
}
