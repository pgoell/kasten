import { useQuery } from "@tanstack/react-query";
import { memo } from "react";
import { Editor } from "@/components/editor";
import { fetchNote } from "@/lib/api";
import type { EditorCommands } from "@/lib/key-bindings";

interface NoteEditorProps {
  /** Vault-relative path of the note to open. */
  path: string;
  commands: EditorCommands;
  preview: boolean;
  /** Every note in the vault, which the editor completes and resolves against. */
  paths?: string[];
  /** Line to open on, which a search hit names and nothing else does. */
  startLine?: number;
  /** Raised when the pane this sits in has been moved to. See `Editor`. */
  focusSignal?: number;
  onChange: (doc: string) => void;
  onSave: () => void;
  /** Called with the note a `[[link]]` names, which only the route can resolve. */
  onFollow: (target: string) => void;
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
  startLine,
  focusSignal,
  onChange,
  onSave,
  onFollow,
}: NoteEditorProps) {
  const { data, error, isPending } = useQuery({
    queryKey: ["note", path],
    queryFn: () => fetchNote(path),
  });

  if (isPending) return <p className={MESSAGE}>Opening {path}</p>;
  if (error) return <p className={MESSAGE}>Could not open {path}</p>;

  return (
    <Editor
      key={path}
      initialDoc={data}
      // The same text, read a second time: `initialDoc` opens the note and
      // this one keeps it up to date, because the query answers again whenever
      // the vault reports a write to this path. The memo above is untouched by
      // it, the query living inside this component rather than in its props.
      reloadDoc={data}
      commands={commands}
      preview={preview}
      paths={paths}
      startLine={startLine}
      focusSignal={focusSignal}
      onChange={onChange}
      onSave={onSave}
      onFollow={onFollow}
    />
  );
});
