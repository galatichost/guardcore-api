const STORAGE_KEY = "gc.chat.v1";
const SETTINGS_KEY = "gc.settings.v1";

const DOM = {};
document.querySelectorAll("[id]").forEach((el) => (DOM[el.id] = el));

const settings = Object.assign(
  { system: "", temperature: 0.7, max_tokens: 2048, theme: "light" },
  JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}")
);

let messages = [];
let streaming = false;
let currentTab = "chat";

applyTheme(settings.theme);

function applyTheme(t) {
  document.documentElement.setAttribute("data-theme", t);
  settings.theme = t;
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

async function checkAuth() {
  const token = sessionStorage.getItem("gc.token");
  if (!token) return false;
  try {
    const r = await fetch("/api/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    });
    const data = await r.json();
    return data.valid === true;
  } catch {
    return false;
  }
}

function getToken() {
  return sessionStorage.getItem("gc.token") || "";
}

function showLogin() {
  DOM.loginScreen.classList.remove("hidden");
  DOM.app.classList.add("hidden");
  DOM.loginInput?.focus();
}

function showDashboard() {
  DOM.loginScreen.classList.add("hidden");
  DOM.app.classList.remove("hidden");
  DOM.input?.focus();
}

async function login() {
  const pw = DOM.loginInput?.value.trim();
  if (!pw) return;
  DOM.loginBtn.disabled = true;
  DOM.loginBtn.textContent = "Verifying…";
  DOM.loginError.textContent = "";
  try {
    const r = await fetch("/api/auth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: pw }),
    });
    const data = await r.json();
    if (r.ok && data.token) {
      sessionStorage.setItem("gc.token", data.token);
      DOM.loginInput.value = "";
      showDashboard();
      init();
    } else {
      DOM.loginError.textContent = data.error || "Invalid password";
    }
  } catch {
    DOM.loginError.textContent = "Could not reach server";
  } finally {
    DOM.loginBtn.disabled = false;
    DOM.loginBtn.textContent = "Sign In";
  }
}

function logout() {
  sessionStorage.removeItem("gc.token");
  showLogin();
}

DOM.loginBtn.addEventListener("click", login);
DOM.loginInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") login();
});

function switchTab(tab) {
  currentTab = tab;
  DOM.tabChat.classList.toggle("active", tab === "chat");
  DOM.tabApi.classList.toggle("active", tab === "api");
  DOM.chatSection.classList.toggle("hidden", tab !== "chat");
  DOM.apiSection.classList.toggle("hidden", tab !== "api");
  if (tab === "api") loadApiSettings();
}

DOM.tabChat.addEventListener("click", () => switchTab("chat"));
DOM.tabApi.addEventListener("click", () => switchTab("api"));

async function checkStatus() {
  try {
    const r = await fetch("/api/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: getToken() }),
    });
    const el = DOM.navStatus;
    el.textContent = r.ok ? "live" : "down";
    el.classList.toggle("live", r.ok);
  } catch {
    DOM.navStatus.textContent = "down";
    DOM.navStatus.classList.remove("live");
  }
}

function autoResize() {
  DOM.input.style.height = "auto";
  DOM.input.style.height = Math.min(DOM.input.scrollHeight, 200) + "px";
}

function renderAll() {
  const main = DOM.messages;
  main.innerHTML = "";
  if (messages.length === 0) {
    main.innerHTML =
      '<div class="empty-state"><h2>Start a conversation</h2><p>Ask anything. The response streams token by token.</p></div>';
  } else {
    for (const m of messages) appendMsg(m);
  }
  scrollDown();
}

function appendMsg(m) {
  const empty = DOM.messages.querySelector(".empty-state");
  if (empty) empty.remove();
  const wrap = document.createElement("div");
  wrap.className = "msg " + m.role;
  const av = document.createElement("div");
  av.className = "avatar";
  av.textContent = m.role === "user" ? "U" : "AI";
  const bub = document.createElement("div");
  bub.className = "bubble";
  bub.textContent = m.content || "";
  wrap.appendChild(av);
  wrap.appendChild(bub);
  DOM.messages.appendChild(wrap);
  return bub;
}

function scrollDown() {
  DOM.messages.scrollTop = DOM.messages.scrollHeight;
}

function persist() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(messages));
}

DOM.input.addEventListener("input", autoResize);
DOM.input.addEventListener("keydown", (e) => {
  if (currentTab !== "chat") return;
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    DOM.form?.requestSubmit();
  }
});

