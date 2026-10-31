import {
  applyVideoSettings,
  keepVideoSettings,
  readVideoSettings,
} from "@/lib/video/video-settings";

const denied = () => {
  throw new DOMException("denied", "SecurityError");
};

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

/** What applyVideoSettings sends for what is kept, as [func, args] pairs. */
function applied(kept: unknown): [string, unknown[]][] {
  localStorage.setItem("kasten.video.1", JSON.stringify(kept));
  const sent: [string, unknown[]][] = [];
  applyVideoSettings((func, args) => sent.push([func, args]));
  return sent;
}

describe("the volume a browser keeps (#1395)", () => {
  it("#1395 A3 a kept level and mute are sent to a player that reports ready", () => {
    expect(applied({ volume: 40, muted: true })).toEqual([
      ["setVolume", [40]],
      ["mute", []],
    ]);
  });

  it("#1395 A4 a value kept before volume still gives its speed and captions, and no volume", () => {
    expect(applied({ rate: 1.5, captions: true })).toEqual([["setPlaybackRate", [1.5]]]);
    expect(readVideoSettings()).toEqual({ rate: 1.5, captions: true });
  });

  it("#1395 I3 a kept level past either end or not a number never reaches the player as kept", () => {
    expect(applied({ volume: 150 })).toEqual([["setVolume", [100]]]);
    expect(applied({ volume: -5 })).toEqual([["setVolume", [0]]]);
    expect(applied({ volume: "loud", muted: "yes" })).toEqual([]);
  });
});

describe("the speed and captions a browser keeps", () => {
  it("#953 I8 answers nothing kept while reading the storage throws", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(denied);

    expect(readVideoSettings()).toEqual({});
  });

  it("#953 I8 keeps nothing, without an error, while writing the storage throws", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(denied);

    expect(() => keepVideoSettings({ rate: 2 })).not.toThrow();
  });
});
