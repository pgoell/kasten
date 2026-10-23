import { useQueryClient } from "@tanstack/react-query";
import {
  type Dispatch,
  type RefObject,
  type SetStateAction,
  useCallback,
  useEffect,
  useState,
} from "react";
import { type BookBeside, ChangedOnDisk, type Mention, saveNote, updateNote } from "@/lib/api";
import { heldText } from "@/lib/held-text";
import { addHighlight, type Passage } from "@/lib/highlight";
import { escapedParagraphs } from "@/lib/html-take";
import { linkMention, mentionLinkText } from "@/lib/mention-link";
import { noteBase } from "@/lib/note-base";
import { readField, setField } from "@/lib/note-frontmatter";
import { bookType } from "@/lib/note-path";
import { newId } from "@/lib/todo";
import { useBookmark } from "@/lib/use-bookmark";
import { useNoteWrites } from "@/lib/use-note-writes";
import { setWatched } from "@/lib/video";

export type GuardedWrites = ReturnType<typeof useGuardedWrites>;

/**
 * Every write the route makes into a note nobody is typing in: the reader's
 * position, the video's, a highlight, a link and a restore. They share one
 * queue, so none of them races another into the same file.
 */
export function useGuardedWrites({
  focusedNote,
  panePath,
  setNotice,
}: {
  focusedNote: RefObject<{ path: string | undefined; isWriting: (note: string) => boolean }>;
  panePath: string | undefined;
  setNotice: Dispatch<SetStateAction<string | undefined>>;
}) {
  const queryClient = useQueryClient();
  /**
   * The video position waiting to go into a note, and which note wants it.
   *
   * A new object per report, so the editor holding that note applies it once.
   * The editor and not the vault: the note is almost always the pane you are
   * typing in, and a write that read the vault's copy and saved it back would
   * lose the paragraph you have not saved yet.
   *
   * No wait in front of it, which is where this parts company with the reader's
   * bookmark. That one writes to the vault and needs a minute between writes;
   * this one edits a buffer, and the autosave behind it is already the thing
   * that decides how often the disk hears about it. A wait here would only add
   * a window where closing the pane loses the position.
   *
   * ponytail: the position is dropped when no pane holds the note, the editor
   * being what applies it. Route it through `writePosition` as well if closing
   * the note and leaving the player running starts costing you a position.
   */
  const [mark, setMark] = useState<{ note: string; id: string; seconds: number }>();
  // Both whole-note writers the route owns go through this, so a bookmark
  // does not race a highlight into the same file. Each names its base, so the
  // loser of such a race would be refused and read again rather than lost, but
  // in line neither spends a try on the other. The editor's own save
  // stays outside it: `useAutosave` counts what is in the air already, and
  // holding a reader's save behind another writer's is worse than the race it
  // would end.
  const write = useNoteWrites();

  /**
   * Write one position into a note nobody is typing in.
   *
   * `apply` is what the field is: the reader sets `reading:` and the player
   * sets one entry of `watching:`. The read happens in here rather than outside
   * it, because everything below is about the note not moving under the write,
   * and a caller holding text from before all of that would undo it.
   *
   * The route owns this rather than the pane, because only the route knows
   * which pane has the focus, and the whole point of the write is not landing
   * on a note somebody has their hands in.
   *
   * Answers whether the vault took it. A no leaves the position waiting for the
   * next chance, and nothing here throws.
   *
   * Through the gate, so a bookmark can now wait behind a highlight rather than
   * racing it. `useBookmark`'s own drop-if-busy rule is untouched: the note
   * counts as in flight the whole time it waits here.
   */
  const writePosition = useCallback(
    (note: string, apply: (text: string) => string): Promise<boolean> =>
      write(note, async () => {
        // Skip while somebody could be typing into it: the note is the focused
        // pane's, or a write of its own text is already on its way to the vault.
        // Whether or not that pane is dirty, which tightens the master spec.
        // `updateNote` names the text it read as the base, so a save landing
        // between the read and the write is never written over. But each such
        // refusal costs a round trip and a try, and a note being typed into
        // would win every one of them, so the bookmark leaves it alone.
        //
        // Off the ref rather than out of the render, because a timer that fired
        // reads what is true now and not what was true when it was set.
        const focused = focusedNote.current;
        if (focused.path === note || focused.isWriting(note)) return false;

        // Stop for good once the note has left the listing. Read out of the cache
        // the way the event handler reads it, so no dependency on `data` puts a
        // fresh callback in front of the timer. A listing that has not arrived
        // refuses the write too, which is stricter than the pane's own reading of
        // the same fact and deliberately so: not knowing yet is a reason to draw
        // nothing, and it is not a reason to write into a vault whose shape you
        // do not know.
        if (!queryClient.getQueryData<string[]>(["files"])?.includes(note)) return false;

        const written = await updateNote(note, (text) => {
          // Asked again, because the read took a round trip and the note can
          // take the focus inside it. This is the reading that catches a save
          // starting in the same tick as the write.
          const now = focusedNote.current;
          return now.path === note || now.isWriting(note) ? null : apply(text);
        }).then(
          (landed) => landed,
          // Deleted or renamed since, which the write has no answer to, or
          // refused over its base three times.
          () => null,
        );
        if (written === null) return false;

        // `setQueryData` and not an invalidation: what `PUT` answers is the note
        // as it landed, stamp included, so there is nothing to go and read again.
        // The stream invalidates a moment later anyway, which is the belt to
        // these braces.
        queryClient.setQueryData(["note", note], written.content);
        return true;
      }),
    [queryClient, write, focusedNote],
  );

  const { moved, flush, cancel } = useBookmark((note, cfi) =>
    writePosition(note, (text) => {
      // The one writer of the reader's type, and it rides the position write
      // rather than the upload for two reasons. A refused write comes round
      // again on the next page you turn, where a one-shot write at upload is
      // dropped for good; and a file dropped into the vault from the shell pane
      // passes through no upload at all while it does get read.
      //
      // Which type it is comes off the file rather than off the note: a pdf is
      // as often a paper or a deck as a book, so it is typed `Source`. Read out
      // of the cache the reader filled, and `Book` when there is nothing there,
      // which is the older of the two and the only one a stale cache can name
      // wrongly.
      const beside = queryClient.getQueryData<BookBeside>(["book", note]);
      // Over `Note` or over nothing, and over nothing else: a type the reader
      // put there by hand is theirs, and turning a page is not an argument
      // with it.
      const held = readField(text, "type");
      const typed =
        held === undefined || held === "Note"
          ? setField(text, "type", beside === undefined ? "Book" : bookType(beside.path))
          : text;
      return setField(typed, "reading", cfi);
    }),
  );

  /**
   * Keep where a video got to, by whichever of the two routes is safe.
   *
   * The two are complementary and the focus is what tells them apart. A note in
   * the focused pane is one somebody may be typing in, so the position goes
   * into the buffer and the autosave carries it out with everything else; that
   * is also the pane whose changes the route listens to. Any other note is one
   * `writePosition` will take, its whole guard being that the note is not the
   * focused pane's.
   *
   * Nothing is lost either way, and neither path can put a saved paragraph on
   * the floor.
   */
  const keepPosition = useCallback(
    (note: string, id: string, seconds: number) => {
      if (note === "") return;
      if (focusedNote.current.path === note) setMark({ note, id, seconds });
      else void writePosition(note, (text) => setWatched(text, id, seconds));
    },
    [writePosition, focusedNote],
  );

  /**
   * Write a passage the reader took into the note beside the book.
   *
   * No focus rule and no dirty rule, which is the one place this and the
   * bookmark differ on purpose: nobody pressed a key for a bookmark. A
   * highlight is a press, so it is written whether or not you are typing in
   * that note, and the bar saying the note changed on disk is information
   * rather than rudeness.
   *
   * `invalidateQueries` and not `setQueryData` for the same reason: what comes
   * back is read again, so a clean editor picks the highlight up and a dirty
   * one raises the conflict it should. No `adopt` either.
   */
  const takeHighlight = useCallback(
    (note: string, passage: Passage): Promise<string | null> =>
      write(note, async () => {
        // The press clears the bar, which is the rule the upload settled.
        setNotice(undefined);
        // Read out of the cache the way the bookmark's own write reads it. The
        // pane already draws `No book at ...`, so this is the sentence for the
        // key rather than the only word about it.
        if (!queryClient.getQueryData<string[]>(["files"])?.includes(note)) {
          setNotice("That note has left the vault");
          return null;
        }

        // Minted here and not in the change, so a retried change writes the same
        // id and the caller gets the one that landed.
        const id = newId("hl-");
        // The book's title and chapter are the book's words, so they go through
        // the same escape as a page's text: a chapter named `## Dump` must not
        // stand as a heading on the anchor line.
        const escaped: Passage = {
          ...passage,
          text: escapedParagraphs(passage.text).join("\n"),
          chapter: escapedParagraphs(passage.chapter).join(" "),
        };
        // Whether a read got as far as the change, which is what tells the two
        // failures apart: `updateNote` rejects for either.
        let read = false;
        const written = await updateNote(note, (text) => {
          read = true;
          return addHighlight(text, escaped, id);
        }).then(
          (landed) => landed,
          () => null,
        );
        if (written === null) {
          setNotice(read ? "The highlight was not written" : "The note could not be read");
          return null;
        }

        void queryClient.invalidateQueries({ queryKey: ["note", note] });
        return id;
      }),
    [queryClient, write, setNotice],
  );

  /**
   * Turn an unlinked mention of `target` into a `[[link]]`, answering null once
   * it landed or the reason it did not.
   *
   * The bookmark's rules and not the highlight's, though this is a press too:
   * the press was made in the panel and not in the note, so nobody chose to
   * write over text they may be typing there. A note with text held after a
   * failed save is refused as well, since the vault's text is then not what the
   * reader last typed, and a link written over it would race that text back.
   */
  const linkMentionOf = useCallback(
    (target: string, mention: Mention): Promise<string | null> =>
      write(mention.path, async () => {
        const note = mention.path;
        const busy = (): string | null => {
          if (heldText(note) !== undefined) return "That note holds text not yet saved";
          const focused = focusedNote.current;
          if (focused.path === note) return "That note is open to type in";
          if (focused.isWriting(note)) return "That note is still being saved";
          return null;
        };
        const before = busy();
        if (before !== null) return before;

        const paths = queryClient.getQueryData<string[]>(["files"]) ?? [];
        const linkText = mentionLinkText(mention, target, paths);
        // What stopped the change, which `updateNote` answers null for whatever
        // the cause, and the one sentence for a write that threw.
        let why = "The link was not written";
        const written = await updateNote(note, (text) => {
          // Asked again, because the read took a round trip.
          const now = busy();
          if (now !== null) {
            why = now;
            return null;
          }
          const next = linkMention(text, mention, linkText);
          if (next === null) why = "That line has changed since it was listed";
          return next;
        }).then(
          (landed) => landed,
          // A 500, the network, or refused over its base three times.
          () => null,
        );
        if (written === null) return why;

        queryClient.setQueryData(["note", note], written.content);
        // The row leaves the unlinked group and the line joins the links.
        void queryClient.invalidateQueries({ queryKey: ["mentions"] });
        void queryClient.invalidateQueries({ queryKey: ["search"] });
        return null;
      }),
    [queryClient, write, focusedNote],
  );

  /**
   * Write `text`, an older version of `note`, back over it, answering null once
   * it landed or the reason it did not.
   *
   * `linkMentionOf`'s guards, for its reasons: the press was made in a pane
   * other than the note's. One `saveNote` naming `against` as its base and not
   * `updateNote`, whose retry reads the note again and would land the old text
   * over a write the reader never saw in the diff. A refusal rereads the note
   * instead, so the diff shows what the vault holds now. `from` is the jj
   * change the text comes from, which the backend names in a change of the
   * restore's own.
   */
  const restoreOf = useCallback(
    (note: string, text: string, against: string, from: string): Promise<string | null> =>
      write(note, async () => {
        // Asked inside the queue, so after any write of the note queued ahead.
        if (heldText(note) !== undefined) return "That note holds text not yet saved";
        const focused = focusedNote.current;
        if (focused.path === note) return "That note is open to type in";
        // The flush the note's editor sent as the focus left it for this pane
        // is one of these.
        if (focused.isWriting(note)) return "That note is still being saved";

        let written: Awaited<ReturnType<typeof saveNote>>;
        try {
          written = await saveNote(note, text, false, noteBase(against), from);
        } catch (error) {
          if (!(error instanceof ChangedOnDisk)) return "The change was not restored";
          void queryClient.invalidateQueries({ queryKey: ["note", note] });
          return "The note changed since this diff was drawn";
        }

        queryClient.setQueryData(["note", note], written.content);
        // The restore is a jj change of its own, to go at the top of the list.
        void queryClient.invalidateQueries({ queryKey: ["note", note, "history"] });
        return null;
      }),
    [queryClient, write, focusedNote],
  );

  // The focused pane's note is the only note that can be typed into, so its
  // taking the focus is the earliest signal there is that typing may start.
  // The guard above would refuse the write anyway when the timer fired; what
  // this buys is that the work is dropped rather than left armed for a minute.
  //
  // It drops the wait and keeps the place. Forgetting where the reader got to
  // as well would mean the ordinary session, turn some pages, click into the
  // note, write a paragraph, close the reader, never bookmarks anything at all.
  useEffect(() => {
    if (panePath !== undefined) cancel(panePath);
  }, [panePath, cancel]);

  return {
    write,
    mark,
    moved,
    flush,
    keepPosition,
    takeHighlight,
    linkMentionOf,
    restoreOf,
  };
}
