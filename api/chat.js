export default async function handler(req, res) {
  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
    return res.status(204).end();
  }

  res.setHeader("Access-Control-Allow-Origin", "*");

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed. Use POST." });
  }

  const apiKey = process.env.NVIDIA_API_KEY;
  if (!apiKey) {
    return res
      .status(500)
      .json({ error: "NVIDIA_API_KEY is not configured on the server." });
  }

  const body = {
    ...(req.body || {}),
    model: "minimaxai/minimax-m2.7",
    stream: true,
  };

  let upstream;
  try {
    upstream = await fetch(
      "https://integrate.api.nvidia.com/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
          Accept: "text/event-stream",
        },
        body: JSON.stringify(body),
      }
    );
  } catch (err) {
    return res
      .status(502)
      .json({ error: "Failed to reach upstream NVIDIA API", detail: String(err) });
  }

  if (!upstream.ok || !upstream.body) {
    const text = await upstream.text().catch(() => "");
    res.status(upstream.status);
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    return res.send(text || "Upstream error");
  }

  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  if (typeof res.flushHeaders === "function") res.flushHeaders();

  const reader = upstream.body.getReader();
  const decoder = new TextDecoder();
  const heartbeat = setInterval(() => {
    try {
      res.write(": ping\n\n");
    } catch {}
  }, 15000);

  const clientClosed = () => {
    clearInterval(heartbeat);
    try {
      reader.cancel();
    } catch {}
  };
  req.on("close", clientClosed);
  req.on("aborted", clientClosed);

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(decoder.decode(value, { stream: true }));
    }
    clearInterval(heartbeat);
    res.end();
  } catch (err) {
    clearInterval(heartbeat);
    try {
      res.end();
    } catch {}
  }
}

export const config = {
  runtime: "nodejs",
  maxDuration: 60,
};
