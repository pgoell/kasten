import { EditorState, type Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { vim } from "@replit/codemirror-vim";
import { fireEvent } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type Food, fetchLog, readBarcode, searchFood } from "@/lib/food-api";
import { logCard } from "@/lib/log-card";
import { fetchMyFoods } from "@/lib/my-foods";
import { notePath } from "@/lib/todo/todo-commands";
import { vimModeField, vimModeState } from "@/lib/vim-mode";

vi.mock("@/lib/food-api", () => ({
  searchFood: vi.fn(),
  readBarcode: vi.fn(),
  fetchLog: vi.fn(),
}));
vi.mock("@/lib/my-foods", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/my-foods")>()),
  fetchMyFoods: vi.fn(),
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

/** The torch button, or a failed expectation where the panel has none. */
function torchOf(view: EditorView): HTMLButtonElement {
  const button = view.dom.querySelector<HTMLButtonElement>(".cm-log-food-torch");
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

/** Presses the torch button, and lets the track answer the change. */
async function pressTorch(view: EditorView): Promise<void> {
  torchOf(view).click();
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

/** A track of the fake camera: its stop, and for a torch its capabilities and constraints. */
type FakeTrack = {
  stop: ReturnType<typeof vi.fn>;
  getCapabilities?: () => object;
  applyConstraints?: ReturnType<typeof vi.fn>;
};

let tracks: FakeTrack[] = [];
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

/** Makes the camera's track one with a torch, and returns it so a test can read its calls. */
function torchTrack() {
  const track = {
    stop: vi.fn(),
    getCapabilities: () => ({ torch: true }),
    applyConstraints: vi.fn().mockResolvedValue(undefined),
  };
  tracks[0] = track;
  return track;
}

/** Gives the page a navigator.vibrate, and returns it so a test can read its calls. */
function withVibrate() {
  const vibrate = vi.fn();
  Object.defineProperty(navigator, "vibrate", { configurable: true, value: vibrate });
  return vibrate;
}

describe("the torch and the buzz on the barcode scan", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // Lunch by the hour, so the meal every test logs under is known.
    vi.setSystemTime(new Date(2026, 9, 20, 12, 30));
    vi.mocked(searchFood).mockReset().mockResolvedValue([HIT]);
    vi.mocked(readBarcode).mockReset().mockResolvedValue(SNICKERS);
    vi.mocked(fetchLog).mockReset().mockResolvedValue([]);
    vi.mocked(fetchMyFoods).mockReset().mockResolvedValue({ foods: [], broken: [] });
    tracks = [{ stop: vi.fn() }, { stop: vi.fn() }];
    stream = {
      getTracks: () => tracks,
      getVideoTracks: () => tracks,
    } as unknown as MediaStream;
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
    Reflect.deleteProperty(navigator, "vibrate");
    Reflect.deleteProperty(globalThis, "BarcodeDetector");
    Reflect.deleteProperty(document, "hidden");
    if (playOriginal) Object.defineProperty(HTMLMediaElement.prototype, "play", playOriginal);
    if (pausedOriginal) Object.defineProperty(HTMLMediaElement.prototype, "paused", pausedOriginal);
  });

  it("#765 a track with torch in its capabilities shows the torch button while scanning", async () => {
    torchTrack();
    const view = mount(NOTE);
    await openFood(view);
    await startScan(view);
    expect(torchOf(view).hidden).toBe(false);
  });

  it("#765 a track with no torch capability keeps the torch button hidden", async () => {
    tracks[0] = { stop: vi.fn(), getCapabilities: () => ({}) };
    const view = mount(NOTE);
    await openFood(view);
    await startScan(view);
    expect(torchOf(view).hidden).toBe(true);
  });

  it("#765 a track with no getCapabilities keeps the torch button hidden", async () => {
    const view = mount(NOTE);
    await openFood(view);
    await startScan(view);
    expect(torchOf(view).hidden).toBe(true);
  });

  it("#765 the torch button turns the torch on and then off", async () => {
    const track = torchTrack();
    const view = mount(NOTE);
    await openFood(view);
    await startScan(view);
    await pressTorch(view);
    expect(track.applyConstraints).toHaveBeenNthCalledWith(1, { advanced: [{ torch: true }] });
    await pressTorch(view);
    expect(track.applyConstraints).toHaveBeenNthCalledWith(2, { advanced: [{ torch: false }] });
  });

  it("#765 the torch button says its state with aria-pressed and the label Torch", async () => {
    torchTrack();
    const view = mount(NOTE);
    await openFood(view);
    await startScan(view);
    expect(torchOf(view).getAttribute("aria-label")).toBe("Torch");
    expect(torchOf(view).getAttribute("aria-pressed")).toBe("false");
    await pressTorch(view);
    expect(torchOf(view).getAttribute("aria-pressed")).toBe("true");
    await pressTorch(view);
    expect(torchOf(view).getAttribute("aria-pressed")).toBe("false");
  });

  it("#765 Stop turns the torch off", async () => {
    const track = torchTrack();
    const view = mount(NOTE);
    await openFood(view);
    await startScan(view);
    await pressTorch(view);
    expect(torchOf(view).getAttribute("aria-pressed")).toBe("true");
    scanOf(view).click();
    expect(track.applyConstraints).toHaveBeenLastCalledWith({ advanced: [{ torch: false }] });
    expectStopped();
  });

  it("#765 a hit turns the torch off", async () => {
    const track = torchTrack();
    const view = mount(NOTE);
    await openFood(view);
    await startScan(view);
    await pressTorch(view);
    expect(torchOf(view).getAttribute("aria-pressed")).toBe("true");
    detectFrame.mockResolvedValueOnce([{ rawValue: SNICKERS.code, format: "ean_13" }]);
    await vi.advanceTimersByTimeAsync(150);
    expect(readBarcode).toHaveBeenCalledWith(SNICKERS.code);
    expect(track.applyConstraints).toHaveBeenLastCalledWith({ advanced: [{ torch: false }] });
  });

  it("#765 Close turns the torch off", async () => {
    const track = torchTrack();
    const view = mount(NOTE);
    await openFood(view);
    await startScan(view);
    await pressTorch(view);
    expect(torchOf(view).getAttribute("aria-pressed")).toBe("true");
    clickOn(view, ".cm-log-food-close");
    expect(track.applyConstraints).toHaveBeenLastCalledWith({ advanced: [{ torch: false }] });
    expectStopped();
  });

  it("#765 Escape turns the torch off", async () => {
    const track = torchTrack();
    const view = mount(NOTE);
    await openFood(view);
    await startScan(view);
    await pressTorch(view);
    expect(torchOf(view).getAttribute("aria-pressed")).toBe("true");
    fireEvent.keyDown(queryOf(view), { key: "Escape" });
    expect(track.applyConstraints).toHaveBeenLastCalledWith({ advanced: [{ torch: false }] });
    // The sheet leaves by its own close, which takes a turn of the timers to unmount.
    await vi.advanceTimersByTimeAsync(1000);
    expect(foodQuery(view)).toBeNull();
  });

  it("#765 a log turns the torch off", async () => {
    const track = torchTrack();
    const view = mount(NOTE);
    await openFood(view);
    await startScan(view);
    await pressTorch(view);
    expect(torchOf(view).getAttribute("aria-pressed")).toBe("true");
    await typeQuery(view, "snickers");
    await pickFirst(view);
    logFood(view);
    expect(track.applyConstraints).toHaveBeenLastCalledWith({ advanced: [{ torch: false }] });
    expect(text(view)).toContain("- 🍽 lunch:");
  });

  it("#765 the editor view going turns the torch off", async () => {
    const track = torchTrack();
    const view = mount(NOTE);
    await openFood(view);
    await startScan(view);
    await pressTorch(view);
    expect(torchOf(view).getAttribute("aria-pressed")).toBe("true");
    const parent = view.dom.parentElement;
    view.destroy();
    parent?.remove();
    await vi.advanceTimersByTimeAsync(150);
    expect(track.applyConstraints).toHaveBeenLastCalledWith({ advanced: [{ torch: false }] });
  });

  it("#765 the tab hiding turns the torch off", async () => {
    const track = torchTrack();
    const view = mount(NOTE);
    await openFood(view);
    await startScan(view);
    await pressTorch(view);
    expect(torchOf(view).getAttribute("aria-pressed")).toBe("true");
    Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
    document.dispatchEvent(new Event("visibilitychange"));
    expect(track.applyConstraints).toHaveBeenLastCalledWith({ advanced: [{ torch: false }] });
  });

  it("#765 a refused torch leaves the scan running and the button off", async () => {
    const track = torchTrack();
    track.applyConstraints.mockRejectedValueOnce(new DOMException("Refused", "OperationError"));
    const view = mount(NOTE);
    await openFood(view);
    await startScan(view);
    await pressTorch(view);
    expect(track.stop).not.toHaveBeenCalled();
    expect(scanOf(view).textContent).toBe("Stop");
    expect(torchOf(view).getAttribute("aria-pressed")).toBe("false");
    expect(cameraOf(view)?.hidden).toBe(false);
    expect(foodWhy(view)).toBe("");
  });

  it("#765 the torch button hides when the scan ends and the next scan starts with the torch off", async () => {
    const track = torchTrack();
    const view = mount(NOTE);
    await openFood(view);
    await startScan(view);
    await pressTorch(view);
    scanOf(view).click();
    expect(torchOf(view).hidden).toBe(true);
    await startScan(view);
    expect(torchOf(view).hidden).toBe(false);
    expect(torchOf(view).getAttribute("aria-pressed")).toBe("false");
    await pressTorch(view);
    expect(track.applyConstraints).toHaveBeenLastCalledWith({ advanced: [{ torch: true }] });
  });

  it("#765 with vim on keys on the torch button never reach vim and Escape closes the scanner", async () => {
    torchTrack();
    const view = mount(NOTE, DAILY, [vim(), vimModeState()]);
    await openFood(view);
    await startScan(view);
    fireEvent.keyDown(torchOf(view), { key: "i" });
    fireEvent.keyDown(torchOf(view), { key: "u" });
    expect(view.state.field(vimModeField)).toBe("normal");
    expect(text(view)).toBe(NOTE);
    fireEvent.keyDown(torchOf(view), { key: "Escape" });
    // The sheet leaves by its own close, which takes a turn of the timers to unmount.
    await vi.advanceTimersByTimeAsync(1000);
    expect(foodQuery(view)).toBeNull();
    expectStopped();
  });

  it("#766 a hit buzzes once for 50 ms", async () => {
    const vibrate = withVibrate();
    detectFrame.mockResolvedValueOnce([{ rawValue: SNICKERS.code, format: "ean_13" }]);
    const view = mount(NOTE);
    await openFood(view);
    await startScan(view);
    expect(vibrate).toHaveBeenCalledTimes(1);
    expect(vibrate).toHaveBeenCalledWith(50);
  });

  it("#766 one code seen over many frames buzzes once", async () => {
    const vibrate = withVibrate();
    detectFrame.mockResolvedValue([{ rawValue: SNICKERS.code, format: "ean_13" }]);
    const view = mount(NOTE);
    await openFood(view);
    await startScan(view);
    await vi.advanceTimersByTimeAsync(1000);
    expect(vibrate).toHaveBeenCalledTimes(1);
  });

  it("#766 a stop after frames with no code never buzzes and the next hit buzzes once", async () => {
    const vibrate = withVibrate();
    const view = mount(NOTE);
    await openFood(view);
    await startScan(view);
    await vi.advanceTimersByTimeAsync(450);
    scanOf(view).click();
    expect(vibrate).not.toHaveBeenCalled();
    detectFrame.mockResolvedValueOnce([{ rawValue: SNICKERS.code, format: "ean_13" }]);
    await startScan(view);
    expect(vibrate).toHaveBeenCalledTimes(1);
    expect(vibrate).toHaveBeenCalledWith(50);
  });

  it("#766 a camera that fails to start never buzzes and the next hit buzzes once", async () => {
    const vibrate = withVibrate();
    getUserMedia.mockRejectedValueOnce(
      new DOMException("Timeout starting video source", "AbortError"),
    );
    const view = mount(NOTE);
    await openFood(view);
    await startScan(view);
    expect(vibrate).not.toHaveBeenCalled();
    detectFrame.mockResolvedValueOnce([{ rawValue: SNICKERS.code, format: "ean_13" }]);
    await startScan(view);
    expect(vibrate).toHaveBeenCalledTimes(1);
    expect(vibrate).toHaveBeenCalledWith(50);
  });

  it("#766 a hit with no navigator.vibrate reads the code with no error", async () => {
    detectFrame.mockResolvedValueOnce([{ rawValue: SNICKERS.code, format: "ean_13" }]);
    const view = mount(NOTE);
    await openFood(view);
    await startScan(view);
    expect(readBarcode).toHaveBeenCalledWith(SNICKERS.code);
    expect(servingOf(view)?.hidden).toBe(false);
  });
});
