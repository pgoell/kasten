import { EditorState, type Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { vim } from "@replit/codemirror-vim";
import { fireEvent } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { vimModeField, vimModeState } from "@/lib/editor/vim-mode";
import { type Food, fetchLog, readBarcode, searchFood } from "@/lib/log/food-api";
import { logCard } from "@/lib/log/log-card";
import { addMyFood, fetchMyFoods } from "@/lib/log/my-foods";
import { notePath } from "@/lib/todo/todo-commands";

vi.mock("@/lib/log/food-api", () => ({
  searchFood: vi.fn(),
  readBarcode: vi.fn(),
  fetchLog: vi.fn(),
}));
vi.mock("@/lib/log/my-foods", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/log/my-foods")>()),
  fetchMyFoods: vi.fn(),
  addMyFood: vi.fn(),
}));

const DAILY = "01 Periodic/00 Daily/2026-10-20.md";
const NOTE = "# 2026-10-20 Tuesday\n\n## Log\n- 💧 500 ml\n\n## Done\n- [ ] write";
const ALL_FORMATS = ["ean_13", "ean_8", "upc_a", "upc_e"];

const mounted: EditorView[] = [];

afterEach(() => {
  for (const view of mounted.splice(0)) {
    view.destroy();
    view.dom.parentElement?.remove();
  }
});

/** A view on `doc` with the card and `extra`, the cursor at `anchor`. */
function mount(doc: string, path = DAILY, extra: Extension[] = [], anchor = 0): EditorView {
  const parent = document.body.appendChild(document.createElement("div"));
  const view = new EditorView({
    state: EditorState.create({
      doc,
      selection: { anchor },
      extensions: [notePath.of(path), logCard, ...extra],
    }),
    parent,
  });
  mounted.push(view);
  return view;
}

const text = (view: EditorView) => view.state.doc.toString();

/** Presses the card's button with this aria-label, or fails the test where there is none. */
function press(view: EditorView, label: string): void {
  const found = view.dom.querySelector<HTMLButtonElement>(`.cm-log button[aria-label='${label}']`);
  expect(found).not.toBeNull();
  found?.click();
}

/** A Snickers as the barcode read answers it: one serving of 50 g, and what that serving holds. */
const SNICKERS: Food = {
  code: "5000159461122",
  name: "Snickers",
  brand: "Mars Wrigley Confectionery UK Limited",
  serving_g: 50,
  serving_from: "serving_quantity",
  per_100g: { kcal: 481, protein: 8.6, carbs: 60.5, fat: 22.5 },
  per_serving: { kcal: 240, protein: 4.3, carbs: 30.2, fat: 11.2 },
};

/** The same product as a search answers it: no serving, so the grams are the default 100. */
const HIT: Food = {
  ...SNICKERS,
  serving_g: 100,
  serving_from: "default",
  per_serving: { kcal: 481, protein: 8.6, carbs: 60.5, fat: 22.5 },
};

const foodQuery = (view: EditorView) =>
  view.dom.querySelector<HTMLInputElement>(".cm-log-food-query");
const foodWhy = (view: EditorView) => view.dom.querySelector(".cm-log-food-why")?.textContent;
const cameraOf = (view: EditorView) =>
  view.dom.querySelector<HTMLVideoElement>(".cm-log-food-camera");
const servingOf = (view: EditorView) => view.dom.querySelector<HTMLElement>(".cm-log-food-serving");
const resultsOf = (view: EditorView) => view.dom.querySelector<HTMLElement>(".cm-log-food-results");

/** The query, or a failed expectation where the panel is not open. */
function queryOf(view: EditorView): HTMLInputElement {
  const query = foodQuery(view);
  expect(query).not.toBeNull();
  return query as HTMLInputElement;
}

/** The scan button, or a failed expectation where the panel has none. */
function scanOf(view: EditorView): HTMLButtonElement {
  const button = view.dom.querySelector<HTMLButtonElement>(".cm-log-food-scan");
  expect(button).not.toBeNull();
  return button as HTMLButtonElement;
}

