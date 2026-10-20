import { useQueryClient } from "@tanstack/react-query";
import type { Dispatch, SetStateAction } from "react";
import { Editor } from "@/components/editor";
import { NoteEditor } from "@/components/note-editor";
import { PersonFooter } from "@/components/person-card";
import { heldText } from "@/lib/held-text";
import type { TreeCommands } from "@/lib/key-bindings";
import type { Pane } from "@/lib/panes";
import type { useAutosave } from "@/lib/use-autosave";
import type { BufferSync } from "@/lib/use-buffer-sync";
import type { GuardedWrites } from "@/lib/use-guarded-writes";
import type { Listings } from "@/lib/use-listings";
import type { NoteOpening } from "@/lib/use-note-opening";
import type { TodoActions } from "@/lib/use-todo-actions";

type Autosave = ReturnType<typeof useAutosave>;

/** What an unfocused pane's editor reports its typing to, which is nowhere. */
const IGNORE = () => {};

/** The note in a pane, or the empty editor a pane holds before any note is opened in it. */
export function NotePane({
  shown,
  focused,
  focusSignal,
  commands,
  preview,
  archive,
  listings,
  opening,
  mark,
  buffer,
  allowReload,
  onSave,
  onCycleTodo,
  onNotice,
}: {
  shown: Pane;
  focused: boolean;
  focusSignal: number;
  commands: TreeCommands;
  preview: boolean;
  archive: boolean;
  listings: Pick<Listings, "data" | "linkable" | "images" | "tags" | "relations">;
  opening: Pick<NoteOpening, "follow" | "embeds" | "openPassage" | "openInPane">;
  mark: GuardedWrites["mark"];
  buffer: Pick<BufferSync, "held" | "standbyReload" | "typed" | "reload">;
  allowReload: Autosave["allowReload"];
  onSave: Autosave["save"];
  onCycleTodo: TodoActions["logCycledTodo"];
  onNotice: Dispatch<SetStateAction<string | undefined>>;
}) {
  const queryClient = useQueryClient();
  const { held, standbyReload, typed, reload } = buffer;
  const { follow, embeds, openPassage, openInPane } = opening;
  const { linkable, images, tags, relations, data } = listings;

  return shown.path === undefined ? (
    // An empty pane is an editor on an empty document, which is
    // what the window has always shown with no note open. It
    // costs nothing and it is what keeps every leader key working
    // in a fresh split: the alternative is a second resolver for
    // panes that hold no CodeMirror to press keys into.
    //
    // ponytail: text typed into one goes nowhere, and closing the
    // pane discards it. Give it a scratch path in the vault if
    // that ever costs anybody real writing.
    <Editor
      initialDoc=""
      commands={commands}
      preview={preview}
      paths={linkable}
      images={images}
      tags={tags}
      focusSignal={focused ? focusSignal : 0}
      focused={focused}
      onFollow={follow}
      embeds={embeds}
    />
  ) : (
    // A column rather than the editor alone, so a person's note
    // can carry their card at its foot. `PersonFooter` draws
    // nothing under every other note, which leaves the editor the
    // whole pane it has always had.
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1">
        <NoteEditor
          path={shown.path}
          commands={commands}
          preview={preview}
          paths={linkable}
          images={images}
          tags={tags}
          relations={relations}
          startLine={shown.line}
          jump={shown.jump}
          focusSignal={focused ? focusSignal : 0}
          focused={focused}
          // Only the focused pane reports its typing. Nothing else can
          // be typed into, and an unfocused pane that somehow did
          // would be writing its text to the focused pane's path.
          onChange={focused ? typed : IGNORE}
          // Asked for the focused pane alone, for the reason its
          // typing is reported alone: the autosave follows that pane,
          // so any other pane asking would be handing it a question
          // about a note it is not holding. An unfocused pane cannot
          // be typed into, so it reloads, except where it shows text
          // held as a conflict: see `standbyReload`.
          allowReload={focused ? allowReload : standbyReload(shown.id)}
          // The focused pane alone, for the reason its typing is
          // reported alone: the note this reads is the one the
          // autosave follows, which is the note in that pane.
          onReload={focused ? reload : undefined}
          // Every pane, not the focused one alone: a restored
          // pane out of focus has to open on the held text too,
          // or the autosave finds the vault's text on screen
          // when the focus arrives and never offers it (#495).
          // It takes the text on that arrival, the editor
          // showing it; till then `standbyReload` keeps it there.
          // `held` is read for the re-render, `heldText` for the
          // content, which the list does not carry. Against the
          // cached text, the entry the autosave would take.
          held={
            held.some((each) => each.path === shown.path)
              ? heldText(shown.path, queryClient.getQueryData<string>(["note", shown.path]))
                  ?.content
              : undefined
          }
          mark={mark?.note === shown.path ? mark : undefined}
          onSave={onSave}
          onFollow={follow}
          onCycleTodo={onCycleTodo}
          onOpenHighlight={openPassage}
          onNotice={onNotice}
          embeds={embeds}
        />
      </div>
      <PersonFooter
        path={shown.path}
        paths={data}
        archive={archive}
        onOpen={(path, hitLine) => void openInPane(path, hitLine)}
      />
    </div>
  );
}
