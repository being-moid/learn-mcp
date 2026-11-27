import { env, exports } from "cloudflare:workers";
import { mcpRequest } from "./mcp";

/**
 * Opens a subscriptions/listen stream, as a client does to receive change
 * notifications, and lets a test wait for a given notification on it.
 */
export async function openListenStream(notifications: Record<string, boolean>) {
  const { request } = mcpRequest("subscriptions/listen", { notifications });
  const res = await exports.default.fetch(request);
  const reader = res.body!.pipeThrough(new TextDecoderStream()).getReader();
  const seen: string[] = [];
  let buffer = "";
  // Keep exactly one read pending: abandoning a read on timeout and starting
  // another would drop whatever chunk the first one later receives.
  let pending = reader.read();

  /** Resolves true once `method` arrives on the stream, false after `ms`. */
  async function waitFor(method: string, ms = 3_000): Promise<boolean> {
    const deadline = Date.now() + ms;
    while (Date.now() < deadline) {
      const chunk = await Promise.race([pending, sleep(deadline - Date.now()).then(() => null)]);
      if (chunk === null) return false;
      if (chunk.done) return false;
      pending = reader.read();
      buffer += chunk.value;
      let newline: number;
      while ((newline = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (!line.startsWith("data:")) continue;
        const msg = JSON.parse(line.slice(5));
        if (msg.method) seen.push(msg.method);
        if (msg.method === method) return true;
      }
    }
    return false;
  }

  return { contentType: res.headers.get("content-type"), waitFor, seen, close: () => reader.cancel() };
}

/**
 * Waits until the notification hub has at least `count` listeners. A listen
 * stream is acknowledged before its connection to the hub is set up, so a
 * change published in that gap would be missed; tests wait for the hub first.
 */
export async function waitForHubListeners(count: number, ms = 3_000): Promise<boolean> {
  const hub = env.NOTIFICATION_HUB.get(env.NOTIFICATION_HUB.idFromName("global"));
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if ((await hub.listenerCount()) >= count) return true;
    await sleep(25);
  }
  return false;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, Math.max(ms, 0)));