/** Clicks the element that matches `selector`, or fails the test where there is none. */
function clickOn(view: EditorView, selector: string): void {
  const found = view.dom.querySelector<HTMLElement>(selector);
  expect(found).not.toBeNull();
  found?.click();
}

/** Presses the card's 🍽 button, or fails the test where there is none. */
async function openFood(view: EditorView): Promise<void> {
  const button = view.dom.querySelector<HTMLButtonElement>(".cm-log button[aria-label='Log food']");
  expect(button).not.toBeNull();
  button?.click();
  // The sheet is drawn in a microtask after the press, so the call waits for that one turn.
  await Promise.resolve();
}

/** Types `text` into the open panel, and lets the pause pass so the search is sent. */
async function typeQuery(view: EditorView, text: string): Promise<void> {
  fireEvent.input(queryOf(view), { target: { value: text } });
  await vi.advanceTimersByTimeAsync(400);
}

/** Presses the first result, and lets the barcode read answer. */
async function pickFirst(view: EditorView): Promise<void> {
  const first = view.dom.querySelector<HTMLButtonElement>(".cm-log-food-results button");
  expect(first).not.toBeNull();
  first?.click();
  await vi.advanceTimersByTimeAsync(0);
}

function logFood(view: EditorView): void {
  const button = view.dom.querySelector<HTMLButtonElement>("button[aria-label='Log this food']");
  expect(button).not.toBeNull();
  button?.click();
}

/** Presses the scan button, and lets the camera grant and the first frame land. */
async function startScan(view: EditorView): Promise<void> {
  scanOf(view).click();
  await vi.advanceTimersByTimeAsync(0);
}

/** A barcode detector that reads `formats`, and whose frames are answered by `detectFrame`. */
const detectFrame = vi.fn();

function stubDetector(formats: string[]): void {
  Object.defineProperty(globalThis, "BarcodeDetector", {
    configurable: true,
    value: class {
      static getSupportedFormats = async () => formats;
      detect = detectFrame;
    },
  });
}

let tracks: { stop: ReturnType<typeof vi.fn> }[] = [];
let stream: MediaStream;
let getUserMedia: ReturnType<typeof vi.fn>;
let play: ReturnType<typeof vi.fn>;
let paused = false;

const playOriginal = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, "play");
const pausedOriginal = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, "paused");

/** Every track of the camera stream stopped, which is what a scan must leave behind. */
function expectStopped(): void {
  for (const track of tracks) expect(track.stop).toHaveBeenCalled();
}

