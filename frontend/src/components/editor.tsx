import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { languages } from "@codemirror/language-data";
import { EditorState, Facet } from "@codemirror/state";
import { oneDark } from "@codemirror/theme-one-dark";
import { EditorView, keymap } from "@codemirror/view";
import { Vim, vim } from "@replit/codemirror-vim";
import { basicSetup } from "codemirror";
import { useEffect, useRef } from "react";
import { editorCommands } from "@/lib/editor-commands";
import type { EditorCommands } from "@/lib/key-bindings";
import { livePreview } from "@/lib/live-preview";
import { Highlight } from "@/lib/markdown-highlight";

type SaveHandler = (doc: string) => void;

/**
 * Carries the save callback on the editor state.
 *
 * `Vim.defineEx` registers `:w` once for the whole module and cannot close over
 * one view's props, so the handler has to be reachable from the view it was
 * typed into. A facet is how CodeMirror hangs a value off a state.
 */
const saveHandler = Facet.define<SaveHandler, SaveHandler | undefined>({
  combine: (handlers) => handlers[0],
});

function save(view: EditorView): boolean {
  view.state.facet(saveHandler)?.(view.state.doc.toString());
  return true;
}

Vim.defineEx("write", "w", (cm: { cm6: EditorView }) => save(cm.cm6));

interface EditorProps {
  /** The document to open. Only read on mount; pass a `key` to open another note. */
  initialDoc: string;
  /** What the leader keys reach for. Absent leaves them inert. */
  commands?: EditorCommands;
  onChange?: (doc: string) => void;
  /** Called with the whole document on `:w` or ctrl+s. */
  onSave?: (doc: string) => void;
}

/**
 * A CodeMirror 6 markdown editor.
 *
 * The EditorView owns the document. Never mirror the text into React state:
 * re-rendering the tree on every keystroke is where CodeMirror-in-React
 * performance dies.
 */
export function Editor({ initialDoc, commands, onChange, onSave }: EditorProps) {
  const host = useRef<HTMLDivElement>(null);
  // Every prop lives in a ref so the mount effect depends on nothing. Rebuilding
  // the view throws away undo history and cursor position, so it must happen
  // exactly once: to open a different note, remount with a `key`.
  const initialDocRef = useRef(initialDoc);
  const commandsRef = useRef(commands);
  const onChangeRef = useRef(onChange);
  const onSaveRef = useRef(onSave);

  useEffect(() => {
    commandsRef.current = commands;
    onChangeRef.current = onChange;
    onSaveRef.current = onSave;
  }, [commands, onChange, onSave]);

  useEffect(() => {
    const parent = host.current;
    if (!parent) return;

    const view = new EditorView({
      state: EditorState.create({
        doc: initialDocRef.current,
        extensions: [
          // Must come first: whichever keymap is registered earliest wins, and
          // vim's bindings have to beat the ones basicSetup installs.
          vim(),
          // Ahead of basicSetup for the same reason: ctrl+s must reach us
          // rather than open the browser's save dialog.
          keymap.of([{ key: "Mod-s", run: save, preventDefault: true }]),
          saveHandler.of((doc) => onSaveRef.current?.(doc)),
          // Each one reads the ref rather than closing over the prop, so a
          // re-render never has to rebuild the view to refresh a callback.
          editorCommands.of({
            toggleTree: () => commandsRef.current?.toggleTree(),
          }),
          basicSetup,
          markdown({
            base: markdownLanguage,
            codeLanguages: languages,
            extensions: [Highlight],
          }),
          livePreview(),
          oneDark,
          EditorView.lineWrapping,
          EditorView.updateListener.of((update) => {
            if (update.docChanged) {
              onChangeRef.current?.(update.state.doc.toString());
            }
          }),
        ],
      }),
      parent,
    });

    return () => view.destroy();
  }, []);

  return <div ref={host} className="h-full overflow-auto" />;
}
