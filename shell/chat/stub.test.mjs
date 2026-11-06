import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import { test } from "node:test";

const stubPath = new URL("./stub.mjs", import.meta.url).pathname;
// Holds dns.lookup back, which listen with a host waits on before it binds.
const slowBind =
  'data:text/javascript,import dns from "node:dns";const l=dns.lookup;dns.lookup=(...a)=>setTimeout(()=>l(...a),500);';

// Resolves with the port the stub says it bound, or rejects if it exits first.
async function ready(stub) {
  const [chunk] = await Promise.race([
    once(stub.stdout, "data"),
    once(stub, "exit").then(([code]) => Promise.reject(new Error(`stub exited with ${code}`))),
  ]);
  return Number(String(chunk).match(/:(\d+)\s*$/)[1]);
}

test("the stub says it is ready only once it listens, even on a slow bind", {
  timeout: 20_000,
}, async () => {
  const stub = spawn(process.execPath, ["--import", slowBind, stubPath, "0"]);
  try {
    const port = await ready(stub);
    assert.notEqual(port, 0);
    assert.equal((await fetch(`http://127.0.0.1:${port}/chat/events`)).status, 200);
  } finally {
    stub.kill();
  }
});

test("a stub that cannot bind exits without saying it is ready", { timeout: 20_000 }, async () => {
  const taken = createServer().listen(0, "127.0.0.1");
  await once(taken, "listening");
  const stub = spawn(process.execPath, [stubPath, taken.address().port]);
  try {
    await assert.rejects(ready(stub), /stub exited with [1-9]/);
  } finally {
    stub.kill();
    taken.close();
  }
});

test("a stop between the stub's steps ends the turn as stopped", { timeout: 20_000 }, async () => {
  const stub = spawn(process.execPath, [stubPath, "0"]);
  try {
    const port = await ready(stub);
    assert.notEqual(port, 0);
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
