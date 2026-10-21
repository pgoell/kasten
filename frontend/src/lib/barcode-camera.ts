/**
 * The camera a barcode scan holds: the rear camera's stream on a video, the decoder
 * reading its frames, and every track stopped the moment the scan ends.
 *
 * The food panel keeps its button and its words. The camera's rules live here, so a
 * stream is stopped on every path that ends a scan.
 */

import { type Decoder, decoderFor } from "@/lib/barcode";

export const NO_CAMERA = "No camera here; type the barcode instead";

/** How often a scan looks at the camera's frame: quick enough for a held barcode, light on the page. */
const SCAN_MS = 150;

/** How a scan ended on its own: a code was read, or the camera or the reader did not run. */
export type ScanEnd = { code: string } | { why: string };

const DID_NOT_START = "The camera did not start; type the barcode instead";

/** Why the camera would not open, in the panel's words. An error not listed still ends the scan, with its own words. */
function cameraWords(error: unknown): string {
  if (error instanceof DOMException) {
    if (error.name === "NotAllowedError" || error.name === "SecurityError") {
      return "The camera is not allowed; type the barcode instead";
    }
    if (["NotFoundError", "OverconstrainedError", "NotReadableError"].includes(error.name)) {
      return NO_CAMERA;
    }
  }
  return DID_NOT_START;
}

function stopTracks(stream: MediaStream): void {
  for (const track of stream.getTracks()) track.stop();
}

/**
 * Opens the rear camera on `video` and reads its frames until one holds a barcode.
 * `ended` runs when the scan ends by itself, with the outcome, or with none when the
 * page hid or the panel left. The returned function stops the scan and does not call `ended`.
 */
export function startCamera(
  video: HTMLVideoElement,
  root: Element,
  ended: (outcome?: ScanEnd) => void,
): () => void {
  let live = true;
  let stream: MediaStream | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;

  function release(): void {
    live = false;
    if (stream !== null) stopTracks(stream);
    stream = null;
    video.srcObject = null;
    video.hidden = true;
    clearTimeout(timer);
    document.removeEventListener("visibilitychange", onVisibility);
  }

  function finish(outcome?: ScanEnd): void {
    release();
    ended(outcome);
  }

  /** play() rejects when a newer load or a pause cut it short, which is no failure of the scan. */
  function playVideo(): void {
    video.play().catch((error: unknown) => {
      if (error instanceof DOMException && ["AbortError", "NotAllowedError"].includes(error.name)) {
        return;
      }
      if (live) finish({ why: DID_NOT_START });
    });
  }

  // A tab shown again does not restart the camera: the user presses Scan for that.
  function onVisibility(): void {
    if (document.hidden) finish();
  }

  function tick(decode: Decoder): void {
    timer = undefined;
    // The panel is gone when the card closed it or the editor view went, so the camera goes with it.
    if (!root.isConnected) {
      finish();
      return;
    }
    // A card rebuild moves the panel, and the browser pauses a video it moves.
    if (video.paused) playVideo();
    decode(video).then(
      (code) => {
        if (!live) return;
        if (code === null) {
          timer = setTimeout(() => tick(decode), SCAN_MS);
          return;
        }
        finish({ code });
      },
      // A decoder that fails must not leave the camera running, so the scan ends and says so.
      () => {
        if (live) finish({ why: "The barcode reader failed; type the barcode instead" });
      },
    );
  }

  function attach(granted: MediaStream): void {
    // A camera granted after the scan was stopped is no one's, so its tracks stop at once.
    if (!live) {
      stopTracks(granted);
      return;
    }
    stream = granted;
    video.srcObject = granted;
    video.hidden = false;
    playVideo();
    decoderFor().then(
      (decode) => {
        if (live) tick(decode);
      },
      () => {
        if (live) finish({ why: "The barcode reader did not load; type the barcode instead" });
      },
    );
  }

  document.addEventListener("visibilitychange", onVisibility);
  navigator.mediaDevices
    .getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false })
    .then(attach, (error: unknown) => {
      if (live) finish({ why: cameraWords(error) });
    });

  return () => {
    if (live) release();
  };
}
