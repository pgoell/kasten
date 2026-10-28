import { useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { type AnkiImport, importAnki, importAnkiLink } from "@/lib/anki-import";
import { whenKeysUp } from "@/lib/last-input";

/** The line under the import row, one for a file and a link alike. */
function summaryOf(done: AnkiImport): string {
  return (
    `${done.notes.length} deck${done.notes.length === 1 ? "" : "s"}, ${done.cards} cards: ` +
    `${done.added} added, ${done.updated} updated, ${done.kept} kept, ` +
    `${done.removed} removed in Anki` +
    (done.media > 0 ? `, ${done.media} media file${done.media === 1 ? "" : "s"}` : "")
  );
}

/**
 * The Anki import entry, closed until asked for, from a file or a link.
 *
 * It lives under the deck list, since an import is rare beside a sitting. Its
 * own state, so the decks above it never re-render for a keystroke in the link field.
 */
export function ReviewImport() {
  const [imported, setImported] = useState<string | null>(null);
  const [carry, setCarry] = useState(false);
  const [link, setLink] = useState("");
  const [linking, setLinking] = useState(false);
  const picker = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();

  /** Run one import, from a file or a link, and say on the line how it went. */
  function runImport(started: Promise<AnkiImport>): Promise<boolean> {
    setImported("Importing…");
    return started.then(
      (done) => {
        setImported(summaryOf(done));
        void queryClient.invalidateQueries({ queryKey: ["cards"] });
        void queryClient.invalidateQueries({ queryKey: ["files"] });
        return true;
      },
      (error: unknown) => {
        setImported(error instanceof Error ? error.message : "the import failed");
        return false;
      },
    );
  }

  return (
    // `details` hides what it holds rather than unmounting it, so closing it keeps
    // the summary line, the tick and a half-typed link.
    <details className="mt-8 border-k-rule border-t pt-3 text-k-13 text-k-muted">
      {/* Not `flex`: the browser draws the open and closed triangle only on
          a summary left as a list item, and that triangle is what says this
          line opens. */}
      <summary className="min-h-11 cursor-pointer content-center hover:text-k-accent">
        Import an Anki deck
      </summary>
      <div className="flex flex-wrap items-center gap-x-6">
        {/* A plain file input rather than a prompt of our own: the browser
            already has a file picker, and this one has to work on a phone.
            Hidden, because a file input draws as grey text that reads as no
            control, and the button below presses it. */}
        <input
          ref={picker}
          type="file"
          accept=".apkg"
          aria-label="Import an Anki deck"
          tabIndex={-1}
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            // The value is cleared so picking the same file twice fires twice,
            // which is what a failed import wants to let you retry.
            event.target.value = "";
            if (file === undefined) return;
            // Floored, so the line never reads 100% while a piece is still
            // on its way; once all are in, the backend is what is busy.
            void runImport(
              importAnki(file, carry, (sent, total) =>
                setImported(
                  sent === total ? "Importing…" : `Uploading ${Math.floor((100 * sent) / total)}%…`,
                ),
              ),
            );
          }}
        />
        <button
          type="button"
          onClick={() => whenKeysUp(() => picker.current?.click())}
          className="my-1 min-h-11 rounded border border-k-rule px-3 text-k-ink hover:border-k-accent hover:text-k-accent"
        >
          Choose an .apkg file
        </button>
        {/* Off by default: a re-import keeps the schedule kasten has been
            building unless you say Anki's is the one to trust. */}
        <label className="flex min-h-11 cursor-pointer items-center gap-2 hover:text-k-accent">
          <input
            type="checkbox"
            checked={carry}
            onChange={(event) => setCarry(event.target.checked)}
            className="size-4 accent-k-accent"
          />
          <span>Carry Anki's schedule</span>
        </label>
        {/* A form so Enter at a desk and Go on a phone keyboard both submit.
            The field keeps a link that failed, to retry, and clears on one
            that landed. */}
        {/* `noValidate`, or the browser refuses a link it thinks is no URL
            with its own bubble and the backend's sentence never shows. */}
        <form
          noValidate
          className="flex min-w-0 flex-1 basis-64 items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            const url = link.trim();
            // `linking` and not only the disabled button: Enter in the field
            // submits the form whatever state the button is in.
            if (url === "" || linking) return;
            setLinking(true);
            void runImport(importAnkiLink(url, carry)).then((landed) => {
              setLinking(false);
              if (landed) setLink("");
            });
          }}
        >
          <input
            type="url"
            inputMode="url"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            aria-label="a link to an Anki deck"
            placeholder="or paste a link to a deck"
            value={link}
            onChange={(event) => setLink(event.target.value)}
            className="my-1 min-h-11 min-w-0 flex-1 rounded border border-k-rule bg-transparent px-2 text-k-ink outline-none placeholder:text-k-muted focus:border-k-accent"
          />
          <button
            type="submit"
            disabled={linking}
            className="min-h-11 px-1 hover:text-k-accent disabled:opacity-50"
          >
            Import link
          </button>
        </form>
      </div>
      {imported !== null && <p className="truncate pb-2 text-k-ink">{imported}</p>}
    </details>
  );
}
