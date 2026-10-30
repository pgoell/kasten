/**
 * The one haptic: a short buzz when a swipe grades a card (#790). Nothing else buzzes, so a
 * phone never shakes for a tap. No `navigator.vibrate` means no buzz, which is fine: it is a bonus.
 */
export function gradeTick(): void {
  if ("vibrate" in navigator) navigator.vibrate(8);
}
