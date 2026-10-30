import { useState } from "react";
import type { EditorCommands } from "@/lib/key-bindings";
import { heldModifier, leaderAction, leaderPrefix } from "@/lib/leader-keys";
import { beginLeader, paneOpener } from "@/lib/which-key";

/** A leader sequence a pane reads off its own keys, as the editor does. */
export function useLeader(commands: EditorCommands) {
  const [pending, setPending] = useState("");

  return {
    feed(event: React.KeyboardEvent): boolean {
      const { key } = event;

      // A held modifier comes before its key; read as a key, it would drop the sequence.
      if (heldModifier(key)) return true;
      if (!pending) return false;

      const sequence = pending + key;
      const wanted = sequence.slice(1);
      const run = leaderAction(wanted, commands);
      // A leader key can be several letters, so a prefix waits instead of dropping.
      setPending(!run && leaderPrefix(wanted) ? sequence : "");

      if (run) {
        event.preventDefault();
        run();
      }
      return true;
    },
    start(event: React.KeyboardEvent) {
      if (beginLeader(paneOpener(commands))) {
        event.preventDefault();
        return;
      }
      setPending(" ");
    },
  };
}
