import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useRef, useState } from "react";
import { createNote, fetchFiles, fetchNote } from "@/lib/api";
import { DEFAULT_VIEWS, parseViews, VIEWS_NOTE } from "@/lib/todo-view";

/**
 * What the pane's filter line holds: what was typed, or the saved view `v` has
 * walked to. The views live in a note the vault may not have, so the first
 * press that asks for them may also write it.
 */
export function useTodoFilter() {
  const [typed, setTyped] = useState("");
  /** Whether `v` has been pressed, which is what asks the vault for the views. */
  const [asked, setAsked] = useState(false);
  /** How many times `v` has been pressed. Which view that is, is read below. */
  const [picked, setPicked] = useState(0);
  /** Set as a create goes out, so a second press does not send another. */
  const making = useRef(false);
  const queryClient = useQueryClient();

  // The listing is already in the cache, put there by the route, so this asks
  // whether the vault holds the views note without a request, and without a
  // `try` around a `GET` that would have to tell a missing note from a backend
  // that is down.
  const { data: files } = useQuery({ queryKey: ["files"], queryFn: fetchFiles });
  const missing = files !== undefined && !files.includes(VIEWS_NOTE);

  const { data: note, isFetching: reading } = useQuery({
    queryKey: ["note", VIEWS_NOTE],
    queryFn: () => fetchNote(VIEWS_NOTE),
    // Not on every pane open: most of them never reach a view, and the key is
    // the one the editor reads notes with, so the answer is shared and the
    // route's event handler keeps it fresh.
    enabled: asked && files !== undefined && !missing,
    // A note that is not there is an answer, not a blip.
    retry: false,
  });
  const views = useMemo(() => parseViews(note ?? ""), [note]);

  // Off the count rather than off a stored index: the press that starts the
  // read happens with no views in hand, and this resolves it the moment they
  // arrive. The slot past the last view is no view at all, which is how one
  // more press gives the whole list back.
  const slot = views.length === 0 ? 0 : picked % (views.length + 1);
  const view = slot === 0 ? undefined : views[slot - 1];
  /** What the list is filtered by: the view where one is showing, else what was typed. */
  const line = view?.filter ?? typed;
  // One slot for two answers, which cannot both be true. `no views` is the last
  // resort, for a note holding no line this can read and for a create the vault
  // refused: a key that does nothing and says nothing reads as broken.
  const named = view?.name ?? (asked && !reading && views.length === 0 ? "no views" : undefined);

  /**
   * Write the note the vault has none of, holding the defaults.
   *
   * From the key rather than from a `queryFn`: a write in there runs again on
   * every refetch, and react-query refetches on window focus. `picked` is
   * already 1 by the time this lands, so the press that made the note is the
   * press that shows its first view.
   */
  function makeViews() {
    making.current = true;
    void createNote(VIEWS_NOTE, DEFAULT_VIEWS).then(
      (made) => {
        // What the read would have answered with. It stays disabled until the
        // listing catches up, and a disabled query still reads its cache, so
        // seeding the key is what puts the new views on this press.
        queryClient.setQueryData(["note", VIEWS_NOTE], made.content);
        // The tree gains a note. `/api/events` says so too; this is the braces.
        void queryClient.invalidateQueries({ queryKey: ["files"] });
      },
      () => {
        // The vault refused it. The header says `no views`, and the next press
        // asks again, which is what the flag going back down is for.
        making.current = false;
      },
    );
  }

  return {
    line,
    named,
    files,
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
