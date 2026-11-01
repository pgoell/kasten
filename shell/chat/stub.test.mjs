import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import { test } from "node:test";

async function freePort() {
  const probe = createServer().listen(0, "127.0.0.1");
  await once(probe, "listening");
  const { port } = probe.address();
  probe.close();
  return port;
}

test("a stop between the stub's steps ends the turn as stopped", { timeout: 20_000 }, async () => {
  const port = await freePort();
  const stub = spawn(process.execPath, [new URL("./stub.mjs", import.meta.url).pathname, port]);
  try {
    await once(stub.stdout, "data");
    const host = `127.0.0.1:${port}`;
    const post = (path, body) =>
      fetch(`http://${host}${path}`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: `http://${host}` },
        body: JSON.stringify(body),
      });
    const response = await fetch(`http://${host}/chat/events`);
    assert.equal((await post("/chat/send", { text: "close the day" })).status, 204);
    assert.equal((await post("/chat/stop", {})).status, 204);

    const decoder = new TextDecoder();
    let text = "";
    for await (const chunk of response.body) {
      text += decoder.decode(chunk, { stream: true });
      if (text.includes('"type":"done"')) break;
    }
    // The first step runs to its end; the stop is seen before the tool call.
    assert.match(text, /"type":"done","error":"Stopped\."/);
    assert.doesNotMatch(text, /"type":"tool"/);
  } finally {
    stub.kill();
  }
});
