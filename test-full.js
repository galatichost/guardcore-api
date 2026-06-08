import { createHash, createHmac, randomBytes } from "node:crypto";

const BASE = "http://localhost:3000";

async function step(label, fn) {
  process.stdout.write(`${label}... `);
  try {
    const r = await fn();
    console.log(r.ok ? "OK" : "FAIL");
    return r;
  } catch (e) {
    console.log("ERROR");
    console.log("  ", e.message);
    return null;
  }
}

async function main() {
  console.log("=== GuardCore API Test Suite ===\n");

  const authR = await step("1. Logging in", () =>
    fetch(`${BASE}/api/auth`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: process.argv[2] }),
    })
  );
  if (!authR || !authR.ok) {
    const t = await authR?.text();
    console.log("  Login failed:", t);
    return;
  }
  const { token } = await authR.json();
  console.log("  Token received");

  const genR = await step("2. Generating API key", () =>
    fetch(`${BASE}/api/admin/keys`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, action: "generate" }),
    })
  );
  if (!genR || !genR.ok) {
    const t = await genR?.text();
    console.log("  Generate failed:", t);
    return;
  }
  const { key } = await genR.json();
  console.log("  New key:", key);

  await step("3. Testing OpenAI endpoint with new key", () =>
    fetch(`${BASE}/api/v1/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        messages: [{ role: "user", content: "Say hello in 2 languages" }],
        max_tokens: 100,
        stream: false,
      }),
    })
  );

  await step("4. Testing bad key is rejected", () =>
    fetch(`${BASE}/api/v1/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer sk-fake-bad-key",
      },
      body: JSON.stringify({
        messages: [{ role: "user", content: "hi" }],
        max_tokens: 10,
      }),
    }).then((r) => (r.status === 401 ? { ok: true } : { ok: false }))
  );

  await step("5. Testing streaming", async () => {
    const r = await fetch(`${BASE}/api/v1/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        messages: [{ role: "user", content: "Say one word: hello" }],
        max_tokens: 50,
        stream: true,
      }),
    });
    if (!r.ok) throw new Error("Status " + r.status);
    const reader = r.body.getReader();
    const dec = new TextDecoder();
    let firstChunk = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      firstChunk += dec.decode(value);
    }
    if (firstChunk.includes("data:")) return { ok: true };
    throw new Error("No SSE data received");
  });

  console.log("\n=== All done ===");
}

main().catch(console.error);
