import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { languages } from "@codemirror/language-data";
import { Compartment, EditorState, Facet } from "@codemirror/state";
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

/**
 * Holds live preview so `<leader>p` can swap it out.
 *
 * A compartment rather than a rebuilt view: rebuilding throws away the undo
 * history and the cursor, and turning the rendering off is not meant to cost
 * either. One instance for the module is right, because a compartment is only
 * an identity, and each state configures it separately.
 */
const preview = new Compartment();

interface EditorProps {
  /** The document to open. Only read on mount; pass a `key` to open another note. */
  initialDoc: string;
  /** What the leader keys reach for. Absent leaves them inert. */
  commands?: EditorCommands;
  /** Whether markdown is rendered. Held by the route, so it outlives a remount. */
  preview?: boolean;
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
export function Editor({
  initialDoc,
  commands,
  preview: rendered = true,
  onChange,
  onSave,
}: EditorProps) {
  const host = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  // Every prop lives in a ref so the mount effect depends on nothing. Rebuilding
  // the view throws away undo history and cursor position, so it must happen
  // exactly once: to open a different note, remount with a `key`.
  const initialDocRef = useRef(initialDoc);
  const renderedRef = useRef(rendered);
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
            togglePreview: () => commandsRef.current?.togglePreview(),
          }),
          basicSetup,
          markdown({
            base: markdownLanguage,
            codeLanguages: languages,
            extensions: [Highlight],
          }),
          preview.of(renderedRef.current ? livePreview() : []),
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
    viewRef.current = view;

    return () => {
      viewRef.current = null;
      view.destroy();
    };
  }, []);

  // Swapping the extension out is all this takes: the same `livePreview()`
  // pieces come back by identity, so nothing below them is rebuilt.
  useEffect(() => {
    viewRef.current?.dispatch({
      effects: preview.reconfigure(rendered ? livePreview() : []),
    });
  }, [rendered]);

  return <div ref={host} className="h-full overflow-auto" />;
}
