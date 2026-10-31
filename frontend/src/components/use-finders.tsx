import { useQueryClient } from "@tanstack/react-query";
import { type Dispatch, type SetStateAction, useMemo, useState } from "react";
import { MeaningFinder } from "@/components/finder/meaning-finder";
import { NoteFinder } from "@/components/finder/note-finder";
import { useReadingBook } from "@/components/finder/use-reading-book";
import { NoteSearch } from "@/components/note-search";
import type { PaneMoves } from "@/components/use-pane-moves";
import { visible } from "@/lib/archive";
import { fileKind } from "@/lib/file-kind";
import type { TreeCommands } from "@/lib/key-bindings";
import type { NoteOpening } from "@/lib/note/use-note-opening";
import { openBookInFocused } from "@/lib/pane-contents";
import type { GuardedWrites } from "@/lib/use-guarded-writes";
import type { Listings } from "@/lib/use-listings";
import { outgoingLinks } from "@/lib/wikilink";

export type Finders = ReturnType<typeof useFinders>;

/** What a list prop gets while its query loads, for the reason the route's copy gives. */
const LOADING: string[] = [];

/** The vault lookups (notes, links, books, search, todos), the panels that open hits, and the reading book. */
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
  setNotice,
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
  setNotice: Dispatch<SetStateAction<string | undefined>>;
}) {
  const { data, shown, assets, html, archive } = listings;
  const { moveTo, refocusPane } = moves;
  const queryClient = useQueryClient();
  const openReadingBook = useReadingBook({ saveFirst, moveTo, setNotice });
  // The pdfs, epubs and pages beside the notes. Images share the listing and drop out.
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
  // A flag, not a path: the finder ranks the whole vault and starts from nothing.
  const [finderOpen, setFinderOpen] = useState(false);
  // Own flag: it asks the backend on a delay. Starts open on a URL that names a week.
  const [searchOpen, setSearchOpen] = useState(week !== undefined);
  // Closing the search clears its week, so the URL never names one over nothing.
  const closeSearch = () => {
    setSearchOpen(false);
    if (week !== undefined) onWeek(undefined);
  };
  // A flag: the panel asks for every todo in the vault, so there is nothing to start from.
  const [todosOpen, setTodosOpen] = useState(false);
  // Same panel as finderOpen, but this one opens a book where that opens a note.
  const [bookFinderOpen, setBookFinderOpen] = useState(false);
  // Own panel: it asks the backend's ranked search, not a listing in hand.
  const [meaningOpen, setMeaningOpen] = useState(false);
  // The path, not a flag: the focused pane's note can change while the panel is open.
  const [backlinksOf, setBacklinksOf] = useState<string>();
  // Read once on open, not per render: the finder wants the same array back.
  const [linksOut, setLinksOut] = useState<string[] | null>(null);

  const commands = useMemo<
    Pick<
      TreeCommands,
      | "findNote"
      | "searchNotes"
      | "findTodos"
      | "findBook"
      | "openReadingBook"
      | "findMeaning"
      | "showBacklinks"
      | "showLinksOut"
    >
  >(
    () => ({
      // No save: opening moves no path. Picking a note does, in openInPane.
      findNote: () => setFinderOpen(true),
      searchNotes: () => setSearchOpen(true),
      findTodos: () => setTodosOpen(true),
      findBook: () => setBookFinderOpen(true),
      openReadingBook: () => void openReadingBook(),
      findMeaning: () => setMeaningOpen(true),
      // Needs an open note: an empty pane has nothing to ask about.
      showBacklinks: () => setBacklinksOf(panePath),
      // Saves first so the list holds the typed link. A failed save still opens
      // the panel, and never overwrites a note changed on disk.
      showLinksOut: async () => {
        if (panePath === undefined) return;
        await saveFirst();
        const text = queryClient.getQueryData<string>(["note", panePath]) ?? "";
        setLinksOut(outgoingLinks(text, data ?? []));
      },
    }),
    [panePath, saveFirst, queryClient, data, openReadingBook],
  );

  const element = (
    <>
      {/* One panel for both: linked notes are notes too. Only the list's length differs. */}
      {(finderOpen || linksOut !== null) && (
        <NoteFinder
          // Linked notes stay whole, archive included: a real link is worth showing.
          paths={linksOut ?? shown}
          outgoing={linksOut !== null}
          files={linksOut === null ? files : undefined}
          vaultNotes={data}
          onOpen={(path) => {
            setFinderOpen(false);
            setLinksOut(null);
            // A note gets no line: a stale one from an earlier search moves the cursor.
            if (fileKind(path) === undefined) void openInPane(path);
            else void openFile(path);
          }}
          onClose={() => {
            setFinderOpen(false);
            setLinksOut(null);
          }}
        />
      )}
      {meaningOpen && (
        <MeaningFinder
          archive={archive}
          onOpen={(path) => {
            setMeaningOpen(false);
            void openInPane(path);
          }}
          onClose={() => setMeaningOpen(false)}
        />
      )}
      {bookFinderOpen && (
        <NoteFinder
          paths={shown}
          // The query's own array: a fresh one each render makes the finder rank again.
          books={assets ?? LOADING}
          onOpen={(note) => {
            setBookFinderOpen(false);
            // Saves first: the unmounted editor would take unsaved text. A failed save asks the
            // pane to take focus, as the finder hands none back once a row is taken.
            void (async () => {
              if (await saveFirst()) moveTo((previous) => openBookInFocused(previous, note));
              else refocusPane();
            })();
          }}
          onClose={() => setBookFinderOpen(false)}
        />
      )}
      {/* One panel for search, backlinks and todos: same lines, only the source differs. */}
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
            // A file hit opens at its place. A note hit keeps its line.
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
