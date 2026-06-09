import { isValidApiKey } from "../../_shared.js";


export default async function handler(req, res) {
  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
    return res.status(204).end();
  }

  if (req.method !== "POST") {
    return res
      .status(405)
      .json({ error: { message: "Method not allowed", type: "invalid_request_error" } });
  }

  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith("Bearer ")) {
    return res
      .status(401)
      .json({ error: { message: "API key required. Use Authorization: Bearer sk-...", type: "auth_error" } });
  }

  const key = auth.slice(7);
  if (!isValidApiKey(key)) {
    return res
      .status(401)
      .json({ error: { message: "Invalid API key", type: "auth_error" } });
  }

  const nvidiaKey = process.env.NVIDIA_API_KEY;
  if (!nvidiaKey) {
    return res
      .status(500)
      .json({ error: { message: "Server misconfigured", type: "server_error" } });
  }

  const { messages, stream: requestedStream, ...rest } = req.body || {};
  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    return res
      .status(400)
      .json({ error: { message: "messages must be a non-empty array", type: "invalid_request_error" } });
  }

  const stream = requestedStream !== false;

  const MODEL_ALIASES = {
    "minimax-m2.7": "minimaxai/minimax-m2.7",
    "minimax": "minimaxai/minimax-m2.7",
    "llama-3.1-70b": "meta/llama-3.1-70b-instruct",
    "llama-3.1-8b": "meta/llama-3.1-8b-instruct",
    "llama-3.3-70b": "meta/llama-3.3-70b-instruct",
    "deepseek-v4-flash": "deepseek-ai/deepseek-v4-flash",
    "deepseek-v4": "deepseek-ai/deepseek-v4-flash",
    "qwen3-235b": "qwen/qwen3-235b-a20b-instruct",
    "mistral-large": "mistralai/mistral-large",
  };

  let model = rest.model || "minimaxai/minimax-m2.7";
  if (MODEL_ALIASES[model]) model = MODEL_ALIASES[model];

  const nvidiaBody = {
    messages,
    model,
    stream: true,
    temperature: rest.temperature ?? 0.7,
    max_tokens: rest.max_tokens ?? 2048,
  };

  if (rest.tools) nvidiaBody.tools = rest.tools;
  if (rest.tool_choice) nvidiaBody.tool_choice = rest.tool_choice;
  if (rest.stop) nvidiaBody.stop = rest.stop;
  if (rest.frequency_penalty) nvidiaBody.frequency_penalty = rest.frequency_penalty;
  if (rest.presence_penalty) nvidiaBody.presence_penalty = rest.presence_penalty;
  if (rest.top_p) nvidiaBody.top_p = rest.top_p;
  if (rest.seed) nvidiaBody.seed = rest.seed;

  let upstream;
  try {
    upstream = await fetch("https://integrate.api.nvidia.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${nvidiaKey}`,
        Accept: "text/event-stream",
      },
      body: JSON.stringify(nvidiaBody),
    });
  } catch {
    return res
      .status(502)
      .json({ error: { message: "Upstream unreachable", type: "server_error" } });
  }

  if (!upstream.ok || !upstream.body) {
    const text = await upstream.text().catch(() => "");
    return res
      .status(upstream.status)
      .json({ error: { message: text || "Upstream error", type: "upstream_error" } });
  }

  if (!stream) {
    let content = "";
    let finish = "stop";
    let usage = null;
    let id = "";
    let created = 0;

    const reader = upstream.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop();
      for (const line of lines) {
        const t = line.trim();
        if (!t.startsWith("data:")) continue;
        const p = t.slice(5).trim();
        if (p === "[DONE]") continue;
        try {
          const json = JSON.parse(p);
          const d = json.choices?.[0]?.delta || {};
          if (d.content) content += d.content;
          if (json.choices?.[0]?.finish_reason) finish = json.choices[0].finish_reason;
          if (json.id) id = json.id;
          if (json.created) created = json.created;
          if (json.usage) usage = json.usage;
        } catch {}
      }
    }

    return res.status(200).json({
      id,
      object: "chat.completion",
      created,
      model: model || "minimaxai/minimax-m2.7",
      choices: [
        {
          index: 0,
          message: { role: "assistant", content },
          finish_reason: finish,
        },
      ],
      usage: usage || { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
    });
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

  req.on("close", () => {
    clearInterval(heartbeat);
    try {
      reader.cancel();
    } catch {}
  });

  try {
    let buf = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop();
      for (const line of lines) {
        const t = line.trim();
        if (!t.startsWith("data:")) continue;
        const p = t.slice(5).trim();
        if (p === "[DONE]") {
          res.write("data: [DONE]\n\n");
          continue;
        }
        try {
          const raw = JSON.parse(p);
          const { nvext, ...clean } = raw;
          clean.object = "chat.completion.chunk";
          clean.model = model;
          if (clean.choices?.[0]?.delta && !clean.choices[0].delta.role) {
            clean.choices[0].delta.role = "assistant";
          }
          res.write(`data: ${JSON.stringify(clean)}\n\n`);
        } catch {}
      }
    }
    clearInterval(heartbeat);
    res.end();
  } catch {
    clearInterval(heartbeat);
    try {
      res.end();
    } catch {}
  }
}

export const config = { runtime: "nodejs", maxDuration: 60 };
