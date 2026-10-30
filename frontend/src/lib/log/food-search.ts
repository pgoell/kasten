/**
 * The food search on the log card: Open Food Facts or a barcode, your own foods, recent foods, and a quick kcal add.
 * The pure parts live in `food-math.ts`, and the forms in `food-serving.ts` and `food-quick-add.ts`.
 */

import { shiftDay } from "@/lib/clock";
import { NO_CAMERA, startCamera, torchButton } from "@/lib/log/barcode-camera";
import { addForm } from "@/lib/log/food-add";
import { type Food, fetchLog, readBarcode, searchFood } from "@/lib/log/food-api";
import { type Choice, make, recentFoods } from "@/lib/log/food-math";
import { quickAddForm } from "@/lib/log/food-quick-add";
import { servingForm } from "@/lib/log/food-serving";
import type { FoodGoals } from "@/lib/log/log-kinds";
import { type DrinkTotals, tenth } from "@/lib/log/log-lines";
import { fetchMyFoods, type MyFood, myChoice } from "@/lib/log/my-foods";

export { type Choice, GRAMS_END } from "@/lib/log/food-math";

/** How long the query waits for the typing to stop before it is sent. */
const PAUSE_MS = 400;
/** The shortest query sent, so one letter is not a call to Open Food Facts. */
const QUERY_MIN = 2;
const RECENT_DAYS = 30;

export interface PanelHooks {
  /** Writes the food line and closes the panel. */
  log: (line: string) => void;
  /** Closes the panel, writing nothing. */
  close: () => void;
  /** Today's food totals and the config's food goals, for the serving preview and the quick add's goal. */
  today: () => { eaten: DrinkTotals["food"]; goals: FoodGoals };
}

export interface FoodPanel {
  root: HTMLElement;
  /** Stops the camera and the torch. Closes nothing. */
  stop: () => void;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : "The food search failed";
}

/** One of the result sections, with its small heading and its rows. */
function section(title: string, rows: HTMLElement[]): HTMLElement {
  const made = make("div", "cm-log-food-section");
  made.append(make("div", "cm-log-food-section-title", title), ...rows);
  return made;
}

/** A result row: the name, the brand, the kcal per serving, and `mine` or `recent` where it is one. */
function pickButton(
  choice: Choice,
  tag: "mine" | "recent" | null,
  onPick: () => void,
): HTMLButtonElement {
  // A full-width row, so it takes the surface tint on a press rather than the shrink.
  const made = make("button", "cm-log-food-pick k-row");
  made.type = "button";
  made.append(make("span", "cm-log-food-name", choice.name));
  if (choice.brand !== null) made.append(make("span", "cm-log-food-brand", choice.brand));
  // Named by what it is per, since a search hit gives 100 g and a logged line gives its own amount.
  const kcal = choice.per_serving.kcal;
  const per = choice.serving_g === null ? "per serving" : `per ${tenth(choice.serving_g)} g`;
  made.append(
    make("span", "cm-log-food-kcal", kcal === null ? "no kcal" : `${Math.round(kcal)} kcal ${per}`),
  );
  // The tag is kept in the row for a reader of the words, but not drawn: the heading above says it.
  if (tag !== null) made.append(make("span", "cm-log-food-tag", tag));
  made.addEventListener("click", onPick);
  return made;
}

/**
 * The search panel, built each time the card opens it.
 * Answers are dropped once the element leaves the page, so a late search or read draws nothing.
 */
