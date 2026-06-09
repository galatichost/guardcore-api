import http from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import chatHandler from "./api/chat.js";
import authHandler from "./api/auth.js";
import verifyHandler from "./api/verify.js";
import completionsHandler from "./api/v1/chat/completions.js";
import keysHandler from "./api/admin/keys.js";

const PUBLIC_DIR = normalize("./public");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
};

function getBody(req) {
  return new Promise((resolve) => {
    if (req.method === "GET" || req.method === "HEAD") return resolve({});
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        resolve({});
      }
    });
  });
}

async function serveStatic(req, res) {
  if (req.method !== "GET" && req.method !== "HEAD") return false;
  let urlPath = decodeURIComponent(req.url.split("?")[0]);
  if (urlPath === "/") urlPath = "/index.html";
  const filePath = normalize(join(PUBLIC_DIR, urlPath));
  if (!filePath.startsWith(PUBLIC_DIR)) return false;
  try {
    const s = await stat(filePath);
    if (!s.isFile()) return false;
    const data = await readFile(filePath);
    const ext = extname(filePath).toLowerCase();
    res.setHeader("Content-Type", MIME[ext] || "application/octet-stream");
    res.setHeader("Cache-Control", "public, max-age=60");
    res.end(data);
    return true;
  } catch {
    return false;
  }
}

function makeAdapter(req, body) {
  return {
    fakeReq: {
      method: req.method,
      headers: req.headers,
      body,
      url: req.url,
      on: req.on.bind(req),
    },
    fakeRes(res) {
      const headers = {};
      let statusCode = 200;
      let headersSent = false;
      return {
        setHeader(name, value) {
          headers[name.toLowerCase()] = value;
        },
        status(code) {
          statusCode = code;
          return this;
        },
        flushHeaders() {
          if (headersSent) return;
          res.writeHead(statusCode, headers);
          headersSent = true;
        },
        write(chunk) {
          if (!headersSent) {
            res.writeHead(statusCode, headers);
            headersSent = true;
          }
          return res.write(chunk);
        },
        end(chunk) {
          if (!headersSent) {
            res.writeHead(statusCode, headers);
            headersSent = true;
          }
          res.end(chunk);
        },
        json(obj) {
          if (!headers["content-type"])
            headers["content-type"] = "application/json; charset=utf-8";
          this.end(JSON.stringify(obj));
        },
        send(text) {
          if (!headers["content-type"])
            headers["content-type"] = "text/plain; charset=utf-8";
          this.end(text);
        },
      };
    },
  };
}

const routes = {
  "/api/chat": chatHandler,
  "/api/auth": authHandler,
  "/api/verify": verifyHandler,
  "/api/v1/chat/completions": completionsHandler,
  "/api/admin/keys": keysHandler,
};

// Redirect /v1/* to /api/v1/* for SDK compatibility
const aliasRoutes = {
  "/v1/chat/completions": "/api/v1/chat/completions",
};

async function handleApi(urlPath, req, res) {
  const handler = routes[urlPath] || routes[aliasRoutes[urlPath]];
  if (!handler) return false;
  const body = await getBody(req);
  const { fakeReq, fakeRes: makeFake } = makeAdapter(req, body);
  try {
    await handler(fakeReq, makeFake(res));
  } catch (err) {
    if (!res.headersSent) {
      res.writeHead(500, { "content-type": "application/json; charset=utf-8" });
    }
    res.end(JSON.stringify({ error: String(err) }));
  }
  return true;
}

const server = http.createServer(async (req, res) => {
  const urlPath = req.url.split("?")[0].toLowerCase();

  if (await handleApi(urlPath, req, res)) return;
  if (await serveStatic(req, res)) return;

  res.writeHead(404, { "content-type": "text/plain" });
  res.end("Not found");
});

const port = process.env.PORT || 3000;
server.listen(port, () => {
  console.log(`\nDashboard:   http://localhost:${port}/`);
  console.log(`Chat API:    http://localhost:${port}/api/chat`);
  console.log(`OpenAI API:  http://localhost:${port}/api/v1/chat/completions`);
  console.log(`Auth:        http://localhost:${port}/api/auth`);
  console.log(`Verify:      http://localhost:${port}/api/verify`);
  console.log(`Admin Keys:  http://localhost:${port}/api/admin/keys\n`);
});