DOM.form.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (streaming || currentTab !== "chat") return;
  const text = DOM.input.value.trim();
  if (!text) return;
  DOM.input.value = "";
  autoResize();

  messages.push({ role: "user", content: text });
  appendMsg(messages[messages.length - 1]);
  scrollDown();
  persist();

  messages.push({ role: "assistant", content: "" });
  const aiBub = appendMsg(messages[messages.length - 1]);
  const cursor = document.createElement("span");
  cursor.className = "cursor";
  aiBub.appendChild(cursor);
  scrollDown();

  streaming = true;
  DOM.sendBtn.disabled = true;

  const apiMessages = [];
  if (settings.system) apiMessages.push({ role: "system", content: settings.system });
  for (const m of messages.slice(0, -1)) apiMessages.push(m);

  const start = performance.now();
  let ttft = null;
  let usage = null;

  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: apiMessages,
        temperature: Number(settings.temperature),
        max_tokens: Number(settings.max_tokens),
      }),
    });

    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      throw new Error(`HTTP ${res.status}: ${txt.slice(0, 200)}`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop();
      for (const line of lines) {
        const t = line.trim();
        if (!t.startsWith("data:")) continue;
        const payload = t.slice(5).trim();
        if (payload === "[DONE]") continue;
        try {
          const json = JSON.parse(payload);
          const delta = json.choices?.[0]?.delta?.content || "";
          if (delta) {
            if (ttft === null) {
              ttft = performance.now() - start;
              cursor.remove();
            }
            messages[messages.length - 1].content += delta;
            aiBub.textContent = messages[messages.length - 1].content;
            aiBub.appendChild(cursor);
            scrollDown();
          }
          if (json.usage) usage = json.usage;
        } catch {}
      }
    }
    cursor.remove();
    if (ttft !== null) {
      const total = ((performance.now() - start) / 1000).toFixed(2);
      const first = (ttft / 1000).toFixed(2);
      const meta = document.createElement("div");
      meta.className = "meta";
      meta.textContent =
        `ttft ${first}s · total ${total}s` +
        (usage ? ` · ${usage.total_tokens} tokens` : "");
      aiBub.parentElement.appendChild(meta);
    }
    persist();
  } catch (err) {
    cursor.remove();
    messages[messages.length - 1].content =
      messages[messages.length - 1].content || "(error)";
    aiBub.textContent = messages[messages.length - 1].content;
    DOM.errorBar.textContent = String(err.message || err);
    DOM.errorBar.classList.add("show");
    setTimeout(() => DOM.errorBar.classList.remove("show"), 5000);
  } finally {
    streaming = false;
    DOM.sendBtn.disabled = false;
    DOM.input.focus();
  }
});

DOM.clearBtn.addEventListener("click", () => {
  if (!messages.length) return;
  if (!confirm("Clear all messages?")) return;
  messages = [];
  persist();
  renderAll();
});

DOM.settingsBtn.addEventListener("click", () => {
  DOM.setSystem.value = settings.system;
  DOM.setTemp.value = settings.temperature;
  DOM.setMax.value = settings.max_tokens;
  DOM.setModel.value = "minimaxai/minimax-m2.7";
  DOM.settingsModal.classList.add("open");
});

DOM.cancelBtn.addEventListener("click", () => {
  DOM.settingsModal.classList.remove("open");
});

DOM.saveBtn.addEventListener("click", () => {
  settings.system = DOM.setSystem.value;
  settings.temperature = Number(DOM.setTemp.value);
  settings.max_tokens = Number(DOM.setMax.value);
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  DOM.settingsModal.classList.remove("open");
});

DOM.settingsModal.addEventListener("click", (e) => {
  if (e.target === DOM.settingsModal) DOM.settingsModal.classList.remove("open");
});

DOM.logoutBtn.addEventListener("click", logout);

DOM.themeBtn.addEventListener("click", () => {
  applyTheme(settings.theme === "light" ? "dark" : "light");
});

function copyToClip(text) {
  if (navigator.clipboard) {
    navigator.clipboard.writeText(text);
  }
}

async function revokeKey(key, source) {
  if (!confirm("Revoke this API key? It will stop working immediately.")) return;
  try {
    const r = await fetch("/api/admin/keys", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: getToken(), action: "revoke", key }),
    });
    const data = await r.json();
    if (r.ok) {
      DOM.errorBar.textContent = data.from === "env"
        ? `Key revoked. ${data.command ? "Run in terminal: " + data.command : ""}`
        : "Key revoked (ephemeral).";
      DOM.errorBar.classList.add("show");
      setTimeout(() => DOM.errorBar.classList.remove("show"), 8000);
      loadApiSettings();
    } else {
      throw new Error(data.error);
    }
  } catch (e) {
    DOM.errorBar.textContent = "Revoke failed: " + (e.message || "Unknown error");
    DOM.errorBar.classList.add("show");
    setTimeout(() => DOM.errorBar.classList.remove("show"), 5000);
  }
}

