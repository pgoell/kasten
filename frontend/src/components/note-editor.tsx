import { useQuery } from "@tanstack/react-query";
import { Editor } from "@/components/editor";
import { fetchNote } from "@/lib/api";

interface NoteEditorProps {
  /** Vault-relative path of the note to open. */
  path: string;
}

const MESSAGE = "flex h-full items-center justify-center px-4 text-sm text-one-muted";

/**
 * One note from the vault, open in the editor.
 *
 * The `key` is what makes opening a second note replace the first one's text.
 * The editor reads its document once, on mount, and a note that is already in
 * the cache arrives with no loading gap to remount across.
 */
export function NoteEditor({ path }: NoteEditorProps) {
  const { data, error, isPending } = useQuery({
    queryKey: ["note", path],
    queryFn: () => fetchNote(path),
  });

  if (isPending) return <p className={MESSAGE}>Opening {path}</p>;
  if (error) return <p className={MESSAGE}>Could not open {path}</p>;

  return <Editor key={path} initialDoc={data} />;
}
