import { useQuery, useQueryClient } from "@tanstack/react-query";
import { memo, type ReactNode, useContext, useRef } from "react";
import { Editor } from "@/components/editor";
import { fetchNote, type TodoHit } from "@/lib/api";
import type { FileTarget } from "@/lib/editor/editor-follow";
import type { EmbedSource } from "@/lib/embed";
import type { EditorCommands } from "@/lib/key-bindings";
import { Leaving, useBlurWhenLeaving, useLeaving } from "@/lib/leaving";
import type { Outline } from "@/lib/note/note-head";
import { parseTodo } from "@/lib/todo/todo";
import type { TodoCycle } from "@/lib/todo/todo-commands";

interface NoteEditorProps {
  /** Vault-relative path of the note to open. */
  path: string;
  commands: EditorCommands;
  preview: boolean;
  /** Every note in the vault, which the editor completes and resolves against. */
  paths?: string[];
  /** Every image in the vault, which the editor completes a `![](` against. */
  images?: string[];
  /** Every tag in the vault, which the editor completes an open `#` against. */
  tags?: string[];
  /** Every relation name the ontology note lists, which the editor completes. */
  relations?: string[];
  /** Line to open on, which a search hit names and nothing else does. */
  startLine?: number;
  /** Raised with each open at `startLine`. See `Editor`. */
  jump?: number;
  /** Raised when the pane this sits in has been moved to. See `Editor`. */
  focusSignal?: number;
  /** A video position for this note's frontmatter. See `Editor`. */
  mark?: { id: string; seconds: number };
  /** Whether the pane this sits in is the focused one. See `Editor`. */
  focused?: boolean;
  onChange: (doc: string) => void;
  onSave: () => void;
  /** Asked before the vault's text goes in, and can refuse. See `Editor`. */
  allowReload?: (text: string) => boolean;
  /** Asked for the vault's text on `:e`, and can refuse. See `Editor`. */
  onReload?: (force: boolean) => Promise<string | null>;
  /** Called with the note a `[[link]]` names, which only the route can resolve. */
  onFollow: (target: string, file?: FileTarget) => void;
  /**
   * Called with a highlight block's paragraphs and the note holding them.
   *
   * The path comes from here for the reason `onCycleTodo`'s does: the note is
   * what says which book the passage is in.
   */
  onOpenHighlight?: (note: string, quote: string[]) => void;
  /**
   * Called with the line `<leader>x` cycled, which the done log follows.
   *
   * The path comes from here rather than from the route's closure, this being
   * the component that knows which note the key was typed into.
   */
  onCycleTodo?: (path: string, cycle: TodoCycle) => void;
  /** Called with a sentence for the reader when a pasted image is refused. */
  onNotice?: (message: string) => void;
  /** How a `![[note]]` in this one reads and opens its note. See `Editor`. */
  embeds?: EmbedSource;
  /**
   * Text the vault refused for this note, which it opens on instead of the
   * vault's. The vault's still arrives as `reloadDoc`, and `allowReload` is
   * where the autosave takes the held text as its own.
   */
  held?: string;
  /** Called with the note's headings and the one being read. See `Editor`. */
  onOutline?: (outline: Outline) => void;
  /** Called when the header's Graph button is pressed, which opens the graph around this note. */
  onGraph?: () => void;
  /** Called with a time in this note, the seconds it names and the video it names, if any. */
  onSeek?: (note: string, seconds: number, id?: string) => void;
}

const MESSAGE = "flex h-full items-center justify-center px-4 text-sm text-k-muted";

/**
 * One note from the vault, open in the editor.
 *
 * The `key` is what makes opening a second note replace the first one's text.
 * The editor reads its document once, on mount, and a note that is already in
 * the cache arrives with no loading gap to remount across.
 *
 * Memoised because the save status lives above this component and the first
 * keystroke of an edit moves it, which re-rendered this whole subtree for a
 * reading only the status bar shows. None of these props change while a note
 * is typed into, so the memo turns that into nothing at all.
 */
