import { useEffect, useRef } from "react";
import { FORMAT, INDENT, LEADER, TREE } from "@/lib/key-bindings";

/** Vim's spelling of a key is for vim. This is the one on the keyboard. */
function readable(key: string) {
  return key
    .replace(/^<|>$/g, "")
    .replace("C-", "Ctrl ")
    .replace("S-", "Shift ")
    .replace(/-/g, " ");
}

interface Group {
  title: string;
  keys: readonly { key: string; label: string }[];
}

function Table({ title, keys }: Group) {
  return (
    <section>
      <h3 className="mb-2 text-[11px] tracking-wider text-one-muted uppercase">{title}</h3>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-[13px]">
        {keys.map(({ key, label }) => (
          <div key={key} className="contents">
            <dt className="text-right whitespace-nowrap text-one-accent">{key}</dt>
            <dd className="text-one-fg">{label}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

/**
 * The whole key map, on one panel behind `<leader>?`.
 *
 * Everything on it is read from `key-bindings.ts`, the same table the vim
 * registrations are built from, so a key cannot appear here and be missing
 * from the editor.
 */
export function KeyHelp({ onClose }: { onClose: () => void }) {
  const panel = useRef<HTMLDivElement>(null);

  // The panel takes the focus so its own keys reach it, rather than reaching
  // whatever was focused when it opened, and hands it back on the way out.
  // Restoring what held it beats naming the editor: the same key opens this
  // from the file tree, and closing there belongs back in the tree.
  useEffect(() => {
    const opener = document.activeElement;
    panel.current?.focus();
    return () => {
      if (opener instanceof HTMLElement) opener.focus();
    };
  }, []);

  const groups: Group[] = [
    { title: "Leader", keys: LEADER.map(({ key, label }) => ({ key: `Space ${key}`, label })) },
    {
      title: "Editor",
      keys: [...FORMAT.map(({ key, label }) => ({ key: readable(key), label })), ...INDENT],
    },
    { title: "File tree", keys: TREE },
  ];

  return (
    <div
      ref={panel}
      role="dialog"
      aria-modal="true"
      aria-label="Keyboard shortcuts"
      tabIndex={-1}
      onKeyDown={(event) => {
        if (event.key !== "Escape" && event.key !== "q") return;
        event.preventDefault();
        onClose();
      }}
      className="fixed inset-0 z-20 flex items-center justify-center bg-black/50 focus:outline-none"
    >
      <div className="max-h-[80vh] overflow-auto rounded-md border border-one-line bg-one-panel px-6 py-5 font-mono shadow-xl">
        <div className="flex flex-col gap-5">
          {groups.map((group) => (
            <Table key={group.title} {...group} />
          ))}
        </div>
        <p className="mt-5 text-[11px] text-one-muted">Escape or q to close</p>
      </div>
    </div>
  );
}
