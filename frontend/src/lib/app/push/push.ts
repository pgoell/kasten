import type { components } from "@/lib/api-types";
import { client, reason } from "@/lib/core/api-client";

/** The key a browser subscribes with (null where push is not set up) and every device. */
export type PushState = components["schemas"]["PushOut"];

/** One subscribed device, without its keys. */
export type Device = components["schemas"]["DeviceOut"];

/** Every subscribed device and the server's public key. */
export async function fetchPush(): Promise<PushState> {
  const { data, response } = await client.GET("/api/push");

  if (!data) {
    throw new Error(`GET /api/push failed with ${response.status}`);
  }

  return data;
}

/** Subscribe a device by its endpoint and keys. The same endpoint again updates that device. */
export async function addDevice(body: components["schemas"]["DeviceIn"]): Promise<Device> {
  const { data, error, response } = await client.POST("/api/push/devices", { body });

  if (!data) {
    throw new Error(reason(error) ?? `POST /api/push/devices failed with ${response.status}`);
  }

  return data;
}

/** Stop sending pushes to one device. */
export async function removeDevice(id: number): Promise<void> {
  const { response } = await client.DELETE("/api/push/devices/{device_id}", {
    params: { path: { device_id: id } },
  });

  if (!response.ok) {
    throw new Error(`DELETE /api/push/devices/${id} failed with ${response.status}`);
  }
}

/** What the push service answered a test push; `status` is null when it was not reached. */
export type TestResult = components["schemas"]["TestOut"];

/** Push a test message to one device now. */
export async function testDevice(id: number): Promise<TestResult> {
  const { data, error, response } = await client.POST("/api/push/devices/{device_id}/test", {
    params: { path: { device_id: id } },
  });

  if (!data) {
    throw new Error(
      reason(error) ?? `POST /api/push/devices/${id}/test failed with ${response.status}`,
    );
  }

  return data;
}

/** The sentence a test push's result shows, naming where the push stopped if it did. */
export function testWords(name: string, result: TestResult): string {
  if (result.status === null) {
    return `${name}: the push service could not be reached (${result.reason}).`;
  }
  if (result.gone) {
    return `${name}: the push service says this subscription is gone, so it was removed. Subscribe that device again.`;
  }
  if (result.status < 300) {
    return `Sent to ${name}. If nothing shows there, the browser or phone holds it back: allow notifications for this site.`;
  }
  const why = result.reason ? `: ${result.reason}` : "";
  return `${name}: the push service refused the push with ${result.status}${why}.`;
}

/** Whether this browser can take a push: a service worker, the push manager and notifications. */
export function pushSupported(): boolean {
  return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

/** The VAPID key is sent base64url, which `PushManager` wants as raw bytes. */
function applicationKey(publicKey: string): Uint8Array<ArrayBuffer> {
  const base64 = publicKey.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
  return Uint8Array.from(atob(padded), (char) => char.charCodeAt(0));
}

/** The first pattern that matches the user agent gives its name, or the fallback. */
function firstMatch(agent: string, names: [RegExp, string][], fallback: string): string {
  return names.find(([pattern]) => pattern.test(agent))?.[1] ?? fallback;
}

/** The name in the device list, such as "Android Chrome". Android is checked first: its agent says Linux too. */
export function deviceName(agent: string = navigator.userAgent): string {
  const platform = firstMatch(
    agent,
    [
      [/Android/, "Android"],
      [/iPhone|iPad|iPod/, "iPhone"],
      [/Windows/, "Windows"],
      [/Mac OS/, "Mac"],
      [/Linux/, "Linux"],
    ],
    "Unknown",
  );
  // Edge and Chrome both say Chrome, and Chrome and iOS Safari both say Safari, so the order matters.
  const browser = firstMatch(
    agent,
    [
      [/Edg\//, "Edge"],
      [/Firefox|FxiOS/, "Firefox"],
      [/Chrome|CriOS/, "Chrome"],
      [/Safari/, "Safari"],
    ],
    "browser",
  );
  return `${platform} ${browser}`;
}

/**
 * Ask for permission, subscribe this browser with the server's key, and send the subscription
 * to the backend. A refusal throws the sentence the settings page shows.
 */
export async function subscribeHere(publicKey: string): Promise<void> {
  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    throw new Error("Notifications are blocked in this browser");
  }

  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: applicationKey(publicKey),
  });
  const { endpoint, keys } = subscription.toJSON();
  if (!endpoint || !keys?.p256dh || !keys.auth) {
    throw new Error("The browser gave a subscription with no keys");
  }

  await addDevice({
    endpoint,
    keys: { p256dh: keys.p256dh, auth: keys.auth },
    name: deviceName(),
  });
}

/** This browser's subscription, or null where it has none or cannot have one. */
async function currentSubscription(): Promise<PushSubscription | null> {
  if (!pushSupported()) return null;
  const registration = await navigator.serviceWorker.getRegistration();
  return (await registration?.pushManager.getSubscription()) ?? null;
}

/** The endpoint this browser is subscribed at, or null. */
export async function currentEndpoint(): Promise<string | null> {
  return (await currentSubscription())?.endpoint ?? null;
}

/** Drop this browser's subscription, so it gets no more pushes. */
export async function unsubscribeHere(): Promise<void> {
  await (await currentSubscription())?.unsubscribe();
}

/** When pushes go: the morning push's time and the quiet hours, each `HH:MM` or null for off. */
export type PushHours = components["schemas"]["PushHours-Output"];

/** The stored morning time and quiet hours. */
export async function fetchHours(): Promise<PushHours> {
  const { data, response } = await client.GET("/api/push/settings");

  if (!data) {
    throw new Error(`GET /api/push/settings failed with ${response.status}`);
  }

  return data;
}

/** Store the morning time and quiet hours; the sender reads them on its next minute. */
export async function saveHours(body: PushHours): Promise<PushHours> {
  const { data, error, response } = await client.PUT("/api/push/settings", { body });

  if (!data) {
    throw new Error(reason(error) ?? `PUT /api/push/settings failed with ${response.status}`);
  }

  return data;
}
