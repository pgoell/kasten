/** The pieces the session screen is built of: elements, a stepper row, a choice row, the clock. */

export function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const made = document.createElement(tag);
  made.className = className;
  if (text !== undefined) made.textContent = text;
  return made;
}

export function button(className: string, text: string, onClick: () => void): HTMLButtonElement {
  const made = element("button", className, text);
  made.type = "button";
  made.addEventListener("click", onClick);
  return made;
}

/** `125` seconds as `2:05`. */
export function clock(seconds: number): string {
  const whole = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

export interface Stepper {
  label: string;
  value: () => number;
  step: number;
  min: number;
  max: number;
  unit: string;
  set: (value: number) => void;
}

/** A row of `−`, the value and `+`, each button a thumb wide. */
export function stepperRow(stepper: Stepper): HTMLElement {
  const row = element("div", "k-train-row");
  const shown = element("output", "k-train-value");
  const paint = () => {
    shown.textContent = `${String(Math.round(stepper.value() * 100) / 100)}${stepper.unit}`;
  };
  const move = (by: number) => {
    const next = Math.round((stepper.value() + by) * 100) / 100;
    stepper.set(Math.min(stepper.max, Math.max(stepper.min, next)));
    paint();
  };
  const less = button("k-train-step", "−", () => move(-stepper.step));
  const more = button("k-train-step", "+", () => move(stepper.step));
  less.setAttribute("aria-label", `${stepper.label} down ${stepper.step}`);
  more.setAttribute("aria-label", `${stepper.label} up ${stepper.step}`);
  shown.setAttribute("aria-live", "polite");
  paint();
  row.append(element("span", "k-train-label", stepper.label), less, shown, more);
  return row;
}

/** A row of buttons of which one or none is pressed; pressing the pressed one lets it go. */
export function choiceRow<T>(
  label: string,
  options: { value: T; text: string }[],
  chosen: () => T | null,
  choose: (value: T | null) => void,
): HTMLElement {
  const row = element("div", "k-train-row k-train-choices");
  row.setAttribute("role", "group");
  row.setAttribute("aria-label", label);
  const buttons = options.map((option) => {
    const made = button("k-train-choice", option.text, () => {
      choose(chosen() === option.value ? null : option.value);
      paint();
    });
    return { made, option };
  });
  const paint = () => {
    for (const { made, option } of buttons) {
      made.setAttribute("aria-pressed", String(chosen() === option.value));
    }
  };
  paint();
  row.append(element("span", "k-train-label", label), ...buttons.map(({ made }) => made));
  return row;
}
