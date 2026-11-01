import { type QueryClient, useQueryClient } from "@tanstack/react-query";
import {
  type Dispatch,
  type RefObject,
  type SetStateAction,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { createNote, fetchNote, NoteExists, type SearchHit } from "@/lib/api";
import type { FileTarget } from "@/lib/editor/editor-follow";
import { queryEmbedSource } from "@/lib/embed";
import { bookNoteOf, fileKind } from "@/lib/file-kind";
import { encodePath } from "@/lib/note-path";
import { noteSectionOf } from "@/lib/note-section";
import {
  openBeside,
  openBookInFocused,
  openInFocused,
  openPdfBeside,
  openPdfInFocused,
} from "@/lib/pane-contents";
import { fillFocused, type Layout, tabPanes } from "@/lib/panes";
import { type Period, periodicNote } from "@/lib/periodic";
import type { Listings } from "@/lib/use-listings";
import { namesAFile, pdfPage, splitTarget, wikiLinkPath } from "@/lib/wikilink";

export type NoteOpening = ReturnType<typeof useNoteOpening>;

/** The passage `gf` asked for, and which reader is to take it. */
type Seek = { note: string; quote: string[] };

/**
 * Move to the book's reader, the seek armed only once the move is taken: a refused move leaves no reader to
 * seek in, and a seek left standing would jump the next one opened.
 */
function openBookAt(
  moveTo: (update: (previous: Layout) => Layout) => boolean,
  setSeek: Dispatch<SetStateAction<Seek | undefined>>,
  note: string,
  text: string | undefined,
): void {
  if (moveTo((previous) => openBookInFocused(previous, note)) && text !== undefined) {
    setSeek({ note, quote: [text] });
  }
}

/**
 * Open the note at `path` at `heading` once its text reads. A note opened while this one was read is where the
 * reader went next, and the jump arriving late must not pull them back.
 */
function openAtHeading(
  {
    queryClient,
    layoutNow,
    focusedNote,
    openInPane,
  }: {
    queryClient: QueryClient;
    layoutNow: RefObject<Layout>;
    focusedNote: RefObject<{ path: string | undefined }>;
    openInPane: (path: string, line?: number) => Promise<boolean>;
  },
  path: string,
  heading: string,
): void {
  // Where the read starts from is the pane the focus is in now, not
  // `focusedNote`: a ctrl+click in another pane moves the focus there in
  // this same call, and the ref hears of it only once React has drawn
  // the move. Read from the ref, the click's own move would look like
  // the reader going elsewhere and drop the open (#361).
  const at = document.activeElement?.closest<HTMLElement>("[data-pane]")?.dataset.pane;
  const here = tabPanes(layoutNow.current).find((each) => each.id === at);
  const from = here === undefined ? focusedNote.current.path : here.path;
  const open = (line?: number) => {
    if (focusedNote.current.path === from) void openInPane(path, line);
  };
  void queryClient.fetchQuery({ queryKey: ["note", path], queryFn: () => fetchNote(path) }).then(
    (text) => open(noteSectionOf(text, heading)?.line),
    // A note that will not read is still worth opening, at the top.
    () => open(),
  );
}

/** Where a search hit found its line in a file, which is what the opener goes to. */
type FilePlace = NonNullable<SearchHit["place"]>;

/**
 * Make the note at `path` with `body` as its text, and cache what was written. The one place a link's or pdf's note is made.
 * Resolves to undefined when the vault refuses the name. `reuse` answers the path when the note is already there (a 409).
 */
export function makeNote(
  queryClient: QueryClient,
  path: string,
  body = "",
  reuse = false,
): Promise<string | undefined> {
  return createNote(path, body).then(
    (made) => {
      queryClient.setQueryData(["note", made.path], made.content);
      queryClient.invalidateQueries({ queryKey: ["files"] });
      return made.path;
    },
    (error: unknown) => {
      if (reuse && error instanceof NoteExists) {
        queryClient.invalidateQueries({ queryKey: ["files"] });
        return path;
      }
      return undefined;
    },
  );
}

/**
 * Every way a note, page, image or pdf is opened into a pane: from the tree,
 * a `[[link]]`, an embed, a highlight or a periodic key.
 */
export function useNoteOpening({
  listings,
  layoutNow,
  focusedNote,
  setLayout,
  setFocusSignal,
  saveFirst,
  moveTo,
  setNotice,
}: {
  listings: Pick<Listings, "data" | "html" | "assets" | "linkable">;
  layoutNow: RefObject<Layout>;
  focusedNote: RefObject<{ path: string | undefined }>;
  setLayout: Dispatch<SetStateAction<Layout>>;
  setFocusSignal: Dispatch<SetStateAction<number>>;
  saveFirst: () => Promise<boolean>;
  moveTo: (update: (previous: Layout) => Layout) => boolean;
  setNotice: Dispatch<SetStateAction<string | undefined>>;
}) {
  const { data, html, assets, linkable } = listings;
  const queryClient = useQueryClient();
  const [seek, setSeek] = useState<Seek>();

  /**
   * Open a note in the focused pane, once the vault holds what was typed here. A refused save leaves the pane as it was.
   * The focus is raised with the note, so the keys follow it rather than staying on the tree row.
   */
  const openInPane = useCallback(
    async (path: string, line?: number): Promise<boolean> => {
      if (!(await saveFirst())) return false;

      setLayout((previous) => openInFocused(previous, path, line));
      setFocusSignal((previous) => previous + 1);
      return true;
    },
    [saveFirst, setLayout, setFocusSignal],
  );

  /**
   * How an embed in any pane reads its note and opens it, through the query cache on the key the panes read by.
   * So the vault event and the autosave keep every embed of it current too.
   */
  /**
   * Show a pdf at a page in a pane beside the note, the view every followed pdf lands in (#353).
   * Through `moveTo` with no save, as `openPassage` opens a book, so nothing about the note has to be written.
   */
  const openPdfInPane = useCallback(
    (path: string, page?: number) => moveTo((previous) => openPdfBeside(previous, path, page)),
    [moveTo],
  );

  const embeds = useMemo(
    () => queryEmbedSource(queryClient, (path, line) => void openInPane(path, line), openPdfInPane),
    [queryClient, openInPane, openPdfInPane],
  );

  /** Show an HTML page in the focused pane, the way `openImageInPane` shows an image. */
  const openHtmlInPane = useCallback(
    async (path: string, anchor?: string) => {
      if (!(await saveFirst())) return;

      setLayout((previous) => fillFocused(previous, { html: path, anchor }));
      setFocusSignal((previous) => previous + 1);
    },
    [saveFirst, setLayout, setFocusSignal],
  );

  /**
   * Show an image in the focused pane from a row of the tree. The note in the pane is saved first, since an image is not a note.
   * The focus is raised so the keys follow the picture.
   */
  const openImageInPane = useCallback(
    async (path: string) => {
      if (!(await saveFirst())) return;

      setLayout((previous) => fillFocused(previous, { image: path }));
      setFocusSignal((previous) => previous + 1);
    },
    [saveFirst, setLayout, setFocusSignal],
  );

  /**
   * Show a pdf at its first page in the focused pane from a row of the tree. Like an image row, it saves the note before it goes.
   * A followed link is what opens one beside.
   */
  const openPdfFromTree = useCallback(
    async (path: string) => {
      if (!(await saveFirst())) return;

      setLayout((previous) => openPdfInFocused(previous, path));
      setFocusSignal((previous) => previous + 1);
    },
    [saveFirst, setLayout, setFocusSignal],
  );

  /**
   * Open a pdf, epub or html file from the finder or a search hit, the way the app already opens each kind.
   * An epub with no note opens in a tab of its own, since there is no reader to go through. `text` is the line a search hit found.
   */
  const openFile = useCallback(
    async (path: string, place?: FilePlace | null, text?: string): Promise<void> => {
      const kind = fileKind(path);
      if (kind === "html") {
        await openHtmlInPane(path, place?.anchor ?? undefined);
        return;
      }
      if (kind === "pdf") {
        if (!(await saveFirst())) return;

        setLayout((previous) => openPdfInFocused(previous, path, place?.page ?? undefined));
        setFocusSignal((previous) => previous + 1);
        return;
      }
      if (kind !== "epub") return;

      const note = bookNoteOf(path);
      if (!data?.includes(note)) {
        window.open(`/api/assets/${encodePath(path)}`, "_blank");
        return;
      }
      if (!(await saveFirst())) return;

      openBookAt(moveTo, setSeek, note, text);
    },
    [data, saveFirst, setLayout, setFocusSignal, moveTo, openHtmlInPane],
  );

  /**
   * Open the note a `[[link]]` names, making it if the vault has none. Writing a link before its note is how a vault grows.
   * `body` is empty for links followed by hand. `[[note#heading]]` opens at the heading, and `[[#heading]]` stays in the editor.
   */
  const follow = useCallback(
    (target: string, file?: FileTarget, body = "") => {
      const paths = data ?? [];
      // The one tail a page or an asset takes, from a wikilink or a markdown
      // link alike. The vault has no write for either, so a link to one nobody
      // made stays a dead link rather than turning into a note named `.pdf.md`.
      // One the vault holds opens in a tab of its own, the browser being what
      // reads a picture. A pdf opens in kasten's own view at the page
      // `#page=3` names, a phone's viewer ignoring `#page` (#353).
      const openFile = (path: string, heading: string | null) => {
        if (html?.includes(path)) {
          void openHtmlInPane(path, heading ?? undefined);
          return;
        }
        if (!assets?.includes(path)) return;
        if (path.toLowerCase().endsWith(".pdf")) openPdfInPane(path, pdfPage(heading));
        else window.open(`/api/assets/${encodePath(path)}`, "_blank");
      };
      // A markdown link has split its path and resolved it from its note's folder
      // already, so the path opens as it is: no `splitTarget`, and no lookup of a
      // bare name anywhere in the vault.
      if (file !== undefined) {
        openFile(file.path, file.heading);
        return;
      }
      const { name, heading } = splitTarget(target);
      if (name === "") return;
      const path = wikiLinkPath(target, linkable ?? []);
      if (html?.includes(path)) {
        openFile(path, heading);
        return;
      }
      if (paths.includes(path) && heading !== null) {
        openAtHeading({ queryClient, layoutNow, focusedNote, openInPane }, path, heading);
        return;
      }
      if (paths.includes(path)) {
        return openInPane(path);
      }
      if (namesAFile(name)) {
        openFile(path, heading);
        return;
      }

      // One write, and the body goes over as it stands. `periodic.ts` owns the
      // block and the blank line after it, because the fence has to be the
      // file's first line for the backend to read it as frontmatter at all.
      // Resolves whether the note was made and opened, which `openPeriodic`
      // passes on so a caller waiting for that note knows it is not coming.
      // The vault's spelling and the vault's text, the way the prompt seeds
      // them, so the editor opens what was written rather than reading back a
      // file it just made. A refused path leaves the note on screen open with
      // the link still in it, which is the only place to fix either.
      return makeNote(queryClient, path, body).then((made) =>
        made === undefined ? false : openInPane(made),
      );
    },
    [
      data,
      html,
      assets,
      linkable,
      queryClient,
      openInPane,
      openHtmlInPane,
      openPdfInPane,
      layoutNow,
      focusedNote,
    ],
  );

  /**
   * Open the book a highlight came from, at the passage it quotes. `moveTo` runs first, since it refuses while the pane is conflicted,
   * and a seek set before it would arm a jump for a key that was refused.
   */
  const openPassage = useCallback(
    (note: string, quote: string[]) => {
      // The press clears it, which is the rule PR 4 settled and PR 5 followed.
      setNotice(undefined);
      if (
        moveTo((previous) =>
          openBeside(previous, (pane) => pane.book === note, { book: note }, "row"),
        )
      ) {
        setSeek({ note, quote });
      }
    },
    [moveTo, setNotice],
  );

  // One render after it is set, which is all the handover needs: React runs a
  // child's effects before its parent's, so the pane has taken the quote into a
  // ref of its own by the time this clears it. Without it the state stands
  // armed for the life of the tab, and a reader opened an hour later replays a
  // passage nobody asked for over PR 2's bookmark.
  useEffect(() => {
    if (seek) setSeek(undefined);
  }, [seek]);

  /**
   * Open the note covering today at one grain, making it if the vault has none. Through `follow`, since a periodic note differs from a followed link only in its body.
   * The date is read at the press, so a tab left open overnight opens the new day's note.
   */
  const openPeriodic = useCallback(
    (period: Period) => {
      const { path, body } = periodicNote(period, new Date());
      return follow(path, undefined, body);
    },
    [follow],
  );

  return {
    seek,
    openInPane,
    openPdfInPane,
    embeds,
    openHtmlInPane,
    openImageInPane,
    openPdfFromTree,
    openFile,
    follow,
    openPassage,
    openPeriodic,
  };
}