export const NoteEditor = memo(function NoteEditor({
  path,
  commands,
  preview,
  paths,
  images,
  tags,
  relations,
  startLine,
  jump,
  focusSignal,
  mark,
  focused,
  onChange,
  onSave,
  onFollow,
  onOpenHighlight,
  onCycleTodo,
  onNotice,
  allowReload,
  onReload,
  embeds,
  held,
  onOutline,
  onGraph,
  onSeek,
}: NoteEditorProps) {
  const { data, error, isPending } = useQuery({
    queryKey: ["note", path],
    queryFn: () => fetchNote(path),
  });
  const queryClient = useQueryClient();
  // Off the todo pane's listing where the page holds one, read at the press
  // rather than subscribed to: no render of this note waits on the vault's todos.
  const idElsewhere = (id: string) =>
    (queryClient.getQueryData<TodoHit[]>(["todos", false]) ?? []).some(
      (hit) => hit.path !== path && parseTodo(hit.text)?.id === id,
    );

  let content: ReactNode;
  if (isPending) content = <p className={MESSAGE}>Opening {path}</p>;
  // Only while there is nothing to show. Every write to the vault reads this
  // note again, and a read that failed with the note already open is a blip on
  // one of those: what is on screen, edits included, is the only copy of it
  // there is, and swapping it for a message throws that away.
  else if (error && data === undefined) content = <p className={MESSAGE}>Could not open {path}</p>;
  else
    content = (
      <Editor
        key={path}
        // Read once, on mount, so held text let go later changes nothing here.
        initialDoc={held ?? data}
        // The same text, read a second time: `initialDoc` opens the note and
        // this one keeps it up to date. Two things move that cache: the autosave,
        // which puts the note the vault answered its write with straight into it,
        // and a refetch, which the route asks for when the vault reports a write
        // this editor did not make. The memo above is untouched by either, the
        // query living inside this component rather than in its props.
        reloadDoc={data}
        commands={commands}
        preview={preview}
        paths={paths}
        images={images}
        tags={tags}
        relations={relations}
        startLine={startLine}
        jump={jump}
        focusSignal={focusSignal}
        mark={mark}
        focused={focused}
        allowReload={allowReload}
        onReload={onReload}
        onChange={onChange}
        onSave={onSave}
        onFollow={onFollow}
        onOpenHighlight={(quote) => onOpenHighlight?.(path, quote)}
        onCycleTodo={(cycle) => onCycleTodo?.(path, cycle)}
        idElsewhere={idElsewhere}
        onNotice={onNotice}
        path={path}
        embeds={embeds}
        // The query client the review reads through, and the opener the embeds use, so a
        // Done row opens its note in this same pane.
        review={
          embeds === undefined
            ? undefined
            : { client: queryClient, open: (target, line) => embeds.open(target, line) }
        }
        onOutline={onOutline}
        onGraph={onGraph}
        onSeek={(seconds, id) => onSeek?.(path, seconds, id)}
      />
    );

  // The note that was open and is going out stays on the page for a task
  // (`useLeaving`), with the editor it last rendered. Its element is the one from
  // that commit, so the editor keeps the props it had and never gets the new
  // note's text.
  const gone = useLeaving(path, content);
  return [
    <Held key={path} leaving={false}>
      {content}
    </Held>,
    ...gone.map((each) => (
      <Held key={each.key} leaving>
        {each.value}
      </Held>
    )),
  ];
});

/**
 * One note's place in the pane, current or on its way out. Both states render
 * the same element, so a note that goes out and comes back in the same task
 * keeps its editor.
 */
function Held({ leaving, children }: { leaving: boolean; children: ReactNode }) {
  const element = useRef<HTMLDivElement>(null);
  // A pane that is leaving takes its note with it, so this one is leaving too,
  // even while the note itself is current. Without this the editor would stay
  // unaware and keep its view until the pane is taken down.
  const inPane = useContext(Leaving);
  useBlurWhenLeaving(element, leaving);
  // `contents` keeps the editor's own box where it was: its `h-full` still
  // resolves against the pane.
  return (
    <div
      ref={element}
      className={leaving ? "hidden" : "contents"}
      // Marks the editor on its way out, for `paneEditor` in pane-doc.ts, which
      // must not find the old note's editor while the new one is loading.
      data-leaving={leaving || undefined}
      aria-hidden={leaving || undefined}
      inert={leaving || undefined}
    >
      <Leaving.Provider value={leaving || inPane}>{children}</Leaving.Provider>
    </div>
  );
}
