import { keepVideoSettings, readVideoSettings } from "@/lib/video-settings";

const denied = () => {
  throw new DOMException("denied", "SecurityError");
};

afterEach(() => {
  vi.restoreAllMocks();
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
