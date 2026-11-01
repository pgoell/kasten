import { ChangedOnDisk } from "@/lib/api";
import { noteBase } from "@/lib/note-base";

type Read = (path: string) => Promise<string>;
type Save = (path: string, content: string, keepalive: boolean, base: string) => Promise<unknown>;

/** `updateNote` over the given read and save: three tries, rethrowing anything but `ChangedOnDisk`. */
export function updateWithTries(fetchNote: Read, saveNote: Save) {
  return async (path: string, change: (text: string) => string | null) => {
    for (let tries = 1; ; tries++) {
      const text = await fetchNote(path);
      const next = change(text);
      if (next === null) return null;
      try {
        return await saveNote(path, next, false, noteBase(text));
      } catch (error) {
        if (!(error instanceof ChangedOnDisk) || tries === 3) throw error;
      }
    }
  };
}
