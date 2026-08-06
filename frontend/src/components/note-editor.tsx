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
  /** Line to open on, which a search hit names and nothing else does. */
  startLine?: number;
  onChange: (doc: string) => void;
  onSave: () => void;
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
  startLine,
  onChange,
  onSave,
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
      commands={commands}
      preview={preview}
      startLine={startLine}
      onChange={onChange}
      onSave={onSave}
    />
  );
});
