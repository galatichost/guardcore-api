import { readFileSync } from "node:fs";

const body = readFileSync("test.json", "utf8");
console.log("Sending:", body);
console.log("---response---");

const res = await fetch("http://localhost:3000/api/chat", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body,
});

console.log("Status:", res.status);
console.log("Content-Type:", res.headers.get("content-type"));
console.log();

const reader = res.body.getReader();
const decoder = new TextDecoder();
while (true) {
  const { done, value } = await reader.read();
  if (done) break;
  process.stdout.write(decoder.decode(value));
}
console.log("\n---done---");
