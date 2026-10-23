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
import { createNote, fetchNote, NoteExists } from "@/lib/api";
import type { FileTarget } from "@/lib/editor-follow";
import { queryEmbedSource } from "@/lib/embed";
import { encodePath } from "@/lib/note-path";
import { noteSectionOf } from "@/lib/note-section";
import {
  openBookBeside,
  openHtmlInFocused,
  openImageInFocused,
  openInFocused,
  openPdfBeside,
  openPdfInFocused,
} from "@/lib/pane-contents";
import { type Layout, tabPanes } from "@/lib/panes";
import { type Period, periodicNote } from "@/lib/periodic";
import type { Listings } from "@/lib/use-listings";
import { namesAFile, pdfPage, resolveIn, splitTarget, wikiLinkPath } from "@/lib/wikilink";

export type NoteOpening = ReturnType<typeof useNoteOpening>;

/**
 * Make the note at `path`, with `body` as its text, and cache what was written.
 *
 * The one place a note is made for a link or a pdf's note: the text is cached for
 * the pane that opens it, and the file list is read again. Resolves to the path
 * the vault made, or undefined when the vault refused it: a hidden name, or a
 * note standing where the path wanted a folder.
 *
 * `reuse` answers the path when the vault says the note is there already (a 409),
 * which is what a caller that wants the note open gets when the file list was
 * stale. Off, that answer is a refusal, as it is for a link.
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
  /** The passage `gf` asked for, and which reader is to take it. */
  const [seek, setSeek] = useState<{ note: string; quote: string[] }>();

  /**
   * Open a note in the focused pane, once the vault holds what was typed here.
   *
   * Every way in goes through this: the tree, the finder, search and a
   * `[[link]]`. Opening another note moves the autosave's path, and its cleanup
   * writes what is waiting to the note it was typed into, so the same write
   * `<leader>q` refuses is one click away from happening without being asked.
   * The refusal cannot live in that cleanup: by then the path has already
   * changed, and refusing there would trade the other writer's text for the
   * reader's own.
   *
   * The focus is raised with the note, the way every key that moves between
   * panes raises it. Without that, a note opened from the file tree arrives on
   * screen with the focus still on the tree row: the editor takes the focus on
   * mount only when nothing else holds it, and the tree holds it. The note is
   * in front of you and every key you press goes to the panel beside it. A
   * click into a row lands here too and raises it just the same, which is what
   * you want from a click on a note: you asked to read it, not to go on
   * walking the tree.
   *
   * Resolves to whether the note opened: a refused save leaves the pane as it was.
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
   * How an embed in any pane reads its note and opens it.
   *
   * Through the query cache, on the key the panes read their notes by, so the
   * vault event handler in `useVaultEvents` that refetches a written note and the autosave
   * that stores what it wrote keep every embed of it current too. The line
   * passes straight through: both sides count from one.
   */
  /**
   * Show a pdf at a page in a pane beside the note, the view every followed
   * pdf lands in (#353).
   *
   * Through `moveTo` and with no save, the way `openPassage` opens a book: the
   * note stays open in its own pane, so nothing about it has to be written.
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

      setLayout((previous) => openHtmlInFocused(previous, path, anchor));
      setFocusSignal((previous) => previous + 1);
    },
    [saveFirst, setLayout, setFocusSignal],
  );

  /**
   * Show an image in the focused pane, from a row of the tree.
   *
   * `openInPane`'s shape, save the line: the note in the pane is saved before
   * it goes, because an image is not a note and this is still the pane that
   * note was in, and the focus is raised so the keys follow the picture rather
   * than staying on the tree row that named it.
   */
  const openImageInPane = useCallback(
    async (path: string) => {
      if (!(await saveFirst())) return;

      setLayout((previous) => openImageInFocused(previous, path));
      setFocusSignal((previous) => previous + 1);
    },
    [saveFirst, setLayout, setFocusSignal],
  );

  /**
   * Show a pdf at its first page in the focused pane, from a row of the tree.
   *
   * `openImageInPane`'s shape and not `openPdfInPane`'s: a row opens what it
   * names over the pane, as an image row does, so the note in it is saved
   * before it goes. A followed link is what opens one beside.
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
   * Open the note a `[[link]]` names, making it if the vault has none.
   *
   * The listing is what turns a name into a path, so the resolving happens
   * here rather than in the editor, which holds one note and knows nothing of
   * the others. A link to a note that is not there is not a mistake: writing
   * the link before the note is how a vault grows, and following one is the
   * moment the note begins.
   *
   * `body` is what a note this makes starts life with, and it is empty for
   * every link followed by hand: a note the reader is about to write is one
   * they write themselves. Only the periodic keys pass one.
   *
   * `[[note#heading]]` opens the note at the heading, read through the query
   * cache the panes read by; a heading the note lacks opens it at the top.
   * `[[#heading]]` names no note, and the editor jumps within its own.
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
      // A markdown link has split its path and heading already, so there is no
      // `splitTarget` to do. The path is resolved as a wikilink's name is, so a
      // bare file name finds the vault's file of that name.
      if (file !== undefined) {
        openFile(resolveIn(file.path, linkable ?? []) ?? file.path, file.heading);
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
        // A note opened while this one was read is where the reader went
        // next, and the jump arriving late must not pull them back.
        //
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
        void queryClient
          .fetchQuery({ queryKey: ["note", path], queryFn: () => fetchNote(path) })
          .then(
            (text) => open(noteSectionOf(text, heading)?.line),
            // A note that will not read is still worth opening, at the top.
            () => open(),
          );
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
   * Open the book a highlight came from, at the passage it quotes.
   *
   * The order matters: `moveTo` refuses while the focused pane stands
   * conflicted, and a seek set before it would arm a jump in a reader that is
   * already open for a key that was refused. Either both happen or neither
   * does.
   */
  const openPassage = useCallback(
    (note: string, quote: string[]) => {
      // The press clears it, which is the rule PR 4 settled and PR 5 followed.
      setNotice(undefined);
      if (moveTo((previous) => openBookBeside(previous, note))) setSeek({ note, quote });
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
   * Open the note covering today at one grain, making it if the vault has none.
   *
   * Through `follow`, because that is already the one place a note is made and
   * opened in the same breath, and a periodic note differs from a followed link
   * only in carrying a body. The date is read at the press, so a tab left open
   * overnight opens the new day's note rather than yesterday's.
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
    follow,
    openPassage,
    openPeriodic,
  };
}