describe("the barcode scan", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // Lunch by the hour, so the meal every test logs under is known.
    vi.setSystemTime(new Date(2026, 9, 20, 12, 30));
    vi.mocked(searchFood).mockReset().mockResolvedValue([HIT]);
    vi.mocked(readBarcode).mockReset().mockResolvedValue(SNICKERS);
    vi.mocked(fetchLog).mockReset().mockResolvedValue([]);
    vi.mocked(fetchMyFoods).mockReset().mockResolvedValue({ foods: [], broken: [] });
    vi.mocked(addMyFood).mockReset().mockResolvedValue(undefined);
    tracks = [{ stop: vi.fn() }, { stop: vi.fn() }];
    stream = { getTracks: () => tracks, getVideoTracks: () => tracks } as unknown as MediaStream;
    getUserMedia = vi.fn().mockResolvedValue(stream);
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia },
    });
    paused = false;
    play = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(HTMLMediaElement.prototype, "play", { configurable: true, value: play });
    Object.defineProperty(HTMLMediaElement.prototype, "paused", {
      configurable: true,
      get: () => paused,
    });
    detectFrame.mockReset().mockResolvedValue([]);
    stubDetector(ALL_FORMATS);
  });

  afterEach(() => {
    vi.useRealTimers();
    Reflect.deleteProperty(navigator, "mediaDevices");
    Reflect.deleteProperty(globalThis, "BarcodeDetector");
    Reflect.deleteProperty(document, "hidden");
    Reflect.deleteProperty(navigator, "sendBeacon");
    if (playOriginal) Object.defineProperty(HTMLMediaElement.prototype, "play", playOriginal);
    if (pausedOriginal) Object.defineProperty(HTMLMediaElement.prototype, "paused", pausedOriginal);
  });

  it("#622 the scan button asks for the rear camera at ideal environment with no audio", async () => {
    const view = mount(NOTE);
    await openFood(view);
    await startScan(view);
    expect(getUserMedia).toHaveBeenCalledWith({
      video: { facingMode: { ideal: "environment" } },
      audio: false,
    });
  });

  it("#622 a hit stops every track hides the camera and opens the product in the serving form", async () => {
    detectFrame.mockResolvedValueOnce([{ rawValue: SNICKERS.code, format: "ean_13" }]);
    const view = mount(NOTE);
    await openFood(view);
    await startScan(view);
    expectStopped();
    expect(cameraOf(view)?.hidden).toBe(true);
    expect(readBarcode).toHaveBeenCalledWith(SNICKERS.code);
    expect(view.dom.querySelector(".cm-log-food-heading")?.textContent).toBe("Snickers");
    expect(servingOf(view)?.hidden).toBe(false);
  });

  it("#622 BarcodeDetector with all four formats is used for the hit", async () => {
    detectFrame.mockResolvedValueOnce([{ rawValue: SNICKERS.code, format: "ean_13" }]);
    const view = mount(NOTE);
    await openFood(view);
    await startScan(view);
    expect(detectFrame).toHaveBeenCalled();
    expect(readBarcode).toHaveBeenCalledWith(SNICKERS.code);
  });

  it("#622 BarcodeDetector without the four formats is never asked to detect", async () => {
    stubDetector(["qr_code"]);
    const view = mount(NOTE);
    await openFood(view);
    await startScan(view);
    await vi.advanceTimersByTimeAsync(150);
    expect(detectFrame).not.toHaveBeenCalled();
  });

  it("#622 no BarcodeDetector at all never throws and a close stops every track", async () => {
    Reflect.deleteProperty(globalThis, "BarcodeDetector");
    const view = mount(NOTE);
    await openFood(view);
    await startScan(view);
    clickOn(view, ".cm-log-food-close");
    expectStopped();
  });

  it("#622 a refused camera says so and the typed field still searches", async () => {
    getUserMedia.mockRejectedValueOnce(new DOMException("Permission denied", "NotAllowedError"));
    const view = mount(NOTE);
    await openFood(view);
    await startScan(view);
    expect(foodWhy(view)).toBe("The camera is not allowed; type the barcode instead");
    await typeQuery(view, "snickers");
    expect(searchFood).toHaveBeenCalledWith("snickers");
  });

  it("#622 no camera says so", async () => {
    Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: undefined });
    const view = mount(NOTE);
    await openFood(view);
    scanOf(view).click();
    expect(foodWhy(view)).toBe("No camera here; type the barcode instead");
    expect(getUserMedia).not.toHaveBeenCalled();
  });

  it("#622 Close stops every track", async () => {
    const view = mount(NOTE);
    await openFood(view);
    await startScan(view);
    clickOn(view, ".cm-log-food-close");
    expectStopped();
  });

  it("#622 Escape stops every track", async () => {
    const view = mount(NOTE);
    await openFood(view);
    await startScan(view);
    fireEvent.keyDown(queryOf(view), { key: "Escape" });
    expectStopped();
    // The sheet leaves by its own close, which takes a turn of the timers to unmount.
    await vi.advanceTimersByTimeAsync(1000);
    expect(foodQuery(view)).toBeNull();
  });

  it("#622 a log stops every track", async () => {
    const view = mount(NOTE);
    await openFood(view);
    await startScan(view);
    await typeQuery(view, "snickers");
    await pickFirst(view);
    logFood(view);
    expectStopped();
    expect(text(view)).toContain("- 🍽 lunch:");
  });

  it("#622 the editor view going stops every track", async () => {
    const view = mount(NOTE);
    await openFood(view);
    await startScan(view);
    const parent = view.dom.parentElement;
    view.destroy();
    parent?.remove();
    await vi.advanceTimersByTimeAsync(150);
    expectStopped();
  });

  it("#622 the tab hiding stops every track and showing it again does not restart", async () => {
    const view = mount(NOTE);
    await openFood(view);
    await startScan(view);
    Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
    document.dispatchEvent(new Event("visibilitychange"));
    expectStopped();
    Reflect.deleteProperty(document, "hidden");
    document.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(150);
    expect(getUserMedia).toHaveBeenCalledTimes(1);
    expect(cameraOf(view)?.hidden).toBe(true);
  });

  it("#622 a camera granted after the panel closed is stopped at once", async () => {
    let grant: (granted: MediaStream) => void = () => {};
    getUserMedia.mockReturnValueOnce(
      new Promise<MediaStream>((resolve) => {
        grant = resolve;
      }),
    );
    const view = mount(NOTE);
    await openFood(view);
    scanOf(view).click();
    clickOn(view, ".cm-log-food-close");
    grant(stream);
    await vi.advanceTimersByTimeAsync(0);
    expectStopped();
  });

  it("#622 a second press while scanning opens no second stream", async () => {
    const view = mount(NOTE);
    await openFood(view);
    await startScan(view);
    scanOf(view).click();
    await vi.advanceTimersByTimeAsync(0);
    expect(getUserMedia).toHaveBeenCalledTimes(1);
    expectStopped();
  });

  it("#622 an unknown barcode says Open Food Facts has no such product and logs nothing", async () => {
    detectFrame.mockResolvedValueOnce([{ rawValue: "4006381333931", format: "ean_13" }]);
    vi.mocked(readBarcode).mockRejectedValueOnce(
      new Error("No food with barcode 4006381333931 on Open Food Facts"),
    );
    const view = mount(NOTE);
    await openFood(view);
    await startScan(view);
    expect(foodWhy(view)).toBe(
      "No food with barcode 4006381333931 on Open Food Facts; search by name or add it as your own",
    );
    expect(servingOf(view)?.hidden).toBe(true);
    expect(resultsOf(view)?.hidden).toBe(false);
    expect(document.activeElement).toBe(queryOf(view));
    expect(text(view)).toBe(NOTE);
  });

  it("#622 a UPC-E hit reads its UPC-A", async () => {
    detectFrame.mockResolvedValueOnce([{ rawValue: "01234565", format: "upc_e" }]);
    const view = mount(NOTE);
    await openFood(view);
    await startScan(view);
    expect(readBarcode).toHaveBeenCalledWith("012345000065");
  });

  it("#622 one code seen over many frames reads once", async () => {
    detectFrame.mockResolvedValue([{ rawValue: SNICKERS.code, format: "ean_13" }]);
    const view = mount(NOTE);
    await openFood(view);
    await startScan(view);
    await vi.advanceTimersByTimeAsync(1000);
    expect(readBarcode).toHaveBeenCalledTimes(1);
  });

  it("#622 a barcode read that answers after Close draws nothing", async () => {
    let answer: (food: Food) => void = () => {};
    vi.mocked(readBarcode).mockReturnValueOnce(
      new Promise<Food>((resolve) => {
        answer = resolve;
      }),
    );
    detectFrame.mockResolvedValueOnce([{ rawValue: SNICKERS.code, format: "ean_13" }]);
    const view = mount(NOTE);
    await openFood(view);
    await startScan(view);
    expect(readBarcode).toHaveBeenCalledWith(SNICKERS.code);
    clickOn(view, ".cm-log-food-close");
    answer(SNICKERS);
    await vi.advanceTimersByTimeAsync(0);
    expect(foodQuery(view)).toBeNull();
    expect(text(view)).toBe(NOTE);
  });

  it("#622 no decode runs after a stop", async () => {
    const view = mount(NOTE);
    await openFood(view);
    await startScan(view);
    clickOn(view, ".cm-log-food-close");
    const looks = detectFrame.mock.calls.length;
    await vi.advanceTimersByTimeAsync(1000);
    expect(detectFrame).toHaveBeenCalledTimes(looks);
  });

  it("#622 a decoder that fails stops every track and says so", async () => {
    detectFrame.mockRejectedValueOnce(new Error("x"));
    const view = mount(NOTE);
    await openFood(view);
    await startScan(view);
    expectStopped();
    expect(foodWhy(view)).toBe("The barcode reader failed; type the barcode instead");
  });

  it("#622 a camera that fails to start for another reason says so and the scan button reads Scan again", async () => {
    getUserMedia.mockRejectedValueOnce(
      new DOMException("Timeout starting video source", "AbortError"),
    );
    const view = mount(NOTE);
    await openFood(view);
    await startScan(view);
    expect(foodWhy(view)).toBe("The camera did not start; type the barcode instead");
    expect(scanOf(view).textContent).toBe("Scan");
  });

  it("#622 an unknown barcode after a found one goes back to the name search and logs nothing", async () => {
    detectFrame.mockResolvedValueOnce([{ rawValue: SNICKERS.code, format: "ean_13" }]);
    const view = mount(NOTE);
    await openFood(view);
    await startScan(view);
    expect(servingOf(view)?.hidden).toBe(false);
    detectFrame.mockResolvedValueOnce([{ rawValue: "4006381333931", format: "ean_13" }]);
    vi.mocked(readBarcode).mockRejectedValueOnce(
      new Error("No food with barcode 4006381333931 on Open Food Facts"),
    );
    await startScan(view);
    expect(servingOf(view)?.hidden).toBe(true);
    expect(resultsOf(view)?.hidden).toBe(false);
    expect(foodWhy(view)).toContain("No food with barcode 4006381333931");
    logFood(view);
    expect(text(view)).toBe(NOTE);
  });

  it("#622 a scan hit answered after a later pick draws nothing", async () => {
    let answer: (food: Food) => void = () => {};
    vi.mocked(readBarcode).mockReturnValueOnce(
      new Promise<Food>((resolve) => {
        answer = resolve;
      }),
    );
    detectFrame.mockResolvedValueOnce([{ rawValue: SNICKERS.code, format: "ean_13" }]);
    const view = mount(NOTE);
    await openFood(view);
    await startScan(view);
    await typeQuery(view, "snickers");
    await pickFirst(view);
    expect(view.dom.querySelector(".cm-log-food-heading")?.textContent).toBe("Snickers");
    answer({ ...SNICKERS, code: "3017620422003", name: "Skyr", brand: null });
    await vi.advanceTimersByTimeAsync(0);
    expect(view.dom.querySelector(".cm-log-food-heading")?.textContent).toBe("Snickers");
  });

  it("#622 a drink tap while scanning keeps the camera playing", async () => {
    const view = mount(NOTE);
    await openFood(view);
    await startScan(view);
    paused = true;
    const before = play.mock.calls.length;
    press(view, "Log water");
    await vi.advanceTimersByTimeAsync(150);
    expect(play.mock.calls.length).toBeGreaterThan(before);
    expect(tracks[0]?.stop).not.toHaveBeenCalled();
  });

  it("#622 with vim on keys on the scan button never reach vim and Escape closes the scanner", async () => {
    const view = mount(NOTE, DAILY, [vim(), vimModeState()]);
    await openFood(view);
    await startScan(view);
    fireEvent.keyDown(scanOf(view), { key: "i" });
    fireEvent.keyDown(scanOf(view), { key: "u" });
    expect(view.state.field(vimModeField)).toBe("normal");
    expect(text(view)).toBe(NOTE);
    fireEvent.keyDown(scanOf(view), { key: "Escape" });
    await vi.advanceTimersByTimeAsync(1000);
    expect(foodQuery(view)).toBeNull();
    expectStopped();
  });

  it("#622 the only request a scan makes is the barcode read", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response());
    const beacon = vi.fn(() => true);
    Object.defineProperty(navigator, "sendBeacon", { configurable: true, value: beacon });
    detectFrame.mockResolvedValueOnce([{ rawValue: SNICKERS.code, format: "ean_13" }]);
    const view = mount(NOTE);
    await openFood(view);
    await startScan(view);
    expect(readBarcode).toHaveBeenCalledTimes(1);
    expect(readBarcode).toHaveBeenCalledWith(SNICKERS.code);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(beacon).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});
