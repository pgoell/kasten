import { createContext, type RefObject, useEffect, useLayoutEffect, useRef, useState } from "react";

/**
 * Whether this subtree is on its way out, so the editors in it stop taking keys
 * and let go of the focus before they are taken down.
 */
export const Leaving = createContext(false);

/**
 * What was shown under earlier keys and has not been taken down yet, so the
 * part that leaves stays on the page, hidden, for one frame and a task.
 *
 * Taking a subtree down is the costly part of a switch: removing a CodeMirror
 * tree costs more than a task's budget on a phone. So the old one is kept
 * until the new one has painted, and removed in a task of its own.
 */
export function useLeaving<T>(key: string, value: T): { key: string; value: T }[] {
  const committed = useRef<{ key: string; value: T } | undefined>(undefined);
  const [seen, setSeen] = useState(key);
  const [leaving, setLeaving] = useState<{ key: string; value: T }[]>([]);
  // Stored during render, which is React's own pattern for a value that depends on
  // the previous render: the render is redone at once, before anything paints.
  if (seen !== key) {
    setSeen(key);
    const last = committed.current;
    if (last !== undefined) {
      setLeaving((before) => [...before.filter((each) => each.key !== last.key), last]);
    }
  }

  useLayoutEffect(() => {
    committed.current = { key, value };
  });

  useEffect(() => {
    if (leaving.length === 0) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    // A frame, so the new one paints first, then a task, so the teardown is a task of its own.
    const frame = requestAnimationFrame(() => {
      timer = setTimeout(() => setLeaving([]), 0);
    });
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(timer);
    };
  }, [leaving]);

  return leaving.filter((each) => each.key !== key);
}

/**
 * Takes the focus off an element that is leaving, if it holds it.
 *
 * The new editor takes the focus only when nothing holds it (`nothingFocused`
 * in editor.tsx), and a `display: none` element keeps the focus until the
 * browser's next style pass, which comes after the new editor's mount effect.
 */
export function useBlurWhenLeaving(element: RefObject<HTMLElement | null>, leaving: boolean) {
  // biome-ignore lint/correctness/useExhaustiveDependencies: the element is a ref that never changes, and the effect is for the change of `leaving` alone.
  useLayoutEffect(() => {
    if (!leaving || element.current === null) return;
    const active = document.activeElement;
    if (active instanceof HTMLElement && element.current.contains(active)) active.blur();
  }, [leaving]);
}