export function foodPanel(day: string | null, hooks: PanelHooks): FoodPanel {
  const root = make("div", "cm-log-food");
  const query = make("input", "cm-log-food-query");
  query.type = "text";
  query.placeholder = "food or barcode";
  query.setAttribute("aria-label", "Food");
  const why = make("div", "cm-log-food-why");
  const results = make("div", "cm-log-food-results");
  const say = (text: string) => {
    why.textContent = text;
  };

  const serving = servingForm({
    say,
    log: (line) => {
      stopScan();
      hooks.log(line);
    },
    back: () => showSearch(),
    today: hooks.today,
  });
  const quick = quickAddForm({
    say,
    log: (line) => {
      stopScan();
      hooks.log(line);
    },
  });

  const close = make("button", "cm-log-food-close", "Close");
  close.type = "button";
  const bar = make("div", "cm-log-food-bar");
  const scan = make("button", "cm-log-food-scan", "Scan");
  scan.type = "button";
  scan.setAttribute("aria-label", "Scan a barcode");
  const torch = torchButton();
  bar.append(query, scan, torch);
  const video = make("video", "cm-log-food-camera");
  video.playsInline = true;
  video.muted = true;
  video.autoplay = true;
  video.hidden = true;

  const add = make("button", "cm-log-food-new", "Add food");
  add.type = "button";
  add.setAttribute("aria-label", "Add a food of your own");
  const adding = addForm({
    say,
    saved: (food) => {
      mine = [...mine, food];
      unknownCode = null;
      show(myChoice(food));
    },
    back: () => showSearch(),
  });

  // The serving step comes last, so its foot is the last thing the sheet scrolls to.
  root.append(bar, video, why, results, quick, add, adding.root, close, serving.root);

  let mine: MyFood[] = [];
  let recents: Choice[] = [];
  let offHits: Food[] = [];
  let latest = 0;
  /** Counts the picks, so a barcode read answered after a later pick is dropped. */
  let pickTurn = 0;
  /** The last barcode Open Food Facts did not know, which the add form takes. */
  let unknownCode: string | null = null;
  let pause: ReturnType<typeof setTimeout> | undefined;
  /** Stops the camera of the scan running, or null while none runs. */
  let stopCamera: (() => void) | null = null;

  /** The sections in their order, each one drawn only where it has a row. */
  function render(): void {
    const typed = query.value.trim().toLowerCase();
    const ours = mine.filter(
      (food) => food.name.toLowerCase().includes(typed) || food.code === typed,
    );
    // A food of your own logged lately is the same food, so it is listed once, as yours.
    const names = new Set(mine.map((food) => food.name.toLowerCase()));
    const matches = recents.filter(
      (choice) =>
        choice.name.toLowerCase().includes(typed) && !names.has(choice.name.toLowerCase()),
    );
    const sections: [string, HTMLElement[]][] = [
      [
        "Mine",
        ours.map((food) => {
          const choice = myChoice(food);
          return pickButton(choice, "mine", () => pickRecent(choice));
        }),
      ],
      ["Recent", matches.map((choice) => pickButton(choice, "recent", () => pickRecent(choice)))],
      ["Open Food Facts", offHits.map((food) => pickButton(food, null, () => readPick(food)))],
    ];
    results.replaceChildren(
      ...sections
        .filter(([, rows]) => rows.length > 0)
        .map(([title, rows]) => section(title, rows)),
    );
  }

  function show(choice: Choice): void {
    why.textContent = "";
    serving.show(choice);
    serving.root.hidden = false;
    // The serving step leaves by its own Back, so its only exit is in the foot.
    close.hidden = true;
    results.hidden = true;
    add.hidden = true;
    quick.hidden = true;
    adding.root.hidden = true;
  }

  /** The add form, filled from the query and the last barcode Open Food Facts did not know. */
  function showAdd(): void {
    pickTurn += 1;
    serving.clear();
    results.hidden = true;
    add.hidden = true;
    quick.hidden = true;
    serving.root.hidden = true;
    adding.open(query.value, unknownCode);
  }

  function search(text: string): void {
    latest += 1;
    const turn = latest;
    searchFood(text).then(
      (found) => {
        if (turn !== latest || !root.isConnected) return;
        offHits = found;
        why.textContent = "";
        render();
      },
      (error: unknown) => {
        if (turn !== latest || !root.isConnected) return;
        offHits = [];
        why.textContent = messageOf(error);
        render();
      },
    );
  }

  /** A pick from the recent foods needs no read, but it still ends a read that is in the air. */
  function pickRecent(choice: Choice): void {
    pickTurn += 1;
    show(choice);
  }

  /** A pick from the search is read for its serving first, since a hit carries none. */
  function readPick(food: Food): void {
    pickTurn += 1;
    const turn = pickTurn;
    readBarcode(food.code).then(
      (full) => {
        // A read answered after a later pick would put this food back over that one.
        if (turn !== pickTurn || !root.isConnected) return;
        show(full);
      },
      (error: unknown) => {
        if (turn !== pickTurn || !root.isConnected) return;
        // The form is drawn first, since drawing it clears the message the form shows.
        show(food);
        why.textContent = messageOf(error);
      },
    );
  }

  /** The name search on screen, with no form: a read still in the air is for a form no longer shown, so it is dropped. */
  function showSearch(): void {
    pickTurn += 1;
    serving.clear();
    serving.root.hidden = true;
    close.hidden = false;
    adding.root.hidden = true;
    results.hidden = false;
    add.hidden = false;
    quick.hidden = false;
    render();
  }

  function readCode(code: string): void {
    pickTurn += 1;
    const turn = pickTurn;
    // A food of your own answers its barcode before Open Food Facts is asked.
    const ours = mine.find((food) => food.code === code);
    if (ours !== undefined) {
      show(myChoice(ours));
      return;
    }
    readBarcode(code).then(
      (full) => {
        if (turn !== pickTurn || !root.isConnected) return;
        show(full);
      },
      (error: unknown) => {
        if (turn !== pickTurn || !root.isConnected) return;
        // A form an earlier pick left up would take the name search's Log, so the search comes back first.
        showSearch();
        why.textContent = `${messageOf(error)}; search by name or add it as your own`;
        unknownCode = code;
        query.focus();
      },
    );
  }

  /** Starts a scan, or stops the one running: the button toggles. */
  function startScan(): void {
    if (stopCamera !== null) {
      stopScan();
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      why.textContent = NO_CAMERA;
      return;
    }
    why.textContent = "";
    scan.textContent = "Stop";
    stopCamera = startCamera(video, root, torch, (outcome) => {
      // The camera has stopped itself: a code was read, it did not run, or the page hid.
      stopCamera = null;
      scan.textContent = "Scan";
      if (outcome === undefined) return;
      if ("code" in outcome) {
        readCode(outcome.code);
        return;
      }
      why.textContent = outcome.why;
      query.focus();
    });
  }

  function stopScan(): void {
    stopCamera?.();
    stopCamera = null;
    scan.textContent = "Scan";
  }

  query.addEventListener("input", () => {
    if (pause !== undefined) clearTimeout(pause);
    render();
    pause = setTimeout(() => {
      const text = query.value.trim();
      if (text.length < QUERY_MIN) {
        // A search still in the air is dropped, so it cannot answer over the shorter query.
        latest += 1;
        offHits = [];
        render();
        return;
      }
      search(text);
    }, PAUSE_MS);
  });

  add.addEventListener("click", showAdd);

  // A key typed in the panel is the panel's own. The editor's keymap, vim's included,
  // sits above the panel, so the key must not reach it. Tab is let through, since the
  // sheet keeps the focus inside itself on Tab.
  // The camera stops with the panel, however the panel closes.
  const shut = () => {
    stopScan();
    hooks.close();
  };
  root.addEventListener("keydown", (event) => {
    if (event.key !== "Tab") event.stopPropagation();
    if (event.key === "Escape") shut();
  });
  scan.addEventListener("click", startScan);
  close.addEventListener("click", () => shut());

  fetchMyFoods().then((found) => {
    if (!root.isConnected) return;
    mine = found.foods;
    if (found.broken.length > 0) {
      why.textContent = found.broken
        .map(({ line, text }) => `Skipped line ${line} of foods.md: ${text}`)
        .join("; ");
    }
    render();
  });

  if (day !== null) {
    fetchLog(shiftDay(day, -RECENT_DAYS), day).then(
      (days) => {
        if (!root.isConnected) return;
        recents = recentFoods(days);
        render();
      },
      (error: unknown) => {
        if (!root.isConnected) return;
        why.textContent = messageOf(error);
      },
    );
  }

  return { root, stop: stopScan };
}
