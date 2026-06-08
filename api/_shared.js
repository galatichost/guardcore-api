const EPHEMERAL_KEYS = new Set();

export function addEphemeralKey(key) {
  EPHEMERAL_KEYS.add(key);
}

export function removeEphemeralKey(key) {
  EPHEMERAL_KEYS.delete(key);
}

export function isValidApiKey(key) {
  const envKeys = (process.env.API_KEYS || "")
    .split(",")
    .map((k) => k.trim())
    .filter(Boolean);
  return envKeys.includes(key) || EPHEMERAL_KEYS.has(key);
}

export function getEphemeralCount() {
  return EPHEMERAL_KEYS.size;
}

export function getEnvKeys() {
  return (process.env.API_KEYS || "")
    .split(",")
    .map((k) => k.trim())
    .filter(Boolean);
}

export function getAllEphemeralKeys() {
  return [...EPHEMERAL_KEYS];
}
