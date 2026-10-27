/**
 * The one haptic of the redesign: a short buzz when a swipe grades a card. #790
 * calls it. Nothing else buzzes, so a phone never shakes for a tap.
 *
 * Browsers without `navigator.vibrate` (iOS Safari, desktop) get nothing, and
 * that is the intent: the buzz is a bonus, never something a reader must feel.
 */
export function gradeTick(): void {
  if ("vibrate" in navigator) navigator.vibrate(8);
}
