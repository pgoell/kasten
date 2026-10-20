import { useState } from "react";
import type { EditorCommands } from "@/lib/key-bindings";
import { heldModifier, leaderAction, leaderPrefix } from "@/lib/leader-keys";

/**
 * The leader sequence a pane reads off its own keys, the way the editor reads
 * its own. `feed` takes a key and says whether the sequence owned it, and
 * `start` opens one with the space.
 */
export function useLeader(commands: EditorCommands) {
  /** The keys of an unfinished leader sequence, starting with the space. */
  const [pending, setPending] = useState("");

  return {
    feed(event: React.KeyboardEvent): boolean {
      const { key } = event;

      // A modifier holds itself down before the key it is held for arrives, and
      // a pending sequence that read it as a key would drop the sequence there.
      if (heldModifier(key)) return true;
      if (!pending) return false;

      const sequence = pending + key;
      const wanted = sequence.slice(1);
      const run = leaderAction(wanted, commands);
      // A leader key can be more than one letter, so a sequence that still
      // prefixes one waits for the rest instead of being dropped.
      setPending(!run && leaderPrefix(wanted) ? sequence : "");

      if (run) {
        event.preventDefault();
        run();
      }
      return true;
    },
    start() {
      setPending(" ");
    },
  };
}
