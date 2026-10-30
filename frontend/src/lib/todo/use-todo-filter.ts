import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useRef, useState } from "react";
import { createNote, fetchFiles, fetchNote } from "@/lib/api";
import { DEFAULT_VIEWS, parseViews, VIEWS_NOTE } from "@/lib/todo/todo-view";

/** Whether the shared lists are shown, kept per device. Off unless stored as on. */
export const SHARED_KEY = "kasten.todos.shared";

/**
 * Whether shared lists were shown last time. A browser with site data blocked
 * throws a `SecurityError` on any touch of `localStorage`, and that reads as
 * hidden, the default, as `theme.ts` reads its own choice.
 */
function sharedStored(): boolean {
  try {
    return localStorage.getItem(SHARED_KEY) === "1";
  } catch (error) {
    if (error instanceof DOMException) return false;
    throw error;
  }
}

/** Keeps the choice. Hidden is no entry at all, so a stray value never reads as shown. */
function keepShared(shown: boolean): void {
  try {
    if (shown) localStorage.setItem(SHARED_KEY, "1");
    else localStorage.removeItem(SHARED_KEY);
  } catch (error) {
    // Refused, so the toggle still does what it was asked for, in memory alone.
    if (!(error instanceof DOMException)) throw error;
  }
}

/**
 * The filter line: what was typed, or the saved view `v` has walked to. The views
 * note may be missing, so the first `v` may also write it.
 */
export function useTodoFilter() {
  const [typed, setTyped] = useState("");
  /** The kind chip pressed, or null for All. Not kept: a chip is a look at the list, not a setting. */
  const [kind, setKind] = useState<string | null>(null);
  /** Read once at mount, so the toggle is the one that writes it from then on. */
  const [shared, setShared] = useState(sharedStored);
  /** Whether `v` has been pressed, which is what asks the vault for the views. */
  const [asked, setAsked] = useState(false);
  /** How many times `v` has been pressed. Which view that is, is read below. */
  const [picked, setPicked] = useState(0);
  /** Set as a create goes out, so a second press does not send another. */
  const making = useRef(false);
  const queryClient = useQueryClient();

  // Cached by the route, so this costs no request. A try around the GET could not
  // tell a missing note from a backend that is down.
  const { data: files } = useQuery({ queryKey: ["files"], queryFn: fetchFiles });
  const missing = files !== undefined && !files.includes(VIEWS_NOTE);

  const { data: note, isFetching: reading } = useQuery({
    queryKey: ["note", VIEWS_NOTE],
    queryFn: () => fetchNote(VIEWS_NOTE),
    // Not on every open: the editor reads this key too, and the route keeps it fresh.
    enabled: asked && files !== undefined && !missing,
    // A note that is not there is an answer, not a blip.
    retry: false,
  });
  const views = useMemo(() => parseViews(note ?? ""), [note]);

  // Counted, not stored as an index, so the press that starts the read resolves once
  // the views arrive. The slot past the last is no view: one more press shows the whole list.
  const slot = views.length === 0 ? 0 : picked % (views.length + 1);
  const view = slot === 0 ? undefined : views[slot - 1];
  /** What the list is filtered by: the view where one is showing, else what was typed. */
  const line = view?.filter ?? typed;
  // One slot, two answers that cannot both be true. `no views` covers a note with no
  // readable line and a refused create, where a dead key would read as broken.
  const named = view?.name ?? (asked && !reading && views.length === 0 ? "no views" : undefined);

  /**
   * Writes the views note the vault lacks. From the key, not a `queryFn`: a refetch
   * would write again, and react-query refetches on window focus.
   */
  function makeViews() {
    making.current = true;
    void createNote(VIEWS_NOTE, DEFAULT_VIEWS).then(
      (made) => {
        // Seeding the key shows the new views on this press: a disabled query still reads its cache.
        queryClient.setQueryData(["note", VIEWS_NOTE], made.content);
        void queryClient.invalidateQueries({ queryKey: ["files"] });
      },
      () => {
        // The vault refused. The flag comes down, so the next press asks again.
        making.current = false;
      },
    );
  }

  return {
    line,
    named,
    files,
    kind,
    setKind,
    shared,
    /** The toggle: the shared lists shown or hidden, kept for the next visit. */
    toggleShared() {
      const next = !shared;
      setShared(next);
      keepShared(next);
    },
    type(value: string) {
      setTyped(value);
      setPicked(0);
    },
    /** `v`: the next view, writing the note first where the vault has none. */
    nextView() {
      setAsked(true);
      setPicked(picked + 1);
      if (missing && !making.current) makeViews();
    },
  };
}
