import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { languages } from "@codemirror/language-data";
import { EditorState } from "@codemirror/state";
import { oneDark } from "@codemirror/theme-one-dark";
import { EditorView } from "@codemirror/view";
import { vim } from "@replit/codemirror-vim";
import { basicSetup } from "codemirror";
import { useEffect, useRef } from "react";

interface EditorProps {
  /** The document to open. Only read on mount; pass a `key` to open another note. */
  initialDoc: string;
  onChange?: (doc: string) => void;
}

/**
 * A CodeMirror 6 markdown editor.
 *
 * The EditorView owns the document. Never mirror the text into React state:
 * re-rendering the tree on every keystroke is where CodeMirror-in-React
 * performance dies.
 */
export function Editor({ initialDoc, onChange }: EditorProps) {
  const host = useRef<HTMLDivElement>(null);
  // Both props live in refs so the mount effect depends on nothing. Rebuilding
  // the view throws away undo history and cursor position, so it must happen
  // exactly once: to open a different note, remount with a `key`.
  const initialDocRef = useRef(initialDoc);
  const onChangeRef = useRef(onChange);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

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
          basicSetup,
          markdown({ base: markdownLanguage, codeLanguages: languages }),
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
