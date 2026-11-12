/**
 * A video file the vault holds, an mp4 or a webm, drawn as the browser's own player.
 * Not the YouTube player, which `panes/video` owns and calls a video.
 */

import { endsIn } from "@/lib/notes/links/note-path";
import { CLIP_SUFFIXES } from "@/lib/vault/file-kind";

/** Whether an `![](address)` names a video file, read as `isAudio` reads a sound's. */
export function isClipAddress(address: string): boolean {
  return endsIn(address, CLIP_SUFFIXES);
}

/**
 * The player for one video file. It never plays by itself, and reads only the head until played,
 * which the backend's range answers keep to a few kilobytes; a seek reads from where it lands.
 */
export function clipPlayer(source: string, onSize: () => void): HTMLVideoElement {
  const video = document.createElement("video");
  video.className = "cm-clip";
  video.controls = true;
  video.autoplay = false;
  video.playsInline = true;
  video.preload = "metadata";
  // Its height is unknown until the head is read, and the lines below were measured without it.
  video.addEventListener("loadedmetadata", onSize);
  video.src = source;
  return video;
}
