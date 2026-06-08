import crypto from "node:crypto";

export default async function handler(req, res) {
  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    return res.status(204).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { password } = req.body || {};
  const adminPassword = process.env.ADMIN_PASSWORD;

  if (!adminPassword) {
    return res
      .status(500)
      .json({ error: "Server misconfigured: ADMIN_PASSWORD not set" });
  }

  const inputHash = crypto
    .createHash("sha256")
    .update(password || "")
    .digest("hex");
  const adminHash = crypto
    .createHash("sha256")
    .update(adminPassword)
    .digest("hex");

  const match = crypto.timingSafeEqual(
    Buffer.from(inputHash),
    Buffer.from(adminHash)
  );

  if (!match) {
    return res.status(401).json({ error: "Invalid password" });
  }

  const payload = Buffer.from(
    JSON.stringify({ role: "admin", exp: Date.now() + 86400000 })
  ).toString("base64url");

  const sig = crypto
    .createHmac("sha256", adminPassword)
    .update(payload)
    .digest("hex");

  const token = `${payload}.${sig}`;

  return res.status(200).json({ token });
}

export const config = {
  runtime: "nodejs",
};
