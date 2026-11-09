import { type KeyboardEvent, useEffect, useRef } from "react";
import { TimersRow } from "@/lib/app/push/timers-row";
import type { EditorCommands } from "@/lib/ui/keys/key-bindings";
import { useLeader } from "@/lib/ui/keys/use-leader";

/**
 * The Timers tab: the same timers the Today screen shows, in a pane of their own that the
 * phone's toolbar reaches in one tap. The leader works inside, and `i` goes to the name field.
 */
export function TimersPane({
  commands,
  focusSignal,
}: {
  commands: EditorCommands;
  focusSignal: number;
}) {
  const panel = useRef<HTMLElement>(null);
  const leader = useLeader(commands);

  // The panel and not the field, so opening the tab raises no keyboard on a phone.
  useEffect(() => {
    if (focusSignal) panel.current?.focus();
  }, [focusSignal]);

  function onKeyDown(event: KeyboardEvent) {
    if ((event.target as Element).closest("input, button") !== null) {
      if (event.key === "Escape") panel.current?.focus();
      return;
    }
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (leader.feed(event)) return;
    if (event.key === " ") {
      leader.start(event);
      event.preventDefault();
      return;
    }
    if (event.key === "i") {
      event.preventDefault();
      panel.current?.querySelector("input")?.focus();
    }
  }

  return (
    <section
      ref={panel}
      tabIndex={-1}
      onKeyDown={onKeyDown}
      aria-label="timers pane"
      className="h-full overflow-y-auto bg-k-bg outline-none"
    >
      <div className="mx-auto w-full max-w-[720px] px-4 pb-6 md:px-12">
        <TimersRow />
      </div>
    </section>
  );
}
