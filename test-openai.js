import { readFileSync } from "node:fs";

const BASE = process.env.BASE_URL || "http://localhost:3000";

async function testEndpoint() {
  const apiKey = process.argv[2] || "sk-test-key-not-set";
  const url = BASE + "/api/v1/chat/completions";

  console.log("Testing OpenAI-compatible endpoint...");
  console.log("URL:", url);
  console.log("Key:", apiKey.slice(0, 12) + "...");
  console.log();

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      messages: [{ role: "user", content: "Say hello in 2 languages" }],
      temperature: 0.7,
      max_tokens: 200,
      stream: true,
    }),
  });

  console.log("Status:", res.status);
  console.log("Content-Type:", res.headers.get("content-type"));

  if (!res.ok) {
    const text = await res.text();
    console.log("Error:", text);
    return;
  }

  console.log("\n--- Streaming response ---");
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let full = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const chunk = decoder.decode(value, { stream: true });
    process.stdout.write(chunk);
    full += chunk;
  }
  console.log("\n\n--- Full response received ---");
}

testEndpoint().catch(console.error);
