import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { fetchFiles, fetchNote } from "@/lib/api";
import { proposeFolder, type TriageFolder } from "@/lib/chat";
import { type EditorCommands, heldModifier, leaderAction, leaderPrefix } from "@/lib/key-bindings";
import { ARCHIVE, INBOX, ONTOLOGY_NOTE, PERIODIC } from "@/lib/layout";
import { dropTarget, moveAndCache } from "@/lib/move";
import { inboxNotes, vaultFolders } from "@/lib/triage";

interface TriagePaneProps {
  /** What a leader sequence reaches. The same object every other pane is given. */
  commands: EditorCommands;
  /** Close the pane, which is `q`. */
  onClose: () => void;
  /** Open a note in a pane, which is `o`. */
  onOpen: (path: string) => void;
  /** Raised after a move, with where the note was and where it landed, so every other pane can follow. */
  onMoved: (from: string, to: string) => void;
  /** Raised when the pane this sits in has been moved to. See `Editor`. */
  focusSignal?: number;
}

/**
 * The note on screen, its text, and the folder the agent proposes for it.
 *
 * Asked for twice by the pane: once for the note on screen and once for the
 * next, so the next proposal is already there when `j` reaches it. The second
 * call is the reason this is a hook and not inline queries, which would
 * otherwise be written out twice.
 */
function useProposal(
  path: string | undefined,
  folders: TriageFolder[],
  ontology: string | undefined,
) {
  const note = useQuery({
    queryKey: ["note", path],
    queryFn: () => fetchNote(path as string),
    enabled: path !== undefined,
  });
  const content = note.data;
  const ready =
    path !== undefined && content !== undefined && ontology !== undefined && folders.length > 0;
  const proposal = useQuery({
    queryKey: ["triage", path],
    queryFn: ({ signal }) =>
      proposeFolder(
        {
          path: path as string,
          content: content as string,
          ontology: ontology as string,
          folders,
        },
        signal,
      ),
    enabled: ready,
    // A proposal for a note does not change while the note stays put, so it is
    // asked once and only `r` asks again.
    staleTime: Number.POSITIVE_INFINITY,
    // A proposal costs a call to the agent, so walking back with `k` after the
    // default five minutes must not pay for it a second time.
    gcTime: Number.POSITIVE_INFINITY,
  });
  return { note, content, proposal, ready };
}

/**
 * The inbox, one note at a time, with the folder the agent thinks each belongs in.
 *
 * The agent only proposes. The browser makes the move, because the move
 * endpoint is the one thing that rewrites the links to a note, and it belongs
 * to the same code path the rest of the app moves through. There is no
 * confirmation: the task is one key per note, so a move that turns out wrong
 * is undone by moving the note back.
 */
