import { createFileRoute } from "@tanstack/react-router";
import { Editor } from "@/components/editor";

const SAMPLE = `# kasten

Notes are plain markdown files on disk. Postgres holds only a derived index,
so you can always rebuild it from the vault.

Link notes with [[wikilinks]].
`;

function Home() {
  return (
    <main className="h-dvh">
      <Editor initialDoc={SAMPLE} />
    </main>
  );
}

export const Route = createFileRoute("/")({ component: Home });
