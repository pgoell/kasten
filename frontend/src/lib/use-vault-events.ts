import { type QueryClient, useQueryClient } from "@tanstack/react-query";
import { type RefObject, useEffect } from "react";
import { pageWritten } from "@/lib/html/page-written";
import { LOG_NOTE, MODEL_USE_FOLDER } from "@/lib/layout";
import { reloadLogConfig } from "@/lib/log/log-card";
import type { useAutosave } from "@/lib/note/use-autosave";
import { dailyDate, weeklyWeek, yearlyYear } from "@/lib/periodic";
import { pressEcho } from "@/lib/todo/todo-press-echo";
import { parseVaultEvent, type VaultEvent } from "@/lib/vault-events";

type Autosave = ReturnType<typeof useAutosave>;
type FocusedNote = { path: string | undefined } & Pick<
  Autosave,
  "reconcile" | "isWriting" | "isConflicted"
>;

/** Every note in a listing, sorted and joined, so two answers compare with `!==`. */
function listingOf(paths: string[] | undefined): string | undefined {
  return paths?.slice().sort().join("\n");
}

/** The daily notes in a listing, sorted and joined for `!==`. Undefined without a listing. */
function dailySet(paths: string[] | undefined): string | undefined {
  return paths
    ?.filter((path) => dailyDate(path) !== null)
    .sort()
    .join("\n");
}

/** A note written: its query, the todos and the graph. */
function refreshWritten(
  queryClient: QueryClient,
  event: VaultEvent,
  focused: FocusedNote,
  onDeclined: () => void,
): void {
  const { path, reconcile, isConflicted } = focused;
  // reconcile also says yes for a conflicted note (#269), whose diff needs a fresh read.
  const conflicted = event.path === path && isConflicted();
  if (event.path !== path || reconcile()) {
    queryClient.invalidateQueries({ queryKey: ["note", event.path] }, { cancelRefetch: false });
    if (conflicted) onDeclined();
  } else {
    onDeclined();
  }
  // Todos reach the pane without a reload, but not the echo of its own press (the digest
  // tells it apart). The answer comes a turn later, hence the promise.
  void pressEcho(event.path, event.digest).then((echo) => {
    if (echo) return;
    queryClient.invalidateQueries({ queryKey: ["todos"] }, { cancelRefetch: false });
  });
  // Any write can move a link, so the graph asks again; background graphs just go stale.
  queryClient.invalidateQueries({ queryKey: ["graph"] }, { cancelRefetch: false });
}

/** The caches keyed on a written or removed note's path, so other autosaves walk nothing. */
function refreshByPath(queryClient: QueryClient, path: string): void {
  // The log's totals come from daily notes, its kinds and goals from log.md.
  if (dailyDate(path) !== null || path === LOG_NOTE) {
    queryClient.invalidateQueries({ queryKey: ["log"] }, { cancelRefetch: false });
  }
  // Review notes carry tags and projects other notes change. Yearly and weekly are skipped.
  if (yearlyYear(path) === null && weeklyWeek(path) === null) {
    queryClient.invalidateQueries({ queryKey: ["written-notes"] }, { cancelRefetch: false });
  }
  // The collector writes monthly notes from outside kasten; only the watcher sees them change.
  if (path.startsWith(`${MODEL_USE_FOLDER}/`)) {
    queryClient.invalidateQueries({ queryKey: ["model-use"] }, { cancelRefetch: false });
  }
}

/** log.md changed: its readers that the steps above do not reach. */
function refreshLogNote(queryClient: QueryClient, change: VaultEvent["change"]): void {
  // A removal refetches no note, so log.md readers keep stale text. A write reaches it above.
  if (change === "removed") {
    queryClient.invalidateQueries({ queryKey: ["note", LOG_NOTE] }, { cancelRefetch: false });
  }
  // The palette and cards read log.md through their own store, not the note query.
  if (change === "written" || change === "removed") reloadLogConfig();
}