export function TriagePane({ commands, onClose, onOpen, onMoved, focusSignal }: TriagePaneProps) {
  const queryClient = useQueryClient();
  // The note under the cursor, held by its path. An index would move the cursor
  // to a different note whenever the listing changed in front of it.
  const [at, setAt] = useState<string | undefined>(undefined);
  const [moving, setMoving] = useState(false);
  const [moveError, setMoveError] = useState<string | null>(null);
  // `null` is the note as it is. A string is the path being typed into the field.
  const [typed, setTyped] = useState<string | null>(null);
  const [pending, setPending] = useState("");
  const panel = useRef<HTMLElement>(null);
  const field = useRef<HTMLInputElement>(null);

  const files = useQuery({ queryKey: ["files"], queryFn: fetchFiles });
  const ontologyNote = useQuery({
    queryKey: ["note", ONTOLOGY_NOTE],
    queryFn: () => fetchNote(ONTOLOGY_NOTE),
  });
  // A missing vocabulary is not a reason to stop: the agent still proposes a
  // folder from the folders and their notes.
  const ontology = ontologyNote.data ?? (ontologyNote.isError ? "" : undefined);

  const queue = files.data === undefined ? [] : inboxNotes(files.data, INBOX);
  const folders =
    files.data === undefined ? [] : vaultFolders(files.data, [INBOX, ARCHIVE, PERIODIC]);
  // A note that has left the inbox some other way falls back to the top of it.
  const found = at === undefined ? -1 : queue.indexOf(at);
  const cursor = found === -1 ? 0 : found;
  const path = queue[cursor];

  const current = useProposal(path, folders, ontology);
  // Asked for early, so the next note's proposal is ready when `j` gets there.
  useProposal(queue[cursor + 1], folders, ontology);

  // The agent can name a folder the list does not hold. The listing can also
  // change after the answer arrived, so the folder is checked against the list
  // as it is now, and a folder that has left it is not offered.
  const offered = current.proposal.data?.folder;
  const proposed =
    path !== undefined && offered !== undefined && folders.some((folder) => folder.path === offered)
      ? dropTarget(path, "rename", offered)
      : undefined;

  // A freshly split pane is created focused and its first render is the only
  // chance it gets to say so. An unfocused pane is handed 0 and stays put.
  useEffect(() => {
    if (focusSignal) panel.current?.focus();
  }, [focusSignal]);

  const editing = typed !== null;
  // The field is opened by a key on the panel, so the focus has to move to it.
  useEffect(() => {
    if (editing) field.current?.focus();
  }, [editing]);

  async function move(from: string, to: string) {
    if (moving) return;
    setMoving(true);
    // Where the cursor goes once this note has left: the one after it, or the one
    // before when it was last. Taken now, while the cursor still stands on it.
    const next = queue[cursor + 1] ?? queue[cursor - 1];
    try {
      const landed = await moveAndCache(queryClient, "rename", from, to);
      // The note leaves the queue at once, and a note moved back shows again.
      queryClient.setQueryData<string[]>(["files"], (listing) =>
        listing?.map((file) => (file === from ? landed : file)),
      );
      // The cursor follows the note only while it is still on it. A `j` pressed
      // during the move has already moved on, and that move must not be undone.
      setAt((now) => (now === from ? next : now));
      setMoveError(null);
      setTyped(null);
      void queryClient.invalidateQueries({ queryKey: ["files"] });
      onMoved(from, landed);
      panel.current?.focus();
    } catch (error: unknown) {
      if (!(error instanceof Error)) throw error;
      // The vault's own message names the request that failed, which tells the
      // person nothing, so the likely cause is said instead.
      setMoveError(`Could not move to ${to}. Something may already be there.`);
      // Focus stays where the path was typed, so Enter can be tried again.
      (field.current ?? panel.current)?.focus();
    } finally {
      setMoving(false);
    }
  }

  function moveProposed() {
    if (path === undefined || proposed === undefined) return;
    void move(path, proposed);
  }

  function edit() {
    // A second press must not reset what was typed into the field.
    if (path !== undefined && !editing) setTyped(proposed ?? path);
  }

  function cancelField() {
    setTyped(null);
    panel.current?.focus();
  }

  function open() {
    if (path !== undefined) onOpen(path);
    panel.current?.focus();
  }

  function askAgain() {
    // A proposal in flight is not asked for again, and a note still loading has
    // nothing to ask about.
    if (!current.ready || current.proposal.isFetching) return;
    current.proposal.refetch();
    panel.current?.focus();
  }

  function step(by: number) {
    const to = queue[cursor + by];
    if (to !== undefined) setAt(to);
    // A clicked button keeps the focus, so the next Enter would press it again
    // and a button that disabled itself would swallow the keys.
    panel.current?.focus();
  }

  function onKeyDown(event: React.KeyboardEvent) {
    const { key } = event;

    // A modifier holds itself down before the key it is held for arrives, and
    // a pending sequence that read it as a key would drop the sequence there.
    if (heldModifier(key)) return;

    // The leader still works inside the pane, the way it does inside the exam,
    // so the other panes stay reachable mid-triage.
    if (pending) {
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
      return;
    }

    if (event.ctrlKey || event.altKey || event.metaKey) return;

    // A field has the keyboard, so the pane stands down: `e` is a letter in the
    // path being typed and `space` is a space in it. The field has its own keys.
    const target = event.target as HTMLElement;
    if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") return;

    // A focused button already presses itself on Enter, so the pane leaves that
    // key alone, or one Enter would move the note twice.
    if (key === "Enter" && target.tagName === "BUTTON") return;

    if (key === " ") setPending(key);
    else if (key === "Enter") moveProposed();
    else if (key === "e") edit();
    else if (key === "j") step(1);
    else if (key === "k") step(-1);
    else if (key === "o") open();
    else if (key === "r") askAgain();
    else if (key === "q") onClose();
    else return;

    event.preventDefault();
  }

  function onFieldKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      cancelField();
      return;
    }
    if (event.key !== "Enter") return;
    event.preventDefault();
    // Only a path that names a markdown note somewhere else is a move. Anything
    // else leaves the field open for the next try.
    if (path === undefined || typed === null || typed === path || !typed.endsWith(".md")) return;
    void move(path, typed);
  }

  // A listing that failed after it had loaded keeps the note on screen: the
  // error is shown only when there is nothing else to show.
  const shown = files.data !== undefined ? null : files.isError ? files.error.message : "Loading";

  return (
    <section
      ref={panel}
      data-triage-pane
      // Focusable but out of the tab order, the way the review pane and the todo
      // pane take the cursor.
      tabIndex={-1}
      onKeyDown={onKeyDown}
      aria-label="triage"
      className="flex h-full flex-col bg-one-bg font-mono text-one-fg outline-none"
    >
      {shown !== null ? (
        <p className="p-3 text-[13px] text-one-muted">{shown}</p>
      ) : queue.length === 0 ? (
        <p className="p-3 text-[13px] text-one-muted">The inbox is empty.</p>
      ) : (
        <>
          <header className="flex items-center gap-3 border-one-line border-b px-3 py-2">
            <span className="text-[11px] text-one-muted uppercase tracking-wider">
              {cursor + 1} of {queue.length}
            </span>
            <span className="min-w-0 flex-1 truncate text-[13px]">{path}</span>
          </header>

          <pre className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap p-3 text-[13px]">
            {current.content}
          </pre>

          <div className="space-y-2 border-one-line border-t px-3 py-2 text-[13px]">
            {current.proposal.isFetching && (
              <p className="text-one-muted">Asking where this belongs</p>
            )}
            {folders.length === 0 && (
              <p className="text-one-muted">No folder to file into. Press e to type a place.</p>
            )}
            {current.note.isError && <p className="text-one-warn">{current.note.error.message}</p>}
            {current.proposal.isError && (
              <p className="text-one-warn">
                {current.proposal.error.message}. Press r to ask again, or e to type a place.
              </p>
            )}
            {current.proposal.data !== undefined && proposed === undefined && (
              <p className="text-one-warn">
                The proposal was no folder to move to. Press r to ask again, or e to type a place.
              </p>
            )}
            {current.proposal.data !== undefined && proposed !== undefined && (
              <>
                <p className="text-one-accent">{proposed}</p>
                <p className="text-one-muted">{current.proposal.data.reason}</p>
              </>
            )}
            {moveError !== null && (
              <p role="alert" className="text-one-warn">
                {moveError}
              </p>
            )}

            {editing && (
              <input
                ref={field}
                aria-label="move to"
                value={typed}
                onChange={(event) => setTyped(event.target.value)}
                onKeyDown={onFieldKeyDown}
                // A path is typed exactly, so the phone keyboard must not change it.
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                className="min-h-11 w-full rounded border border-one-line bg-one-bg px-3 text-[13px] text-one-fg outline-none focus:border-one-accent"
              />
            )}

            {/* Every key has a button, because a phone has no keys. The keys stay
                as the quick way for a desk, not the only way. */}
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => step(-1)}
                disabled={cursor === 0}
                className="min-h-11 rounded border border-one-line px-3 py-2 text-[12px] hover:border-one-accent disabled:opacity-50"
              >
                Previous (k)
              </button>
              <button
                type="button"
                onClick={() => step(1)}
                disabled={cursor + 1 >= queue.length}
                className="min-h-11 rounded border border-one-line px-3 py-2 text-[12px] hover:border-one-accent disabled:opacity-50"
              >
                Next (j)
              </button>
              <button
                type="button"
                onClick={moveProposed}
                disabled={moving || proposed === undefined}
                className="min-h-11 rounded border border-one-line px-3 py-2 text-[12px] hover:border-one-accent disabled:opacity-50"
              >
                Move (Enter)
              </button>
              <button
                type="button"
                onClick={edit}
                className="min-h-11 rounded border border-one-line px-3 py-2 text-[12px] hover:border-one-accent"
              >
                Edit (e)
              </button>
              {editing && (
                <button
                  type="button"
                  onClick={cancelField}
                  className="min-h-11 rounded border border-one-line px-3 py-2 text-[12px] hover:border-one-accent"
                >
                  Cancel (Esc)
                </button>
              )}
              <button
                type="button"
                onClick={open}
                className="min-h-11 rounded border border-one-line px-3 py-2 text-[12px] hover:border-one-accent"
              >
                Open (o)
              </button>
              <button
                type="button"
                onClick={askAgain}
                disabled={!current.ready || current.proposal.isFetching}
                className="min-h-11 rounded border border-one-line px-3 py-2 text-[12px] hover:border-one-accent disabled:opacity-50"
              >
                Ask again (r)
              </button>
              <button
                type="button"
                onClick={onClose}
                className="min-h-11 rounded border border-one-line px-3 py-2 text-[12px] hover:border-one-accent"
              >
                Close (q)
              </button>
            </div>
          </div>
        </>
      )}
    </section>
  );
}
