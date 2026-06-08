import crypto from "node:crypto";
import {
  addEphemeralKey,
  removeEphemeralKey,
  getEphemeralCount,
  getEnvKeys,
  getAllEphemeralKeys,
} from "../_shared.js";

function verifyAdminToken(token) {
  if (!token) return null;
  const adminPass = process.env.ADMIN_PASSWORD;
  if (!adminPass) return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [payload, sig] = parts;
  const expected = crypto.createHmac("sha256", adminPass).update(payload).digest("hex");
  if (sig !== expected) return null;
  try {
    const d = JSON.parse(Buffer.from(payload, "base64url").toString());
    if (d.exp && Date.now() > d.exp) return null;
    return d;
  } catch {
    return null;
  }
}

export default async function handler(req, res) {
  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
    return res.status(204).end();
  }

  const token = req.headers.authorization?.startsWith("Bearer ")
    ? req.headers.authorization.slice(7)
    : req.body?.token;

  const admin = verifyAdminToken(token);
  if (!admin) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const baseURL =
    `${req.headers["x-forwarded-proto"] || "https"}://${req.headers.host || "guardcoreapi.qzz.io"}/v1`;

  function allKeys() {
    const env = getEnvKeys().map((k) => ({ key: k, source: "env" }));
    const ephem = getAllEphemeralKeys().map((k) => ({ key: k, source: "ephemeral" }));
    return [...env, ...ephem];
  }

  if (req.method === "GET") {
    return res.status(200).json({
      keys: allKeys(),
      activeEphemeral: getEphemeralCount(),
      baseURL,
    });
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { action, key } = req.body || {};

  if (action === "generate") {
    const newKey = "sk-" + crypto.randomBytes(24).toString("hex");
    addEphemeralKey(newKey);

    const allKeysArr = [...getEnvKeys(), newKey];
    const cmdAll = allKeysArr.join(",");

    return res.status(200).json({
      key: newKey,
      note: "Works immediately. Add to env var to make permanent.",
      command: `vercel env add API_KEYS production`,
      copyAll: cmdAll,
      currentKeys: allKeys(),
      baseURL,
    });
  }

  if (action === "revoke") {
    if (!key) return res.status(400).json({ error: "Key is required" });

    const envKeys = getEnvKeys();

    if (envKeys.includes(key)) {
      const remaining = envKeys.filter((k) => k !== key);
      const cmdAll = remaining.length > 0 ? remaining.join(",") : "";
      return res.status(200).json({
        revoked: true,
        from: "env",
        note: "This key is in your env var. To permanently remove it:",
        command: cmdAll
          ? `echo.${cmdAll}| vercel env add API_KEYS production`
          : `vercel env rm API_KEYS production`,
        currentKeys: allKeys(),
      });
    }

    removeEphemeralKey(key);
    return res.status(200).json({
      revoked: true,
      from: "ephemeral",
      currentKeys: allKeys(),
    });
  }

  return res.status(200).json({
    keys: allKeys(),
    activeEphemeral: getEphemeralCount(),
    baseURL,
  });
}

export const config = { runtime: "nodejs" };