/** One event off the stream: the caches it makes stale, in the order they are asked again. */
function onVaultEvent(
  queryClient: QueryClient,
  event: VaultEvent,
  focused: FocusedNote,
  onDeclined: () => void,
): void {
  // A rewritten html page goes to the panes showing it only: no note cache holds it.
  if (event.change === "page") {
    pageWritten(event.path);
    return;
  }

  // A note on screen may hold text the vault moved past, so its query refetches. The focused
  // pane is asked first: a refusal means it holds unsaved edits a reload would wipe.
  if (event.change === "written") {
    refreshWritten(queryClient, event, focused, onDeclined);
  } else {
    // A moved folder or deleted note changes no todo line, but can change its project.
    queryClient.invalidateQueries({ queryKey: ["todos"] }, { cancelRefetch: false });
  }

  // The early return skips writes to notes the tree already draws, standing in for the
  // missing `added` kind. Its listing can be stale; dropping it refetches per autosave.

  // Only a `listing` changes images (a paste, a dropped file, a folder move, a book).
  // Keyed on the kind, so an autosaving vault does not walk twice per save.
  if (event.change === "listing") {
    queryClient.invalidateQueries({ queryKey: ["images"] }, { cancelRefetch: false });
    queryClient.invalidateQueries({ queryKey: ["html"] }, { cancelRefetch: false });
    queryClient.invalidateQueries({ queryKey: ["assets"] }, { cancelRefetch: false });
  }

  // Any write can add a tag, even one the early return skips. One rg pass is the price.
  queryClient.invalidateQueries({ queryKey: ["tags"] }, { cancelRefetch: false });

  if (event.change === "written" || event.change === "removed") {
    refreshByPath(queryClient, event.path);
  }
  const paths = queryClient.getQueryData<string[]>(["files"]);
  if (event.path === LOG_NOTE) refreshLogNote(queryClient, event.change);

  if (event.change === "written" && paths?.includes(event.path)) return;
  queryClient.invalidateQueries({ queryKey: ["files"] }, { cancelRefetch: false });
}

/** Keeps the caches the route reads in step with the vault, over the page's event stream. */
export function useVaultEvents(focusedNote: RefObject<FocusedNote>, onDeclined: () => void): void {
  const queryClient = useQueryClient();
  // Opened by hand: a StreamingResponse has no schema for openapi-fetch. One stream per page.
  useEffect(() => {
    const stream = new EventSource("/api/events");
    // A daily-folder move sends a `listing` without a path, so the answer must say the
    // log is stale. Read the cache, not the refetch, which may join a walk older than the move.
    let dailies = dailySet(queryClient.getQueryData<string[]>(["files"]));
    // The overview counts notes by day; the listing shows a made, removed or moved note first.
    let listed = listingOf(queryClient.getQueryData<string[]>(["files"]));
    const unsubscribe = queryClient.getQueryCache().subscribe((cacheEvent) => {
      if (cacheEvent.type !== "updated" || cacheEvent.action.type !== "success") return;
      if (cacheEvent.query.queryKey[0] !== "files") return;
      const answer = cacheEvent.query.state.data as string[] | undefined;
      const next = dailySet(answer);
      if (dailies !== undefined && next !== dailies) {
        queryClient.invalidateQueries({ queryKey: ["log"] }, { cancelRefetch: false });
      }
      dailies = next;
      const nowListed = listingOf(answer);
      if (listed !== undefined && nowListed !== listed) {
        queryClient.invalidateQueries({ queryKey: ["written"] }, { cancelRefetch: false });
        queryClient.invalidateQueries({ queryKey: ["written-notes"] }, { cancelRefetch: false });
      }
      listed = nowListed;
    });
    // Every open, the first included: a reconnect can miss writes the backend never replays.
    // At mount this joins the query's first fetch (cancelRefetch off), so it costs nothing.
    stream.onopen = () => {
      queryClient.invalidateQueries({ queryKey: ["files"] }, { cancelRefetch: false });
      queryClient.invalidateQueries({ queryKey: ["log"] }, { cancelRefetch: false });
      reloadLogConfig();
    };
    stream.onmessage = (message) => {
      const event = parseVaultEvent(message.data);
      if (event !== null) onVaultEvent(queryClient, event, focusedNote.current, onDeclined);
    };
    return () => {
      stream.close();
      unsubscribe();
    };
  }, [queryClient, focusedNote, onDeclined]);
}
