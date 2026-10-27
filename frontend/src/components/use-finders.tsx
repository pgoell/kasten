import { useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { NoteFinder } from "@/components/note-finder";
import { NoteSearch } from "@/components/note-search";
import type { PaneMoves } from "@/components/use-pane-moves";
import { visible } from "@/lib/archive";
import { fileKind } from "@/lib/file-kind";
import type { TreeCommands } from "@/lib/key-bindings";
import { openBookInFocused } from "@/lib/pane-contents";
import type { GuardedWrites } from "@/lib/use-guarded-writes";
import type { Listings } from "@/lib/use-listings";
import type { NoteOpening } from "@/lib/use-note-opening";
import { outgoingLinks } from "@/lib/wikilink";

export type Finders = ReturnType<typeof useFinders>;

/** What a list prop gets while its query loads, for the reason the route's copy gives. */
const LOADING: string[] = [];

/**
 * The panels that look something up in the vault and open what they find: the
 * note finder, the outgoing links, the book finder, the search and the todos.
 */
export function useFinders({
  listings,
  panePath,
  saveFirst,
  moves,
  openInPane,
  openFile,
  linkMentionOf,
  week,
  onWeek,
  toggleArchive,
}: {
  listings: Pick<Listings, "data" | "shown" | "assets" | "html" | "archive">;
  panePath: string | undefined;
  saveFirst: () => Promise<boolean>;
  moves: Pick<PaneMoves, "moveTo" | "refocusPane">;
  openInPane: (path: string, line?: number) => Promise<boolean>;
  openFile: NoteOpening["openFile"];
  linkMentionOf: GuardedWrites["linkMentionOf"];
  /** The week the search narrows to, from the URL. */
  week: string | undefined;
  onWeek: (week: string | undefined) => void;
  toggleArchive: () => void;
}) {
  const { data, shown, assets, html, archive } = listings;
  const { moveTo, refocusPane } = moves;
  const queryClient = useQueryClient();
  // The pdfs, epubs and pages the finder lists beside the notes, archive
  // filtered the way the notes are. Images are in the same listing and drop out.
  const files = useMemo(
    () =>
      visible(
        [...(assets ?? LOADING), ...(html ?? LOADING)].filter(
          (path) => fileKind(path) !== undefined,
        ),
        archive,
      ),
    [assets, html, archive],
  );
  // A flag and not a path, unlike the prompt: the finder ranks the whole vault
  // and has nothing to start from.
  const [finderOpen, setFinderOpen] = useState(false);
  // Its own flag rather than a mode of the finder's: that one ranks a vault
  // already in hand, this one asks the backend on a delay, and the two share
  // no state worth folding together. Open on a cold load of a URL that names a
  // week, since that week is what the search page is showing.
  const [searchOpen, setSearchOpen] = useState(week !== undefined);
  // The search's week goes with the search: closing it clears the week, so the
  // URL never names a week over nothing on screen.
  const closeSearch = () => {
    setSearchOpen(false);
    if (week !== undefined) onWeek(undefined);
  };
  // A flag like the search's: the vault holds one set of todos and the panel
  // asks for all of them, so there is nothing here to start from.
  const [todosOpen, setTodosOpen] = useState(false);
  // Apart from `finderOpen` though the panel is the same: the outgoing links
  // share that flag's onOpen, and this one opens a book where that opens a note.
  const [bookFinderOpen, setBookFinderOpen] = useState(false);
  // The note whose backlinks are on screen, and undefined while none are. The
  // path and not a flag: the panel asks the vault for that note's name, and
  // the note in the focused pane can change under a panel that is already open.
  const [backlinksOf, setBacklinksOf] = useState<string>();
  // The notes the focused pane's note links to, and null while that panel is
  // shut. Read once when it opens rather than derived per render: the finder
  // ranks the array it is handed and wants the same one back every time.
  const [linksOut, setLinksOut] = useState<string[] | null>(null);

  const commands = useMemo<
    Pick<
      TreeCommands,
      "findNote" | "searchNotes" | "findTodos" | "findBook" | "showBacklinks" | "showLinksOut"
    >
  >(
    () => ({
      // No save first: opening the panel moves no path. Picking a note out of
      // it does, and `openInPane` is where that is asked.
      findNote: () => setFinderOpen(true),
      // The same, and for the same reason.
      searchNotes: () => setSearchOpen(true),
      // The same, and for the same reason.
      findTodos: () => setTodosOpen(true),
      // The same, and for the same reason. The save is asked when a book is
      // picked, below where the panel is drawn.
      findBook: () => setBookFinderOpen(true),
      // The one command that needs a note open, because what it shows is what
      // links to that note. With an empty pane there is nothing to ask about,
      // and doing nothing is how the key says so.
      showBacklinks: () => setBacklinksOf(panePath),
      // The same pair read the other way, and the one of the two that reads the
      // note itself. Saved first so the list holds the link you just typed:
      // `saveFirst` puts the text in the cache this reads it back out of. A
      // write that was refused or that failed still opens the panel, on the
      // older text: reading the links is no reason to hide them, and it is no
      // reason to overwrite a note that changed on disk either.
      showLinksOut: async () => {
        if (panePath === undefined) return;
        await saveFirst();
        const text = queryClient.getQueryData<string>(["note", panePath]) ?? "";
        setLinksOut(outgoingLinks(text, data ?? []));
      },
    }),
    [panePath, saveFirst, queryClient, data],
  );

  const element = (
    <>
      {/* One panel for both, because the notes one note links to are a list of
          notes like any other: ranked the same, previewed the same, opened the
          same. Only how short the list is differs. */}
      {(finderOpen || linksOut !== null) && (
        <NoteFinder
          // The outgoing links are left whole: a link this note really holds is
          // worth showing wherever it points, archive included.
          paths={linksOut ?? shown}
          outgoing={linksOut !== null}
          files={linksOut === null ? files : undefined}
          vaultNotes={data}
          onOpen={(path) => {
            setFinderOpen(false);
            setLinksOut(null);
            // A file opens as its kind does. A note gets no line: the finder
            // opens a note, not a place in one, and a stale `line` left behind
            // would drop the cursor somewhere the previous search pointed at.
            // `openInFocused` writes the pane whole, which is what drops it.
            if (fileKind(path) === undefined) void openInPane(path);
            else void openFile(path);
          }}
          onClose={() => {
            setFinderOpen(false);
            setLinksOut(null);
          }}
        />
      )}
      {bookFinderOpen && (
        <NoteFinder
          paths={shown}
          // The query's own array, which keeps one identity across renders. A
          // fresh one each render would make the finder rank the list again.
          books={assets ?? LOADING}
          onOpen={(note) => {
            setBookFinderOpen(false);
            // Saved first for `openTodos`'s reason: the book replaces what the
            // pane holds, and the editor it unmounts would take unsaved text
            // with it. The reader finds the `reading:` place in the note itself.
            // A failed save leaves the note where it was, but the finder hands
            // no focus back once a row is taken, so the pane is asked to take it.
            void (async () => {
              if (await saveFirst()) moveTo((previous) => openBookInFocused(previous, note));
              else refocusPane();
            })();
          }}
          onClose={() => setBookFinderOpen(false)}
        />
      )}
      {/* One panel for all three, because backlinks and todos are the same list
          of lines from the vault, ranked the same way, opened the same way.
          Only where the lines come from differs. */}
      {(searchOpen || backlinksOf !== undefined || todosOpen) && (
        <NoteSearch
          backlinksOf={backlinksOf}
          todos={todosOpen}
          archive={archive}
          paths={data}
          week={week}
          onWeek={onWeek}
          onToggleArchive={toggleArchive}
          onLink={
            backlinksOf === undefined ? undefined : (mention) => linkMentionOf(backlinksOf, mention)
          }
          onOpen={(path, hitLine, hit) => {
            closeSearch();
            setBacklinksOf(undefined);
            setTodosOpen(false);
            // A hit in a pdf, epub or html names its place in the file, and the
            // file opens there. A note's line goes to the note as it always has.
            if (hit?.place) void openFile(path, hit.place, hit.text);
            else void openInPane(path, hitLine);
          }}
          onClose={() => {
            closeSearch();
            setBacklinksOf(undefined);
            setTodosOpen(false);
          }}
        />
      )}
    </>
  );

  return { commands, element, searchOpen };
}
