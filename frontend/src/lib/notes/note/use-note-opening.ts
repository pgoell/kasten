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
import { createNote, fetchNote, NoteExists, type SearchHit } from "@/lib/core/api";
import type { FileTarget } from "@/lib/notes/editor/editor-follow";
import { queryEmbedSource } from "@/lib/notes/embeds/embed";
import { encodePath } from "@/lib/notes/links/note-path";
import { namesAFile, pdfPage, splitTarget, wikiLinkPath } from "@/lib/notes/links/wikilink";
import { noteSectionOf } from "@/lib/notes/text/note-section";
import { type Period, periodicNote } from "@/lib/notes/text/periodic";
import {
  openBeside,
  openBookInFocused,
  openInFocused,
  openPdfBeside,
  openPdfInFocused,
} from "@/lib/panes/layout/pane-contents";
import { activeTab, atPane, fillFocused, type Layout, tabPanes } from "@/lib/panes/layout/panes";
import { bookNoteOf, fileKind, opensInFilePane } from "@/lib/vault/file-kind";
import { type LinkPaths, linkPaths, linkTargets } from "@/lib/vault/use-listings";

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
  at: string,
): void {
  const open = (previous: Layout) =>
    atPane(previous, at, (layout) => openBookInFocused(layout, note));
  if (moveTo(open) && text !== undefined) {
    setSeek({ note, quote: [text] });
  }
}

/**
 * The pane an open starts from, by id: the one holding the browser's focus, as a click there reaches
 * the layout only once React draws it (#361), else the layout's focused one.
 */
function startPane(layout: Layout): string {
  const at = document.activeElement?.closest<HTMLElement>("[data-pane]")?.dataset.pane;
  return tabPanes(layout).find((each) => each.id === at)?.id ?? activeTab(layout).focus;
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
    openInPane: (path: string, line: number | undefined, at: string) => Promise<boolean>;
  },
  path: string,
  heading: string,
  at: string,
): void {
  // Where the read starts from is the pane the focus is in now, not
  // `focusedNote`: a ctrl+click in another pane moves the focus there in
  // this same call, and the ref hears of it only once React has drawn
  // the move. Read from the ref, the click's own move would look like
  // the reader going elsewhere and drop the open (#361).
  const from = tabPanes(layoutNow.current).find((each) => each.id === at)?.path;
  const open = (line?: number) => {
    if (focusedNote.current.path === from) void openInPane(path, line, at);
  };
  void queryClient.fetchQuery({ queryKey: ["note", path], queryFn: () => fetchNote(path) }).then(
    (text) => open(noteSectionOf(text, heading)?.line),
    // A note that will not read is still worth opening, at the top.
    () => open(),
  );
}

/**
 * The notes listing once it loads, or undefined when it fails or pane `at` took another note meanwhile:
 * the pane is held by id, as a pick fills the pane it came from even when the focus moves on (#1626).
 */
