/**
 * Runs `load` once and keeps its result, unless it fails: a failed load is forgotten, so the
 * next call asks again (#637, #647).
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
