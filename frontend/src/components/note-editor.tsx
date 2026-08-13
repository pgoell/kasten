import { useQuery } from "@tanstack/react-query";
import { memo } from "react";
import { Editor } from "@/components/editor";
import { fetchNote } from "@/lib/api";
import type { EditorCommands } from "@/lib/key-bindings";
import type { TodoCycle } from "@/lib/todo-commands";

interface NoteEditorProps {
  /** Vault-relative path of the note to open. */
  path: string;
  commands: EditorCommands;
  preview: boolean;
  /** Every note in the vault, which the editor completes and resolves against. */
  paths?: string[];
  /** Every image in the vault, which the editor completes a `![](` against. */
  images?: string[];
  /** Line to open on, which a search hit names and nothing else does. */
  startLine?: number;
  /** Raised when the pane this sits in has been moved to. See `Editor`. */
  focusSignal?: number;
  /** Whether the pane this sits in is the focused one. See `Editor`. */
  focused?: boolean;
  onChange: (doc: string) => void;
  onSave: () => void;
  /** Asked before the vault's text goes in, and can refuse. See `Editor`. */
  allowReload?: (text: string) => boolean;
  /** Asked for the vault's text on `:e`, and can refuse. See `Editor`. */
  onReload?: (force: boolean) => Promise<string | null>;
  /** Called with the note a `[[link]]` names, which only the route can resolve. */
  onFollow: (target: string) => void;
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
}

const MESSAGE = "flex h-full items-center justify-center px-4 text-sm text-one-muted";

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
  startLine,
  focusSignal,
  focused,
  onChange,
  onSave,
  onFollow,
  onOpenHighlight,
  onCycleTodo,
  onNotice,
  allowReload,
  onReload,
}: NoteEditorProps) {
  const { data, error, isPending } = useQuery({
    queryKey: ["note", path],
    queryFn: () => fetchNote(path),
  });

  if (isPending) return <p className={MESSAGE}>Opening {path}</p>;
  // Only while there is nothing to show. Every write to the vault reads this
  // note again, and a read that failed with the note already open is a blip on
  // one of those: what is on screen, edits included, is the only copy of it
  // there is, and swapping it for a message throws that away.
  if (error && data === undefined) return <p className={MESSAGE}>Could not open {path}</p>;

  return (
    <Editor
      key={path}
      initialDoc={data}
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
      startLine={startLine}
      focusSignal={focusSignal}
      focused={focused}
      allowReload={allowReload}
      onReload={onReload}
      onChange={onChange}
      onSave={onSave}
      onFollow={onFollow}
      onOpenHighlight={(quote) => onOpenHighlight?.(path, quote)}
      onCycleTodo={(cycle) => onCycleTodo?.(path, cycle)}
      onNotice={onNotice}
      path={path}
    />
  );
});