function waitedFiles(
  listed: Promise<LinkPaths>,
  layoutNow: RefObject<Layout>,
  at: string,
): Promise<string[] | undefined> {
  const held = () => tabPanes(layoutNow.current).find((each) => each.id === at)?.path;
  const from = held();
  return listed.then(
    ({ files }) => (held() === from ? files : undefined),
    () => undefined,
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
  layoutNow,
  focusedNote,
  setLayout,
  setFocusSignal,
  saveFirst,
  moveTo,
  setNotice,
}: {
  layoutNow: RefObject<Layout>;
  focusedNote: RefObject<{ path: string | undefined }>;
  setLayout: Dispatch<SetStateAction<Layout>>;
  setFocusSignal: Dispatch<SetStateAction<number>>;
  saveFirst: () => Promise<boolean>;
  moveTo: (update: (previous: Layout) => Layout) => boolean;
  setNotice: Dispatch<SetStateAction<string | undefined>>;
}) {
  const queryClient = useQueryClient();
  const [seek, setSeek] = useState<Seek>();

  /**
   * Open a note in the focused pane, once the vault holds what was typed here. A refused save leaves the pane as it was.
   * The focus is raised with the note, so the keys follow it rather than staying on the tree row.
   */
  const openInPane = useCallback(
    async (path: string, line?: number, at = startPane(layoutNow.current)): Promise<boolean> => {
      if (!(await saveFirst())) return false;

      setLayout((previous) => atPane(previous, at, (layout) => openInFocused(layout, path, line)));
      setFocusSignal((previous) => previous + 1);
      return true;
    },
    [saveFirst, setLayout, setFocusSignal, layoutNow],
  );

  /**
   * Show a pdf at a page in a pane beside the note, the view every followed pdf lands in (#353).
   * Through `moveTo` with no save, as `openPassage` opens a book, so nothing about the note has to be written.
   */
  const openPdfInPane = useCallback(
    (path: string, page?: number) => moveTo((previous) => openPdfBeside(previous, path, page)),
    [moveTo],
  );

  /** Show an HTML page in the focused pane, the way `openImageInPane` shows an image. */
  const openHtmlInPane = useCallback(
    async (path: string, anchor?: string, at = startPane(layoutNow.current)) => {
      if (!(await saveFirst())) return;

      setLayout((previous) =>
        atPane(previous, at, (layout) => fillFocused(layout, { html: path, anchor })),
      );
      setFocusSignal((previous) => previous + 1);
    },
    [saveFirst, setLayout, setFocusSignal, layoutNow],
  );

  /**
   * Show an image in the focused pane from a row of the tree. The note in the pane is saved first, since an image is not a note.
   * The focus is raised so the keys follow the picture.
   */
  const openImageInPane = useCallback(
    async (path: string) => {
      const at = startPane(layoutNow.current);
      if (!(await saveFirst())) return;

      setLayout((previous) =>
        atPane(previous, at, (layout) => fillFocused(layout, { image: path })),
      );
      setFocusSignal((previous) => previous + 1);
    },
    [saveFirst, setLayout, setFocusSignal, layoutNow],
  );

  /**
   * How an embed in any pane reads its note and opens it, through the query cache on the key the panes read by.
   * So the vault event and the autosave keep every embed of it current too.
   */
  const embeds = useMemo(
    () =>
      queryEmbedSource(
        queryClient,
        (path, line) => void openInPane(path, line),
        openPdfInPane,
        (path) => void openImageInPane(path),
      ),
    [queryClient, openInPane, openPdfInPane, openImageInPane],
  );

  /**
   * Show a pdf at its first page in the focused pane from a row of the tree. Like an image row, it saves the note before it goes.
   * A followed link is what opens one beside.
   */
  const openPdfFromTree = useCallback(
    async (path: string) => {
      const at = startPane(layoutNow.current);
      if (!(await saveFirst())) return;

      setLayout((previous) => atPane(previous, at, (layout) => openPdfInFocused(layout, path)));
      setFocusSignal((previous) => previous + 1);
    },
    [saveFirst, setLayout, setFocusSignal, layoutNow],
  );

  /**
   * Open an epub in its reader, or in a tab of its own when it has no note, since there is no reader to go through.
   * The listings are read from the cache now, not as the last render saw them (#2034).
   */
  const openEpub = useCallback(
    async (path: string, text: string | undefined, at: string): Promise<void> => {
      const note = bookNoteOf(path);
      const listed = linkPaths(queryClient);
      const files =
        listed instanceof Promise ? await waitedFiles(listed, layoutNow, at) : listed.files;
      if (files === undefined) return;
      if (!files.includes(note)) {
        window.open(`/api/assets/${encodePath(path)}`, "_blank");
        return;
      }
      if (!(await saveFirst())) return;

      openBookAt(moveTo, setSeek, note, text, at);
    },
    [queryClient, saveFirst, moveTo, layoutNow],
  );

  /**
   * Open a pdf, epub or html file from the finder or a search hit, the way the app already opens each kind.
   * `text` is the line a search hit found.
   */
  const openFile = useCallback(
    async (path: string, place?: FilePlace | null, text?: string): Promise<void> => {
      const kind = fileKind(path);
      const at = startPane(layoutNow.current);
      if (kind === "html") {
        await openHtmlInPane(path, place?.anchor ?? undefined, at);
        return;
      }
      if (kind === "pdf") {
        if (!(await saveFirst())) return;

        const page = place?.page ?? undefined;
        setLayout((previous) =>
          atPane(previous, at, (layout) => openPdfInFocused(layout, path, page)),
        );
        setFocusSignal((previous) => previous + 1);
        return;
      }
      if (kind === "epub") await openEpub(path, text, at);
    },
    [saveFirst, setLayout, setFocusSignal, openHtmlInPane, openEpub, layoutNow],
  );

  /** `follow` once the listings are in hand. */
  const followIn = useCallback(
    (listed: LinkPaths, target: string, file: FileTarget | undefined, body: string, at: string) => {
      const { files: paths, html, assets } = listed;
      // The one tail a page or an asset takes, from a wikilink or a markdown
      // link alike. The vault has no write for either, so a link to one nobody
      // made stays a dead link rather than turning into a note named `.pdf.md`.
      // One the vault holds opens in a tab of its own, the browser being what
      // reads a picture. A pdf opens in kasten's own view at the page
      // `#page=3` names, a phone's viewer ignoring `#page` (#353), and a csv
      // as a table and a video file as a player, which a tab would only download.
      const openFile = (path: string, heading: string | null) => {
        if (html.includes(path)) {
          void openHtmlInPane(path, heading ?? undefined, at);
          return;
        }
        if (!assets.includes(path)) return;
        if (path.toLowerCase().endsWith(".pdf")) openPdfInPane(path, pdfPage(heading));
        else if (opensInFilePane(path)) void openImageInPane(path);
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
      const path = wikiLinkPath(target, linkTargets(listed));
      if (html.includes(path)) {
        openFile(path, heading);
        return;
      }
      if (paths.includes(path) && heading !== null) {
        openAtHeading({ queryClient, layoutNow, focusedNote, openInPane }, path, heading, at);
        return;
      }
      if (paths.includes(path)) {
        return openInPane(path, undefined, at);
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
        made === undefined ? false : openInPane(made, undefined, at),
      );
    },
    [
      queryClient,
      openInPane,
      openHtmlInPane,
      openPdfInPane,
      openImageInPane,
      layoutNow,
      focusedNote,
    ],
  );

  /**
   * Open the note a `[[link]]` names, making it if the vault has none. Writing a link before its note is how a vault grows.
   * `body` is empty for links followed by hand. `[[note#heading]]` opens at the heading, and `[[#heading]]` stays in the editor.
   */
  const follow = useCallback(
    (target: string, file?: FileTarget, body = "", at = startPane(layoutNow.current)) => {
      const listed = linkPaths(queryClient);
      if (!(listed instanceof Promise)) return followIn(listed, target, file, body, at);
      // Read off the pane the press came from, as `openAtHeading` does, so a late open never pulls the reader back.
      const from = tabPanes(layoutNow.current).find((each) => each.id === at)?.path;
      return listed.then(
        (loaded) =>
          focusedNote.current.path === from
            ? (followIn(loaded, target, file, body, at) ?? false)
            : false,
        // A listing that will not load opens nothing and makes no note.
        () => false,
      );
    },
    [queryClient, layoutNow, focusedNote, followIn],
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
    (period: Period, at?: string) => {
      const { path, body } = periodicNote(period, new Date());
      return follow(path, undefined, body, at);
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
