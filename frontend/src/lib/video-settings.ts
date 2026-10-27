/**
 * The speed and captions a browser keeps for every player, note and pane alike.
 *
 * Kept per browser and not per note: a speed is a habit of the person watching,
 * and a note that held it would carry one reader's habit to every other.
 */

/** The browser key, versioned. Shape: {"rate": 1.5, "captions": true}, both optional. */
export const VIDEO_SETTINGS = "kasten.video.1";

export interface VideoSettings {
  rate?: number;
  captions?: boolean;
}

/** What this browser keeps; {} when nothing is kept, the value is not JSON, or storage throws. */
export function readVideoSettings(): VideoSettings {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(VIDEO_SETTINGS) ?? "{}");
    return typeof parsed === "object" && parsed !== null ? (parsed as VideoSettings) : {};
  } catch (_error: unknown) {
    // Storage that throws (private windows, blocked site data) or a value that
    // is not JSON: the players open at YouTube's defaults, as they did before.
    return {};
  }
}

/** Merge `change` into what is kept. Storage that throws is ignored (I8). */
export function keepVideoSettings(change: VideoSettings): void {
  try {
    localStorage.setItem(VIDEO_SETTINGS, JSON.stringify({ ...readVideoSettings(), ...change }));
  } catch (_error: unknown) {
    // A write refused by storage is dropped: the setting holds for this player
    // and is lost on reload, which is the same as having no storage at all.
  }
}

/**
 * Learn from one parsed player message: onPlaybackRateChange (number > 0) keeps
 * `rate`; apiInfoDelivery with a `captions` key keeps `captions`. Anything else:
 * nothing.
 *
 * The rate is learnt only from the change event. The first info delivery reports
 * 1 before the kept rate is applied, and reading that would overwrite the rate
 * the person chose.
 */
export function learnVideoSettings(message: unknown): void {
  if (typeof message !== "object" || message === null) return;
  const { event, info } = message as { event?: unknown; info?: unknown };
  if (event === "onPlaybackRateChange" && typeof info === "number" && info > 0) {
    keepVideoSettings({ rate: info });
    return;
  }
  if (event !== "apiInfoDelivery" || typeof info !== "object" || info === null) return;
  const { captions } = info as { captions?: { track?: { languageCode?: unknown } } };
  if (captions === undefined || typeof captions !== "object" || captions === null) return;
  // An empty track object is the player saying captions are off.
  const language = captions.track?.languageCode;
  keepVideoSettings({ captions: typeof language === "string" && language !== "" });
}

/**
 * For a player that just sent onReady: calls send("setPlaybackRate", [rate]) when
 * a rate other than 1 is kept.
 */
export function applyVideoSettings(send: (func: string, args: unknown[]) => void): void {
  const { rate } = readVideoSettings();
  if (rate !== undefined && rate !== 1) send("setPlaybackRate", [rate]);
}
