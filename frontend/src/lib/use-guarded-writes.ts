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
import { newId } from "@/lib/todo/todo";
import { useBookmark } from "@/lib/use-bookmark";
import { useNoteWrites } from "@/lib/use-note-writes";
import { setWatched } from "@/lib/video/video";

export type GuardedWrites = ReturnType<typeof useGuardedWrites>;

/**
 * Writes into a note nobody is typing in: reader and video positions, highlights, links, restores.
 * They share one queue, so none races another into the same file.
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
   * The video position waiting for a note, and which note wants it. A new object per report.
   * The editor applies it to its buffer, not the vault's copy, so an unsaved paragraph survives.
   * No wait first: the autosave already sets how often the disk hears of it.
   * ponytail: lost when no pane holds the note; use `writePosition` if that costs positions.
   */
  const [mark, setMark] = useState<{ note: string; id: string; seconds: number }>();
  // Whole-note writers queue here so bookmarks never race highlights. The editor's save stays
  // out: holding it behind another writer would cost more than the race.
  const write = useNoteWrites();

  /**
   * Writes a position into a note nobody types in. `apply` sets the field: `reading:` for the
   * reader, one `watching:` entry for the player. Answers false when refused, and never throws.
   * The read happens inside, so a caller's older text cannot undo the write.
   */
  const writePosition = useCallback(
    (note: string, apply: (text: string) => string): Promise<boolean> =>
      write(note, async () => {
        // Skip a note being typed into or saved: refusals there cost tries, and typing wins.
        // Read off the ref: a timer that fired must see what is true now.
        const focused = focusedNote.current;
        if (focused.path === note || focused.isWriting(note)) return false;

        // Not in the listing, or the listing has not arrived: refuse rather than write blind.
        if (!queryClient.getQueryData<string[]>(["files"])?.includes(note)) return false;

        const written = await updateNote(note, (text) => {
          // Asked again: the read took a round trip, and a save can start in between.
          const now = focusedNote.current;
          return now.path === note || now.isWriting(note) ? null : apply(text);
        }).then(
          (landed) => landed,
          // Gone, or refused over its base three times.
          () => null,
        );
        if (written === null) return false;

        // setQueryData, not invalidation: the PUT answers with the note as it landed.
        queryClient.setQueryData(["note", note], written.content);
        return true;
      }),
    [queryClient, write, focusedNote],
  );

  const { moved, flush, cancel } = useBookmark((note, cfi) =>
    writePosition(note, (text) => {
      // Rides the position write, not the upload: a refused write is retried on the next page, and
      // a file dropped in from the shell is read without an upload.
      // Type from the reader's cache, falling back to `Book` when it is empty.
      const beside = queryClient.getQueryData<BookBeside>(["book", note]);
      // Only over `Note` or nothing: a type set by hand is the reader's to keep.
      const held = readField(text, "type");
      const typed =
        held === undefined || held === "Note"
          ? setField(text, "type", beside === undefined ? "Book" : bookType(beside.path))
          : text;
      return setField(typed, "reading", cfi);
    }),
  );

  /**
   * Keeps a video's position: the focused note takes it in its buffer, others are written direct.
   * Nothing is lost either way.
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
   * Writes a passage the reader took into the note beside the book. Unlike a bookmark, it ignores
   * focus and dirty state: a highlight is a press, so it is written regardless.
   */
  const takeHighlight = useCallback(
    (note: string, passage: Passage): Promise<string | null> =>
      write(note, async () => {
        // The press clears the notice.
        setNotice(undefined);
        // The pane already shows `No book at ...`; this is the key's own sentence.
        if (!queryClient.getQueryData<string[]>(["files"])?.includes(note)) {
          setNotice("That note has left the vault");
          return null;
        }

        // Minted outside the change, so a retry writes the same id.
        const id = newId("hl-");
        // Escaped like a page's text, so a chapter named `## Dump` cannot become a heading.
        const escaped: Passage = {
          ...passage,
          text: escapedParagraphs(passage.text).join("\n"),
          chapter: escapedParagraphs(passage.chapter).join(" "),
        };
        // Whether the read reached the change, which tells the two failures apart.
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
   * Turns an unlinked mention of `target` into a `[[link]]`. Answers null once it landed,
   * else the reason. Takes the bookmark's guards, since the press came from the panel.
   * Unsaved text in the note refuses it too.
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
        // The reason: `updateNote` answers null for any cause, so the sentence is kept here.
        let why = "The link was not written";
        const written = await updateNote(note, (text) => {
          // Asked again: the read took a round trip.
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
   * Writes an older `text` of `note` back, answering null once it landed, else the reason.
   * One `saveNote` on `against`. `updateNote`'s retry would land old text over an unseen write.
   */
  const restoreOf = useCallback(
    (note: string, text: string, against: string, from: string): Promise<string | null> =>
      write(note, async () => {
        // Asked inside the queue, so after any write of the note queued ahead.
        if (heldText(note) !== undefined) return "That note holds text not yet saved";
        const focused = focusedNote.current;
        if (focused.path === note) return "That note is open to type in";
        // The editor's flush on focus-out is one of these.
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

  // Focus means typing may start: drop the pending wait, but keep the position.
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