function renderKeyRow(item) {
  const row = document.createElement("div");
  row.className = "key-row";
  const span = document.createElement("span");
  span.className = "key-value";
  span.textContent = item.key;
  const badge = document.createElement("span");
  badge.className = "key-badge";
  badge.textContent = item.source === "env" ? "env" : "temp";
  const copyBtn = document.createElement("button");
  copyBtn.className = "key-copy";
  copyBtn.textContent = "Copy";
  copyBtn.addEventListener("click", () => {
    copyToClip(item.key);
    copyBtn.textContent = "Copied!";
    setTimeout(() => (copyBtn.textContent = "Copy"), 2000);
  });
  const delBtn = document.createElement("button");
  delBtn.className = "key-del";
  delBtn.textContent = "Revoke";
  delBtn.addEventListener("click", () => revokeKey(item.key, item.source));
  row.appendChild(span);
  row.appendChild(badge);
  row.appendChild(copyBtn);
  row.appendChild(delBtn);
  return row;
}

async function loadApiSettings() {
  DOM.apiKeysList.innerHTML = '<div class="loading">Loading…</div>';
  DOM.apiBaseUrl.textContent = "loading…";
  try {
    const r = await fetch("/api/admin/keys", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: getToken() }),
    });
    if (!r.ok) throw new Error("Unauthorized");
    const data = await r.json();
    DOM.apiBaseUrl.textContent = data.baseURL || (window.location.origin + "/v1");

    DOM.apiKeysList.innerHTML = "";
    if (data.keys.length === 0) {
      DOM.apiKeysList.innerHTML = '<div class="no-keys">No API keys configured yet.</div>';
    } else {
      for (const item of data.keys) {
        DOM.apiKeysList.appendChild(renderKeyRow(item));
      }
    }
    DOM.apiGenerateResult.classList.add("hidden");
  } catch {
    DOM.apiKeysList.innerHTML = '<div class="no-keys" style="color:#dc2626">Failed to load keys</div>';
  }
}

DOM.apiGenerateBtn.addEventListener("click", async () => {
  DOM.apiGenerateBtn.disabled = true;
  DOM.apiGenerateBtn.textContent = "Generating…";
  DOM.apiGenerateResult.classList.add("hidden");
  try {
    const r = await fetch("/api/admin/keys", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: getToken(), action: "generate" }),
    });
    const data = await r.json();
    if (r.ok && data.key) {
      DOM.apiNewKeyValue.textContent = data.key;
      DOM.apiNewKeyNote.textContent = data.note;
      DOM.apiNewCommand.textContent = `vercel env add API_KEYS production`;
      DOM.apiGenerateResult.classList.remove("hidden");
      loadApiSettings();
    } else {
      DOM.apiGenerateBtn.textContent = "Generate New Key";
      DOM.errorBar.textContent = data.error || "Failed to generate key";
      DOM.errorBar.classList.add("show");
      setTimeout(() => DOM.errorBar.classList.remove("show"), 5000);
    }
  } catch {
    DOM.errorBar.textContent = "Could not reach server";
    DOM.errorBar.classList.add("show");
    setTimeout(() => DOM.errorBar.classList.remove("show"), 5000);
  } finally {
    DOM.apiGenerateBtn.disabled = false;
    DOM.apiGenerateBtn.textContent = "Generate New Key";
  }
});

DOM.apiCopyKey.addEventListener("click", () => {
  const key = DOM.apiNewKeyValue.textContent;
  if (key) {
    copyToClip(key);
    DOM.apiCopyKey.textContent = "Copied!";
    setTimeout(() => (DOM.apiCopyKey.textContent = "Copy Key"), 2000);
  }
});

DOM.apiCopyUrl.addEventListener("click", () => {
  const url = DOM.apiBaseUrl.textContent;
  if (url) {
    copyToClip(url);
    DOM.apiCopyUrl.textContent = "Copied!";
    setTimeout(() => (DOM.apiCopyUrl.textContent = "Copy"), 2000);
  }
});

DOM.apiCopyCommand.addEventListener("click", () => {
  const cmd = DOM.apiNewCommand.textContent;
  if (cmd) {
    copyToClip(cmd);
    DOM.apiCopyCommand.textContent = "Copied!";
    setTimeout(() => (DOM.apiCopyCommand.textContent = "Copy Command"), 2000);
  }
});

async function init() {
  messages = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
  renderAll();
  autoResize();
  checkStatus();
  setInterval(checkStatus, 30000);
}

(async () => {
  const authed = await checkAuth();
  if (authed) {
    showDashboard();
    init();
  } else {
    showLogin();
  }
})();
