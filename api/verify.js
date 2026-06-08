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

  const { token } = req.body || {};
  const adminPassword = process.env.ADMIN_PASSWORD;

  if (!adminPassword || !token) {
    return res.status(400).json({ valid: false });
  }

  const parts = token.split(".");
  if (parts.length !== 2) {
    return res.status(400).json({ valid: false });
  }

  const [payload, sig] = parts;
  const expectedSig = crypto
    .createHmac("sha256", adminPassword)
    .update(payload)
    .digest("hex");

  const sigMatch = crypto.timingSafeEqual(
    Buffer.from(sig),
    Buffer.from(expectedSig)
  );

  if (!sigMatch) {
    return res.status(401).json({ valid: false });
  }

  let decoded;
  try {
    decoded = JSON.parse(Buffer.from(payload, "base64url").toString());
  } catch {
    return res.status(400).json({ valid: false });
  }

  if (decoded.exp && Date.now() > decoded.exp) {
    return res.status(401).json({ valid: false, error: "Token expired" });
  }

  return res.status(200).json({ valid: true, role: decoded.role });
}

export const config = {
  runtime: "nodejs",
};
