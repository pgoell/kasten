import { createContext, type RefObject, useEffect, useLayoutEffect, useRef, useState } from "react";

/** Whether this subtree is leaving: its editors drop keys and focus before removal. */
export const Leaving = createContext(false);

/**
 * Earlier keys' content, kept on the page until the new one paints. Removing a CodeMirror tree
 * costs more than a phone's task budget, so the teardown runs in a task of its own.
 */
export function useLeaving<T>(key: string, value: T): { key: string; value: T }[] {
  const committed = useRef<{ key: string; value: T } | undefined>(undefined);
  const [seen, setSeen] = useState(key);
  const [leaving, setLeaving] = useState<{ key: string; value: T }[]>([]);
  // Stored during render, as React advises for state derived from the previous render.
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
    // Frame first, so the new one paints before the teardown task.
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
 * Takes the focus off a leaving element: it keeps focus until the next style pass, after the
 * new editor mounts and takes focus only when nothing holds it.
 */
export function useBlurWhenLeaving(element: RefObject<HTMLElement | null>, leaving: boolean) {
  // biome-ignore lint/correctness/useExhaustiveDependencies: the element is a ref that never changes, and the effect is for the change of `leaving` alone.
  useLayoutEffect(() => {
    if (!leaving || element.current === null) return;
    const active = document.activeElement;
    if (active instanceof HTMLElement && element.current.contains(active)) active.blur();
  }, [leaving]);
}
