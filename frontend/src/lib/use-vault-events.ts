import { useQueryClient } from "@tanstack/react-query";
import { type RefObject, useEffect } from "react";
import { dailyDate } from "@/lib/periodic";
import type { useAutosave } from "@/lib/use-autosave";
import { parseVaultEvent } from "@/lib/vault-events";

type Autosave = ReturnType<typeof useAutosave>;

/**
 * Keep the caches the route reads in step with the vault, by the event stream
 * the backend holds open for the life of the page.
 */
export function useVaultEvents(
  focusedNote: RefObject<
    { path: string | undefined } & Pick<Autosave, "reconcile" | "isWriting" | "isConflicted">
  >,
  onDeclined: () => void,
): void {
  const queryClient = useQueryClient();
  // The vault is the source of truth, so a note written by an agent or an ssh
  // session is as real as one written here. `/api/events` says what moved and
  // the tree refetches itself.
  //
  // Opened by hand rather than through `openapi-fetch`: the endpoint answers
  // with a `StreamingResponse`, which carries no schema, so `api-types.ts` has
  // no entry to generate a client from. Nothing retries either, because
  // `EventSource` reconnects on its own.
  //
  // `queryClient` never changes identity, so this opens one stream for the
  // life of the page rather than one per note you read.
  useEffect(() => {
    const stream = new EventSource("/api/events");
    // Every open, the first one included. A stream that went down and came
    // back missed whatever the vault did in between: the backend replays
    // nothing and `EventSource` reconnects without saying it ever stopped,
    // which a sleeping laptop or a backend restart guarantees. Asking for the
    // listing on each open closes that hole by construction. Do not trim it
    // back to the reconnects, because there is no way to tell them apart here
    // and the gap comes back with the optimisation.
    //
    // At mount this usually beats the query's own first fetch, and with
    // `cancelRefetch` off it joins that fetch rather than replacing it, so the
    // redundant open costs nothing and the first paint waits on one walk of
    // the vault rather than two.
    stream.onopen = () =>
      queryClient.invalidateQueries({ queryKey: ["files"] }, { cancelRefetch: false });
    stream.onmessage = (message) => {
      const event = parseVaultEvent(message.data);
      if (event === null) return;

      // A note on screen is holding text the vault has moved past, so the query
      // behind it refetches and the editor takes what comes back. Which panes
      // hold the note is not asked: `invalidateQueries` refetches the queries
      // somebody is observing and only marks the rest stale, which is what a
      // note in a background tab wants anyway. A `removed` needs no refetch,
      // there being nothing left to read, and the pane keeps what it has. A
      // `listing` names no note at all.
      //
      // The focused pane is asked first, and it is the only pane that can be
      // asked: it is the one the keys reach, so it is the only one that can be
      // holding text nobody has written yet. A refusal there means the reader's
      // own edits are on screen and the reload would take them off it.
      if (event.change === "written") {
        const { path, reconcile, isConflicted } = focusedNote.current;
        // `reconcile` says yes to a conflicted note too (#269), whose bar's
        // diff still wants the vault read again.
        const conflicted = event.path === path && isConflicted();
        if (event.path !== path || reconcile()) {
          queryClient.invalidateQueries(
            { queryKey: ["note", event.path] },
            { cancelRefetch: false },
          );
          if (conflicted) onDeclined();
        } else {
          onDeclined();
        }
        // A todo written by an agent or over ssh reaches the pane without a
        // reload. Ahead of the early return below, which fires for a write to
        // a note the tree already draws, and that is most writes. `cancelRefetch`
        // off for the reason the two invalidations beside it have it off.
        queryClient.invalidateQueries({ queryKey: ["todos"] }, { cancelRefetch: false });
        // A link or a relation is a line of a note, so any write can move an
        // edge. Only a graph on screen is asked again, the rest marked stale.
        queryClient.invalidateQueries({ queryKey: ["graph"] }, { cancelRefetch: false });
      } else {
        // A folder moved or a note deleted changes no todo line, but it can
        // change the project the backend files one under: a link that lands in
        // the folder, or the folder the note sits in. The board's lanes are
        // that answer, so they would stay on the old folder until the next write.
        queryClient.invalidateQueries({ queryKey: ["todos"] }, { cancelRefetch: false });
      }

      // A write to a note the tree already draws changes no row, and this is
      // the test that stands in for the `added` kind the backend deliberately
      // has none of. Read out of the cache rather than off `data` above: the
      // listing is already in there, and depending on it here would close and
      // reopen the stream every time it changed.
      //
      // The listing read here can be known-wrong, and it is left that way. An
      // external delete invalidates, and if the note comes back before that
      // refetch answers, the `written` tests against the array from before it
      // and returns early, so the refetch lands without the note and the tree
      // stays short a row until the next event that changes the listing. It
      // takes two debounce windows inside one `/api/files` round trip, which is
      // narrow on local disk and heals itself. Dropping the early return would
      // close it and refetch the whole listing on every autosave instead, and
      // what that listing costs is the subject of
      // docs/reference/ranking-performance.md.
      //
      // `cancelRefetch` off for the reason it is off above, and here it is the
      // one that decides what a busy vault costs. An agent writing forty notes
      // sends one batch, which arrives as forty-one messages and forty-one
      // tasks, each testing against a listing the refetch has not replaced yet.
      // On the default every one of them would cancel the last and start again,
      // and because `fetchFiles` carries no `AbortSignal` the server walks the
      // whole vault forty-one times regardless. Off, the first walk answers all
      // of them, which is what the backend's own debounce is for.

      // A `listing` is the backend saying something that is not a note changed,
      // which is the only thing that can change the images: one pasted here or
      // dropped in over a terminal, a folder moved, a book uploaded. Keyed on
      // the kind rather than invalidated beside the listing below, so a vault
      // somebody is writing notes in does not walk itself twice per save for an
      // answer that cannot have changed. Above the early return because it is
      // not that return's business, though a `listing` never reaches it.
      if (event.change === "listing") {
        queryClient.invalidateQueries({ queryKey: ["images"] }, { cancelRefetch: false });
        queryClient.invalidateQueries({ queryKey: ["html"] }, { cancelRefetch: false });
        queryClient.invalidateQueries({ queryKey: ["assets"] }, { cancelRefetch: false });
      }

      // A tag is a word inside a note, so any write can change the vocabulary,
      // including the writes the early return below walks past. It costs one rg
      // pass over the matches, which is the shape of scan the review pane
      // already runs per rating, and a completion that cannot offer the tag you
      // invented an hour ago would not be worth having.
      queryClient.invalidateQueries({ queryKey: ["tags"] }, { cancelRefetch: false });

      // The log pane's totals are read off the daily notes, so a write to one, or
      // its removal, asks the log again. Keyed on the path because the log is not
      // only read while its pane is up, and every autosave of another note sends
      // an event that must not walk the whole log.
      if (
        (event.change === "written" || event.change === "removed") &&
        dailyDate(event.path) !== null
      ) {
        queryClient.invalidateQueries({ queryKey: ["log"] }, { cancelRefetch: false });
      }

      const paths = queryClient.getQueryData<string[]>(["files"]);
      if (event.change === "written" && paths?.includes(event.path)) return;
      queryClient.invalidateQueries({ queryKey: ["files"] }, { cancelRefetch: false });
    };
    return () => stream.close();
  }, [queryClient, focusedNote, onDeclined]);
}
