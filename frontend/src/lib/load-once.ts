/**
 * `load`, run once and its result kept, unless it fails.
 *
 * A failed load is forgotten, so the next call asks again (#637, #647): kept,
 * one chunk fetch lost while offline would break every formula or diagram
 * until reload.
 */
export function loadOnce<T>(load: () => Promise<T>): () => Promise<T> {
  let loading: Promise<T> | null = null;
  return () => {
    loading ??= load().catch((error: unknown) => {
      loading = null;
      throw error;
    });
    return loading;
  };
}
