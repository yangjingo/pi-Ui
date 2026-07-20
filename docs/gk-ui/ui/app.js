// ═══════════════════════════════════════════════════════════
// uniEx Agent Console — Chat Interface
// ═══════════════════════════════════════════════════════════

const $ = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);

// ═══ State ═══
const state = {
  messages: [],
  pendingFiles: [],
  streaming: false,
  dashboardOpen: false,
  canvasOpen: false,
  canvasMsgId: null,
  msgIdSeq: 0,
};

// ═══ DOM ═══
const emptyState = $("#empty-state");
const messageList = $("#message-list");
const inputArea = $("#input-area");
const fileTags = $("#file-tags");
const uploadMini = $("#upload-mini");
const msgInput = $("#msg-input");
const btnSend = $("#btn-send");
const dashboardPanel = $("#dashboard-panel");
const dashboardIframe = $("#dashboard-iframe");
const btnCloseDashboard = $("#btn-close-dashboard");
const canvasPanel = $("#canvas-panel");
const canvasTitle = $("#canvas-title");
const canvasBody = $("#canvas-body");
const btnCloseCanvas = $("#btn-close-canvas");
const btnCanvasPrev = $("#btn-canvas-prev");
const btnCanvasNext = $("#btn-canvas-next");
const btnNewChatWelcome = $("#btn-new-chat-welcome");
const btnSettingsWelcome = $("#btn-settings-welcome");
const settingsOverlay = $("#settings-overlay");
const cfgBaseUrl = $("#cfg-base-url");
const cfgApiKey = $("#cfg-api-key");
const cfgModel = $("#cfg-model");
const cfgTemperature = $("#cfg-temperature");
const cfgTempVal = $("#cfg-temp-val");
const cfgStatus = $("#cfg-status");

// ═══ Init ═══
function init() {
  bindUpload();
  bindChat();
  bindDashboard();
  bindCanvas();
  bindSettings();
  bindGlobalDrop();
  loadConfig();
}

// ═══════════════════════════════════════════════════════════
// UPLOAD
// ═══════════════════════════════════════════════════════════

function bindUpload() {
  setupUploadZone("upload-zone-inline", "file-input-inline", "folder-input-inline");
  $("#btn-browse-inline").addEventListener("click", (e) => {
    e.stopPropagation();
    $("#file-input-inline").click();
  });

  setupUploadZone("upload-mini", "file-input", "folder-input");
  $("#btn-browse").addEventListener("click", (e) => {
    e.stopPropagation();
    $("#file-input").click();
  });
}

function setupUploadZone(zoneId, fileInputId, folderInputId) {
  const zone = $(`#${zoneId}`);
  const fileInput = $(`#${fileInputId}`);

  if (!zone) return;
  zone.addEventListener("click", () => fileInput.click());

  fileInput.addEventListener("change", () => {
    if (fileInput.files.length > 0) {
      handleFiles(Array.from(fileInput.files));
      fileInput.value = "";
    }
  });

  zone.addEventListener("dragover", (e) => {
    e.preventDefault(); e.stopPropagation();
    zone.classList.add("drag-over");
  });
  zone.addEventListener("dragleave", (e) => {
    e.preventDefault(); e.stopPropagation();
    zone.classList.remove("drag-over");
  });
  zone.addEventListener("drop", (e) => {
    e.preventDefault(); e.stopPropagation();
    zone.classList.remove("drag-over");
    const items = e.dataTransfer.items;
    if (!items) return;
    collectDropped(items).then(files => {
      if (files.length > 0) handleFiles(files);
    });
  });
}

async function collectDropped(items) {
  const files = [];
  for (const item of items) {
    if (item.kind !== "file") continue;
    const entry = item.webkitGetAsEntry?.() || null;
    if (entry && entry.isDirectory) {
      const dirFiles = await readDir(entry);
      files.push(...dirFiles);
    } else {
      const file = item.getAsFile();
      if (file) files.push(file);
    }
  }
  return files;
}

function readDir(entry) {
  return new Promise((resolve) => {
    const files = [];
    const dirReader = entry.createReader();
    const read = () => {
      dirReader.readEntries(async (entries) => {
        if (entries.length === 0) { resolve(files); return; }
        for (const e of entries) {
          if (e.isFile) {
            const f = await fileFromEntry(e);
            if (f) files.push(f);
          } else if (e.isDirectory) {
            const sub = await readDir(e);
            files.push(...sub);
          }
        }
        read();
      });
    };
    read();
  });
}

function fileFromEntry(entry) {
  return new Promise((resolve) => {
    entry.file(resolve, () => resolve(null));
  });
}

function handleFiles(files) {
  const pdfs = files.filter(f => f.name.toLowerCase().endsWith(".pdf"));
  if (pdfs.length === 0) {
    appendSystemMsg("未检测到 PDF 文件，请上传 .pdf 格式的文档");
    return;
  }
  const seen = new Set();
  const unique = pdfs.filter(f => {
    const key = `${f.name}|${f.size}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  state.pendingFiles = state.pendingFiles.concat(unique);
  renderFileTags();

  if (emptyState.style.display !== "none") {
    ensureChatMode();
    uploadAndAnalyze();
  }
}

// ═══ File Tags ═══
function renderFileTags() {
  if (state.pendingFiles.length === 0) {
    fileTags.style.display = "none";
    fileTags.innerHTML = "";
    return;
  }
  fileTags.style.display = "flex";
  const maxShow = 6;
  const show = state.pendingFiles.slice(0, maxShow);
  const remaining = state.pendingFiles.length - maxShow;

  fileTags.innerHTML = show.map((f, i) => {
    const label = f.name.length > 32 ? f.name.slice(0, 29) + "..." : f.name;
    const isDir = f.webkitRelativePath && f.webkitRelativePath.includes("/");
    return `<span class="file-tag${isDir ? ' folder' : ''}" data-idx="${i}">
      <span>${escHtml(label)}</span>
      <span class="tag-size">${formatSize(f.size)}</span>
      <span class="tag-remove" data-idx="${i}">&times;</span>
    </span>`;
  }).join("")
  + (remaining > 0 ? `<span class="file-tag">+ ${remaining} 个文件</span>` : "");

  fileTags.querySelectorAll(".tag-remove").forEach(el => {
    el.addEventListener("click", (e) => {
      e.stopPropagation();
      const idx = parseInt(el.dataset.idx);
      state.pendingFiles = state.pendingFiles.filter((_, i) => i !== idx);
      renderFileTags();
    });
  });
}

function formatSize(bytes) {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
  return (bytes / (1024 * 1024)).toFixed(1) + " MB";
}

// ═══════════════════════════════════════════════════════════
// UPLOAD + AUTO-ANALYZE
// ═══════════════════════════════════════════════════════════

async function uploadAndAnalyze() {
  if (state.pendingFiles.length === 0 || state.streaming) return;

  const files = [...state.pendingFiles];
  state.pendingFiles = [];
  renderFileTags();

  ensureChatMode();

  const fileNames = files.map(f => f.name);
  const userMsg = addMessage("user", "");
  userMsg.el.querySelector(".flow-content").innerHTML =
    `<div class="msg-files">${fileNames.map(n =>
      `<span class="file-badge">${escHtml(n)}</span>`
    ).join("")}</div>
    <span>上传了 ${files.length} 个文件，开始分析...</span>`;

  appendSystemMsg("正在上传 " + files.length + " 个文件...");
  const form = new FormData();
  for (const f of files) {
    form.append("files", f);
    if (f.webkitRelativePath) {
      const parts = f.webkitRelativePath.split("/");
      if (parts.length > 2) {
        form.append("relativePath", parts.slice(0, -1).join("/"));
      }
    }
  }

  let uploadResult;
  try {
    const res = await fetch("/api/upload", { method: "POST", body: form });
    uploadResult = await res.json();
  } catch (e) {
    appendSystemMsg("上传失败: " + e.message);
    return;
  }

  appendSystemMsg("上传完成，共 " + uploadResult.count + " 个文件");
  const prompt = `请分析 test/ 目录下的 PDF 文件：${fileNames.join("、")}。运行 pipeline 解析所有 PDF，包括文本提取、表格提取、图片提取，然后进行 VLM 分析，最后构建 dashboard。`;
  streamPrompt(prompt);
}

// ═══ Common: stream a prompt and render response ═══
async function streamPrompt(promptText) {
  ensureChatMode();

  const agentMsg = addMessage("agent", "");
  const wrapper = agentMsg.el.querySelector(".msg-wrapper");
  const flow = wrapper.querySelector(".flow-content");

  // Show thinking indicator
  const thinkingDots = document.createElement("span");
  thinkingDots.className = "thinking-dots";
  thinkingDots.innerHTML = "<i></i><i></i><i></i>";
  flow.appendChild(thinkingDots);

  agentMsg.el.classList.add("streaming");
  state.streaming = true;
  btnSend.disabled = true;
  let firstToken = true;
  // Track current text run for interleaving
  let currentTextRun = null;

  try {
    const res = await fetch("/api/prompt", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: promptText }),
    });

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop();
      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        try {
          const data = JSON.parse(line.slice(6));
          if (firstToken && data.type === "token") {
            if (thinkingDots.parentNode) thinkingDots.remove();
            firstToken = false;
          }
          currentTextRun = handleSSE(data, agentMsg, flow, currentTextRun);
        } catch (e) { /* skip malformed */ }
      }
    }
  } catch (e) {
    if (thinkingDots.parentNode) thinkingDots.remove();
    const errSpan = document.createElement("span");
    errSpan.className = "step-line error";
    errSpan.textContent = "连接错误: " + e.message;
    flow.appendChild(errSpan);
  } finally {
    if (thinkingDots.parentNode) thinkingDots.remove();
    agentMsg.el.classList.remove("streaming");
    agentMsg.el.classList.add("done");
    state.streaming = false;
    btnSend.disabled = false;
    msgInput.focus();
  }
}

// ═══════════════════════════════════════════════════════════
// SSE Event Handler — Interleaved flow: text ⇄ tool ⇄ text
// Returns the current text-run element (or null)
// ═══════════════════════════════════════════════════════════

function handleSSE(data, agentMsg, flow, currentTextRun) {
  console.log("[SSE]", data.type, data.name || data.skill || "");

  switch (data.type) {

    // ── Token: accumulate text in current run ──
    case "token": {
      if (!currentTextRun) {
        // Start a new text run
        currentTextRun = document.createElement("div");
        currentTextRun.className = "text-run";
        flow.appendChild(currentTextRun);
      }
      (state._tokenBuf || (state._tokenBuf = [])).push(data.text || "");
      // Debounced markdown render every 3 tokens or when token includes newline
      const buf = state._tokenBuf;
      if (buf.length >= 3 || data.text?.includes("\n")) {
        currentTextRun.innerHTML = "";
        markdownTo(currentTextRun, buf.join(""));
        state._tokenBuf = [];
      }
      scrollToBottom();
      break;
    }

    // ── Tool card: insert into flow, break text run ──
    case "tool_start": {
      if (currentTextRun) flushTokenBuf(currentTextRun);
      const meta = toolMeta(data.name || "", data.input);
      const toolId = data.id;
      if (!toolId) break;
      const card = createToolCard(toolId, meta);
      flow.appendChild(card);
      currentTextRun = null; // next token starts fresh text run
      scrollToBottom();
      break;
    }

    case "tool_update": {
      const toolId = data.id;
      if (!toolId) break;
      const card = flow.querySelector(`[data-tool-id="${CSS.escape(toolId)}"]`);
      if (card && data.partialResult) {
        const outputEl = card.querySelector(".card-output");
        const text = typeof data.partialResult === "string"
          ? data.partialResult
          : JSON.stringify(data.partialResult);
        outputEl.textContent += text;
        outputEl.scrollTop = outputEl.scrollHeight;
      }
      break;
    }

    case "tool_end": {
      const toolId = data.id;
      if (!toolId) break;
      const card = flow.querySelector(`[data-tool-id="${CSS.escape(toolId)}"]`);
      if (!card) break;
      const startTime = parseInt(card.dataset.startTime);
      const elapsed = startTime ? ((Date.now() - startTime) / 1000).toFixed(1) : "?";

      card.classList.remove("running");
      card.classList.add(data.isError ? "error" : "done");

      const statusEl = card.querySelector(".card-status");
      const iconEl = card.querySelector(".card-icon");
      const timeEl = card.querySelector(".card-time");

      if (data.isError) { statusEl.textContent = "失败"; iconEl.textContent = "✗"; }
      else { statusEl.textContent = "完成"; iconEl.textContent = "✓"; }
      timeEl.textContent = elapsed + "s";

      // Fill card output from result if not already populated by tool_update
      const outputEl = card.querySelector(".card-output");
      if (!outputEl.textContent.trim() && data.result) {
        const resultText = typeof data.result === "string" ? data.result : JSON.stringify(data.result);
        outputEl.textContent = resultText;
      }

      currentTextRun = null;
      scrollToBottom();
      break;
    }

    // ── Step / progress line ──
    case "step": {
      if (currentTextRun) flushTokenBuf(currentTextRun);
      const status = data.status || "";
      const text = data.text || "";
      const stepId = data.stage ? `step-${data.stage}` : `step-${Date.now()}`;
      let stepEl = flow.querySelector(`[data-step="${CSS.escape(stepId)}"]`);
      if (!stepEl) {
        stepEl = document.createElement("div");
        stepEl.className = "step-line";
        stepEl.dataset.step = stepId;
        flow.appendChild(stepEl);
      }
      stepEl.className = "step-line " + (status === "done" ? "done" : status === "error" ? "error" : "running");
      stepEl.textContent = text;
      currentTextRun = null;
      scrollToBottom();
      break;
    }

    // ── Skill ──
    case "skill_start": {
      if (currentTextRun) flushTokenBuf(currentTextRun);
      const skillName = data.skill || "";
      const skillLabel = data.label || skillName;
      if (!skillName) break;
      const card = createToolCard(`skill-${skillName}`, {
        type: "skill", icon: "🔧", label: "技能", detail: skillLabel, color: "skill",
      });
      card.dataset.startTime = Date.now();
      flow.appendChild(card);
      currentTextRun = null;
      scrollToBottom();
      break;
    }

    case "skill_done": {
      const skillName = data.skill || "";
      if (!skillName) break;
      const card = flow.querySelector(`[data-tool-id="${CSS.escape(`skill-${skillName}`)}"]`);
      if (card) {
        const startTime = parseInt(card.dataset.startTime);
        const elapsed = startTime ? ((Date.now() - startTime) / 1000).toFixed(1) : "?";
        card.classList.remove("running"); card.classList.add("done");
        card.querySelector(".card-icon").textContent = "✓";
        card.querySelector(".card-status").textContent = "完成";
        card.querySelector(".card-time").textContent = elapsed + "s";

        if (skillName === "build-dashboard") {
          renderSummaryCard(agentMsg);
          autoOpenDashboard();
          autoOpenCanvas();
        } else if (skillName === "parse-pdf" || skillName === "vlm-analyze") {
          autoOpenCanvas();
        }
      }
      currentTextRun = null;
      break;
    }

    case "skill_error": {
      const skillName = data.skill || "";
      const card = flow.querySelector(`[data-tool-id="${CSS.escape(`skill-${skillName}`)}"]`);
      if (card) {
        card.classList.remove("running"); card.classList.add("error");
        card.querySelector(".card-icon").textContent = "✗";
        card.querySelector(".card-status").textContent = "失败";
      }
      const err = document.createElement("div");
      err.className = "step-line error";
      err.textContent = data.error || "未知错误";
      flow.appendChild(err);
      currentTextRun = null;
      scrollToBottom();
      break;
    }

    case "error": {
      const err = document.createElement("div");
      err.className = "step-line error";
      err.textContent = data.message || "未知错误";
      flow.appendChild(err);
      currentTextRun = null;
      scrollToBottom();
      break;
    }

    case "message_done":
      // Auto-generate report and open canvas
      if (!state._lastDoneMsg || state._lastDoneMsg !== agentMsg.id) {
        state._lastDoneMsg = agentMsg.id;
        generateReport(agentMsg);
        autoOpenCanvas();
      }
      break;
  }

  return currentTextRun;
}

// ═══ Markdown → HTML with marked ═══
function markdownTo(el, raw) {
  if (!raw) return;
  try {
    if (typeof marked !== "undefined" && typeof marked.parse === "function") {
      el.innerHTML = marked.parse(raw);
    } else {
      el.innerHTML = raw
        .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
        .replace(/\n\n/g, "</p><p>").replace(/\n/g, "<br>");
    }
  } catch (e) {
    el.textContent = raw;
  }
}

// Flush buffered tokens → markdown
function flushTokenBuf(currentTextRun) {
  if (state._tokenBuf && state._tokenBuf.length > 0) {
    const raw = state._tokenBuf.join("");
    state._tokenBuf = [];
    markdownTo(currentTextRun, raw);
  }
}

// ═══════════════════════════════════════════════════════════
// Tool Card Factory
// ═══════════════════════════════════════════════════════════

function createToolCard(id, meta) {
  const card = document.createElement("div");
  card.className = `tool-card running ${meta.color}`;
  card.dataset.toolId = id;
  card.dataset.startTime = Date.now();
  card.dataset.meta = JSON.stringify(meta); // store for canvas

  card.innerHTML = `
    <div class="card-header">
      <span class="card-icon">${meta.icon}</span>
      <span class="card-label">${escHtml(meta.label)}</span>
      <span class="card-detail">${escHtml(meta.detail)}</span>
      <span class="card-spacer"></span>
      <span class="card-time">...</span>
      <span class="card-status">执行中</span>
      <span class="card-expand" title="查看详情">▸</span>
    </div>
    <pre class="card-output"></pre>
  `;

  // Click header → open tool detail in canvas
  card.querySelector(".card-header").addEventListener("click", (e) => {
    e.stopPropagation(); // don't trigger message click
    openToolInCanvas(id, card);
  });

  return card;
}

// ═══ Open single tool detail in canvas ═══
function openToolInCanvas(toolId, cardEl) {
  const meta = JSON.parse(cardEl.dataset.meta || "{}");
  const output = cardEl.querySelector(".card-output")?.textContent || "";
  const status = cardEl.querySelector(".card-status")?.textContent || "";
  const time = cardEl.querySelector(".card-time")?.textContent || "";

  canvasTitle.textContent = `${meta.icon} ${meta.label} · ${meta.detail}`;
  state.canvasOpen = true;
  state.canvasMsgId = null;

  canvasBody.innerHTML = `
    <div class="canvas-section">
      <div class="canvas-section-title">📋 命令</div>
      <pre class="canvas-cmd-block">${escHtml(meta.detail)}</pre>
    </div>
    <div class="canvas-section">
      <div class="canvas-section-title">
        📤 输出
        <span style="font-weight:400;font-size:12px;color:var(--text-soft)">${escHtml(time)} · ${escHtml(status)}</span>
      </div>
      <pre class="canvas-output-block">${escHtml(output) || "(无输出)"}</pre>
    </div>
    <div class="canvas-section">
      <div class="canvas-section-title">ℹ️ 工具信息</div>
      <div class="report-stats" style="grid-template-columns:repeat(3,1fr)">
        <div class="report-stat"><span class="report-stat-val">${escHtml(meta.label)}</span><span class="report-stat-label">类型</span></div>
        <div class="report-stat ${cardEl.classList.contains('done')?'done':cardEl.classList.contains('error')?'error':'running'}"><span class="report-stat-val">${escHtml(status)}</span><span class="report-stat-label">状态</span></div>
        <div class="report-stat"><span class="report-stat-val">${escHtml(time)}</span><span class="report-stat-label">耗时</span></div>
      </div>
    </div>
  `;

  canvasPanel.style.display = "flex";
  requestAnimationFrame(() => {
    canvasPanel.classList.add("open");
  });

  btnCanvasPrev.style.display = "none";
  btnCanvasNext.style.display = "none";
}

// ═══════════════════════════════════════════════════════════
// Tool Metadata — icon, label, color per tool type
// ═══════════════════════════════════════════════════════════

function toolMeta(name, input) {
  const t = (name || "").toLowerCase();
  const args = input?.args || input || {};
  const cmd = args.command || args.cmd || args.code || "";
  const filePath = args.file_path || args.path || args.file || args.pattern || "";

  // Python
  if (t.includes("python") || t.includes("py")) {
    return { type: "python", icon: "🐍", label: "Python", detail: cmd || "执行脚本", color: "blue" };
  }
  // Todo/Task
  if (t.includes("todo") || t.includes("task")) {
    return { type: "todo", icon: "📋", label: "规划", detail: "任务规划", color: "neutral" };
  }
  // Read
  if (t.includes("read") || t.includes("grep") || t.includes("find") || t.includes("ls") || t.includes("glob")) {
    const detail = filePath || (cmd || "文档");
    return { type: "read", icon: "📖", label: "读取", detail: detail, color: "teal" };
  }
  // Write/Edit
  if (t.includes("write") || t.includes("edit")) {
    return { type: "write", icon: "💾", label: "保存", detail: filePath || "文件", color: "green" };
  }
  // Bash/Shell/Exec
  if (t.includes("bash") || t.includes("exec") || t.includes("shell")) {
    return { type: "bash", icon: "⚙️", label: "Bash", detail: cmd || "执行命令", color: "amber" };
  }
  // Skill
  if (t.includes("skill")) {
    return { type: "skill", icon: "🔧", label: "技能", detail: name, color: "skill" };
  }
  // Agent/Dispatch
  if (t.includes("agent") || t.includes("dispatch")) {
    return { type: "agent", icon: "🤖", label: "Agent", detail: name, color: "purple" };
  }
  // Web/Fetch
  if (t.includes("web") || t.includes("fetch") || t.includes("http") || t.includes("curl")) {
    const url = args.url || "";
    return { type: "web", icon: "🌐", label: "请求", detail: url || "网络请求", color: "teal" };
  }
  // Search
  if (t.includes("search")) {
    return { type: "search", icon: "🔍", label: "搜索", detail: args.query || "搜索", color: "teal" };
  }
  // Fallback
  return { type: "unknown", icon: "🔧", label: name, detail: "", color: "neutral" };
}

// ═══════════════════════════════════════════════════════════
// MESSAGES
// ═══════════════════════════════════════════════════════════

function addMessage(role, text) {
  state.msgIdSeq++;
  const id = `msg-${state.msgIdSeq}`;
  const msg = { role, text, id };
  state.messages.push(msg);

  const div = document.createElement("div");
  div.className = `msg ${role}`;
  div.id = id;

  const avatarText = role === "user" ? "U" : "AI";
  div.innerHTML = `
    <div class="msg-avatar">${avatarText}</div>
    <div class="msg-wrapper">
      <div class="flow-content">${text ? escHtml(text) : ""}</div>
    </div>
  `;

  // Click agent message → open canvas detail
  if (role === "agent") {
    div.addEventListener("click", () => openCanvas(id));
  }

  messageList.appendChild(div);
  messageList.scrollTop = messageList.scrollHeight;

  msg.el = div;
  return msg;
}

function appendSystemMsg(text) {
  const msg = addMessage("agent", "");
  msg.el.querySelector(".flow-content").innerHTML =
    `<span class="system-msg">${escHtml(text)}</span>`;
  return msg;
}

function ensureChatMode() {
  if (emptyState.style.display !== "none") {
    emptyState.style.display = "none";
    messageList.style.display = "flex";
    inputArea.style.display = "block";
  }
}

// ═══ Scroll helper ═══
function scrollToBottom() {
  messageList.scrollTop = messageList.scrollHeight;
}

// ═══ Summary Card ═══
function renderSummaryCard(agentMsg) {
  const flow = agentMsg.el.querySelector(".flow-content");
  const cardDiv = document.createElement("div");
  cardDiv.innerHTML = `
    <div class="summary-cards">
      <div class="summary-card">
        <div class="card-value">完成</div>
        <div class="card-label">分析报告</div>
      </div>
      <div class="summary-card">
        <div class="card-value">就绪</div>
        <div class="card-label">数据看板</div>
      </div>
    </div>
    <button class="dashboard-link" onclick="openDashboard()">
      查看完整看板 <span style="font-size:14px">&rarr;</span>
    </button>
  `;
  flow.appendChild(cardDiv);
}

// ═══════════════════════════════════════════════════════════
// SEND TEXT MESSAGE
// ═══════════════════════════════════════════════════════════

async function sendMessage() {
  const text = msgInput.value.trim();
  if (!text || state.streaming) return;

  if (state.pendingFiles.length > 0) {
    await uploadAndAnalyze();
    return;
  }

  ensureChatMode();

  addMessage("user", text);
  msgInput.value = "";
  msgInput.style.height = "auto";

  await streamPrompt(text);
}

// ═══════════════════════════════════════════════════════════
// SETTINGS
// ═══════════════════════════════════════════════════════════

function bindSettings() {
  btnSettingsWelcome.addEventListener("click", () => openSettings());
  $("#btn-close-settings").addEventListener("click", closeSettings);
  settingsOverlay.querySelector(".settings-backdrop").addEventListener("click", closeSettings);
  $("#btn-save-config").addEventListener("click", saveSettings);
  $("#btn-test-config").addEventListener("click", testConnection);

  cfgTemperature.addEventListener("input", () => {
    cfgTempVal.textContent = cfgTemperature.value;
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && settingsOverlay.style.display !== "none") {
      closeSettings();
    }
  });
}

async function loadConfig() {
  try {
    const res = await fetch("/api/config");
    const cfg = await res.json();
    if (cfg.baseUrl) cfgBaseUrl.value = cfg.baseUrl;
    if (cfg.apiKey) cfgApiKey.value = cfg.apiKey;
    if (cfg.model) cfgModel.value = cfg.model;
    if (cfg.temperature !== undefined) {
      cfgTemperature.value = cfg.temperature;
      cfgTempVal.textContent = cfg.temperature;
    }
  } catch (e) { /* ignore */ }
}

function openSettings() {
  settingsOverlay.style.display = "flex";
  cfgStatus.classList.remove("visible", "error");
  cfgStatus.textContent = "";
  const testArea = $("#test-result-area");
  if (testArea) testArea.style.display = "none";
  const replyEl = $("#test-reply");
  if (replyEl) { replyEl.textContent = ""; replyEl.style.color = ""; }
}

function closeSettings() {
  settingsOverlay.style.display = "none";
}

async function testConnection() {
  const btnTest = $("#btn-test-config");
  const resultArea = $("#test-result-area");
  const replyEl = $("#test-reply");
  const elapsedEl = $("#test-elapsed");
  btnTest.disabled = true;
  btnTest.textContent = "测试中...";
  resultArea.style.display = "block";
  replyEl.textContent = "";
  replyEl.classList.add("streaming");
  elapsedEl.textContent = "";

  const startTime = Date.now();
  let timerInterval = setInterval(() => {
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    elapsedEl.textContent = `(${elapsed}s)`;
  }, 100);

  try {
    const res = await fetch("/api/prompt", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "你好" }),
    });

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop();
      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        try {
          const data = JSON.parse(line.slice(6));
          if (data.type === "token") {
            replyEl.textContent += data.text || "";
          } else if (data.type === "error") {
            replyEl.textContent = "错误: " + (data.message || "连接失败");
            replyEl.style.color = "var(--error)";
          }
        } catch (e) { /* skip */ }
      }
    }
  } catch (e) {
    replyEl.textContent = "连接失败: " + e.message;
    replyEl.style.color = "var(--error)";
  } finally {
    clearInterval(timerInterval);
    const total = ((Date.now() - startTime) / 1000).toFixed(1);
    elapsedEl.textContent = `(${total}s)`;
    replyEl.classList.remove("streaming");
    btnTest.disabled = false;
    btnTest.textContent = "测试连接";
  }
}

async function saveSettings() {
  const body = {
    baseUrl: cfgBaseUrl.value.trim(),
    apiKey: cfgApiKey.value.trim(),
    model: cfgModel.value.trim(),
    temperature: parseFloat(cfgTemperature.value),
  };

  try {
    const res = await fetch("/api/config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (data.ok) {
      cfgStatus.textContent = "配置已保存";
      cfgStatus.classList.add("visible");
      cfgStatus.classList.remove("error");
      setTimeout(() => cfgStatus.classList.remove("visible"), 2000);
    }
  } catch (e) {
    cfgStatus.textContent = "保存失败: " + e.message;
    cfgStatus.classList.add("error");
  }
}

// ═══════════════════════════════════════════════════════════
// CANVAS PANEL — message detail / preview
// ═══════════════════════════════════════════════════════════

function openCanvas(msgId) {
  const msgEl = document.getElementById(msgId);
  if (!msgEl) return;

  // Highlight active
  $$(".msg.agent.active").forEach(el => el.classList.remove("active"));
  msgEl.classList.add("active");

  // Find message
  const agentMsgs = state.messages.filter(m => m.role === "agent");
  const currentMsg = agentMsgs.find(m => m.id === msgId);
  if (!currentMsg) return;

  state.canvasOpen = true;
  state.canvasMsgId = msgId;

  // Show prev/next for message-level canvas
  btnCanvasPrev.style.display = "";
  btnCanvasNext.style.display = "";

  // Check for dashboard
  const hasDashboard = currentMsg.report?.tools?.some(
    t => t.detail?.includes("build_dashboard") || t.detail?.includes("dashboard")
  );

  if (hasDashboard) {
    renderDashboardCanvas();
  } else {
    const wrapper = msgEl.querySelector(".msg-wrapper");
    canvasTitle.textContent = `执行详情 · ${currentMsg.id}`;
    canvasBody.innerHTML = renderCanvasContent(wrapper);
  }

  // Open panel
  canvasPanel.style.display = "flex";
  requestAnimationFrame(() => {
    canvasPanel.classList.add("open");
  });

  updateCanvasNav();
}

function renderDashboardCanvas() {
  canvasTitle.textContent = "📊 最终看板";
  canvasBody.innerHTML = `
    <div style="height:100%;display:flex;flex-direction:column">
      <div class="canvas-section" style="flex-shrink:0">
        <div class="canvas-section-title">📈 执行概览</div>
        <div class="report-stats">${generateStatsHTML()}</div>
      </div>
      <div class="canvas-section" style="flex:1;min-height:0;padding:0">
        <div class="canvas-section-title" style="margin-bottom:8px">📊 Dashboard 预览</div>
        <iframe src="/api/file?path=index.html&raw=1"
                style="width:100%;height:100%;min-height:500px;border:1px solid var(--border);border-radius:var(--radius-sm);background:#fff"
                sandbox="allow-scripts allow-same-origin">
        </iframe>
      </div>
      <div style="padding:12px;text-align:center">
        <button class="btn-primary" onclick="window.open('/api/file?path=index.html&raw=1','_blank')" style="font-size:14px;padding:8px 20px">
          🔗 在新窗口打开看板
        </button>
      </div>
    </div>
  `;
}

function generateStatsHTML() {
  const agentMsgs = state.messages.filter(m => m.role === "agent");
  let totalTools = 0, doneTools = 0, errorTools = 0;
  agentMsgs.forEach(m => {
    if (!m.el) return;
    const cards = m.el.querySelectorAll(".tool-card");
    totalTools += cards.length;
    cards.forEach(c => {
      if (c.classList.contains("done")) doneTools++;
      if (c.classList.contains("error")) errorTools++;
    });
  });
  return `
    <div class="report-stat"><span class="report-stat-val">${agentMsgs.length}</span><span class="report-stat-label">对话轮次</span></div>
    <div class="report-stat done"><span class="report-stat-val">${doneTools}</span><span class="report-stat-label">成功任务</span></div>
    <div class="report-stat error"><span class="report-stat-val">${errorTools}</span><span class="report-stat-label">失败</span></div>
    <div class="report-stat"><span class="report-stat-val">${totalTools}</span><span class="report-stat-label">总工具调用</span></div>
  `;
}

function closeCanvas() {
  canvasPanel.classList.remove("open");
  state.canvasOpen = false;
  state.canvasMsgId = null;

  // Remove highlight
  $$(".msg.agent.active").forEach(el => el.classList.remove("active"));

  setTimeout(() => {
    if (!state.canvasOpen) {
      canvasPanel.style.display = "none";
    }
  }, 300);
}

function updateCanvasNav() {
  const agentMsgs = state.messages.filter(m => m.role === "agent");
  if (agentMsgs.length <= 1) {
    btnCanvasPrev.style.opacity = "0.3";
    btnCanvasNext.style.opacity = "0.3";
    return;
  }
  const idx = agentMsgs.findIndex(m => m.id === state.canvasMsgId);
  btnCanvasPrev.style.opacity = idx <= 0 ? "0.3" : "1";
  btnCanvasNext.style.opacity = idx >= agentMsgs.length - 1 ? "0.3" : "1";
}

function navigateCanvas(direction) {
  const agentMsgs = state.messages.filter(m => m.role === "agent");
  const idx = agentMsgs.findIndex(m => m.id === state.canvasMsgId);
  const target = direction === "prev" ? idx - 1 : idx + 1;
  if (target >= 0 && target < agentMsgs.length) {
    agentMsgs[target].el.scrollIntoView({ behavior: "smooth", block: "center" });
    openCanvas(agentMsgs[target].id);
  }
}

// ═══════════════════════════════════════════════════════════
// REPORT GENERATION
// ═══════════════════════════════════════════════════════════

function generateReport(agentMsg) {
  const flow = agentMsg.el.querySelector(".flow-content");
  if (!flow) return;

  // Collect text directly from text-run elements
  const textRuns = flow.querySelectorAll(".text-run");
  let text = "";
  textRuns.forEach(r => { text += (text ? " " : "") + r.textContent; });

  // Collect tool cards from flow
  const toolCards = flow.querySelectorAll(".tool-card");
  const tools = [];
  toolCards.forEach(card => {
    const header = card.querySelector(".card-header");
    const output = card.querySelector(".card-output");
    tools.push({
      type: header?.querySelector(".card-label")?.textContent || "",
      detail: header?.querySelector(".card-detail")?.textContent || "",
      status: header?.querySelector(".card-status")?.textContent || "",
      time: header?.querySelector(".card-time")?.textContent || "",
      output: output?.textContent || "",
    });
  });

  agentMsg.report = { text, tools, timestamp: new Date().toISOString() };
}

function renderCanvasContent(wrapper) {
  if (!wrapper) return '<p class="canvas-empty">内容不可用</p>';

  const flow = wrapper.querySelector(".flow-content");
  if (!flow) return '<p class="canvas-empty">内容不可用</p>';

  let html = "";

  // ── Report Header ──
  html += `<div class="report-header">`;
  html += `<div class="report-title">📊 执行报告</div>`;
  html += `<div class="report-time">${new Date().toLocaleString("zh-CN")}</div>`;
  html += `</div>`;

  // ── Summary Stats ──
  const toolCards = flow.querySelectorAll(".tool-card");
  const cards = [...toolCards];
  const doneCards = cards.filter(c => c.classList.contains("done"));
  const errorCards = cards.filter(c => c.classList.contains("error"));
  const runningCards = cards.filter(c => c.classList.contains("running"));

  html += `<div class="canvas-section">`;
  html += `<div class="canvas-section-title">📈 执行概览</div>`;
  html += `<div class="report-stats">`;
  html += `<div class="report-stat"><span class="report-stat-val">${toolCards.length}</span><span class="report-stat-label">总任务</span></div>`;
  html += `<div class="report-stat done"><span class="report-stat-val">${doneCards.length}</span><span class="report-stat-label">成功</span></div>`;
  html += `<div class="report-stat error"><span class="report-stat-val">${errorCards.length}</span><span class="report-stat-label">失败</span></div>`;
  html += `<div class="report-stat running"><span class="report-stat-val">${runningCards.length}</span><span class="report-stat-label">进行中</span></div>`;
  html += `</div>`;
  html += `</div>`;

  // ── Tool Execution Timeline ──
  if (cards.length > 0) {
    html += `<div class="canvas-section">`;
    html += `<div class="canvas-section-title">🔧 工具执行时间线</div>`;
    html += `<div class="report-timeline">`;
    for (const card of cards) {
      const header = card.querySelector(".card-header");
      const icon = header?.querySelector(".card-icon")?.textContent || "";
      const label = header?.querySelector(".card-label")?.textContent || "";
      const detail = header?.querySelector(".card-detail")?.textContent || "";
      const status = header?.querySelector(".card-status")?.textContent || "";
      const time = header?.querySelector(".card-time")?.textContent || "";
      const output = card.querySelector(".card-output")?.textContent || "";

      const classList = [...card.classList].filter(c => c !== "tool-card").join(" ");

      html += `<div class="report-step ${classList}">`;
      html += `<div class="report-step-head">`;
      html += `<span class="report-step-icon">${escHtml(icon)}</span>`;
      html += `<span class="report-step-label">${escHtml(label)}</span>`;
      html += `<code class="report-step-cmd">${escHtml(detail)}</code>`;
      html += `<span class="report-step-time">${escHtml(time)}</span>`;
      html += `<span class="report-step-status">${escHtml(status)}</span>`;
      html += `</div>`;
      if (output) {
        html += `<pre class="report-step-output">${escHtml(output)}</pre>`;
      }
      html += `</div>`;
    }
    html += `</div>`;
    html += `</div>`;
  }

  // ── Text Output ──
  const textRuns = flow.querySelectorAll(".text-run");
  let fullText = "";
  textRuns.forEach(r => { fullText += (fullText ? "\n" : "") + r.textContent; });
  fullText = fullText.trim();
  if (fullText) {
    html += `<div class="canvas-section">`;
    html += `<div class="canvas-section-title">📝 输出详情</div>`;
    html += `<div class="canvas-text">${escHtml(fullText)}</div>`;
    html += `</div>`;
  }

  // ── Session Summary ──
  html += `<div class="canvas-section">`;
  html += `<div class="canvas-section-title">💬 对话记录 (${state.messages.length} 条)</div>`;
  html += `<div class="report-conversation">`;
  state.messages.forEach((m, i) => {
    const icon = m.role === "user" ? "👤" : "🤖";
    const preview = (m.el?.querySelector(".flow-content")?.textContent || m.text || "").slice(0, 80) || "(空)";
    html += `<div class="report-msg ${m.role}">`;
    html += `<span class="report-msg-icon">${icon}</span>`;
    html += `<span class="report-msg-num">#${i + 1}</span>`;
    html += `<span class="report-msg-preview">${escHtml(preview)}</span>`;
    html += `</div>`;
  });
  html += `</div></div>`;

  return html || '<p class="canvas-empty">暂无内容</p>';
}

function autoOpenCanvas() {
  // Auto-open canvas with the latest agent message when streaming is done
  const agentMsgs = state.messages.filter(m => m.role === "agent");
  if (agentMsgs.length > 0) {
    const last = agentMsgs[agentMsgs.length - 1];
    setTimeout(() => openCanvas(last.id), 300);
  }
}

function bindCanvas() {
  btnCloseCanvas.addEventListener("click", closeCanvas);
  btnCanvasPrev.addEventListener("click", () => navigateCanvas("prev"));
  btnCanvasNext.addEventListener("click", () => navigateCanvas("next"));

  // Close on Escape
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && state.canvasOpen) {
      closeCanvas();
    }
  });

  // Click outside canvas body to close
  canvasPanel.addEventListener("click", (e) => {
    if (e.target === canvasPanel) closeCanvas();
  });
}

// ═══════════════════════════════════════════════════════════
// DASHBOARD PANEL
// ═══════════════════════════════════════════════════════════

function openDashboard() {
  dashboardPanel.style.display = "flex";
  requestAnimationFrame(() => {
    dashboardPanel.classList.add("open");
    dashboardIframe.src = "/api/file?path=index.html&raw=1";
  });
  state.dashboardOpen = true;
}

function closeDashboard() {
  dashboardPanel.classList.remove("open");
  state.dashboardOpen = false;
  setTimeout(() => {
    if (!state.dashboardOpen) {
      dashboardPanel.style.display = "none";
      dashboardIframe.src = "";
    }
  }, 300);
}

function autoOpenDashboard() {
  if (!state._hasAutoOpenedDashboard) {
    state._hasAutoOpenedDashboard = true;
    setTimeout(() => openDashboard(), 500);
  }
}

window.openDashboard = openDashboard;

function bindDashboard() {
  btnCloseDashboard.addEventListener("click", closeDashboard);
}

// ═══════════════════════════════════════════════════════════
// CHAT EVENTS
// ═══════════════════════════════════════════════════════════

function bindChat() {
  btnSend.addEventListener("click", () => {
    if (state.pendingFiles.length > 0 && !msgInput.value.trim()) {
      uploadAndAnalyze();
    } else {
      sendMessage();
    }
  });

  msgInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      btnSend.click();
    }
  });

  msgInput.addEventListener("input", () => {
    msgInput.style.height = "auto";
    msgInput.style.height = Math.min(msgInput.scrollHeight, 140) + "px";
  });

  const resetChat = () => {
    state.messages = [];
    state.pendingFiles = [];
    state.streaming = false;
    state._hasAutoOpenedDashboard = false;
    state._lastDoneMsg = null;
    messageList.innerHTML = "";
    messageList.style.display = "none";
    emptyState.style.display = "flex";
    inputArea.style.display = "none";
    fileTags.innerHTML = "";
    fileTags.style.display = "none";
    closeDashboard();
    closeCanvas();
    btnSend.disabled = false;
  };
  btnNewChatWelcome.addEventListener("click", resetChat);
}

// ═══ Global drop zone ═══
function bindGlobalDrop() {
  document.addEventListener("dragover", (e) => { e.preventDefault(); });
  document.addEventListener("drop", (e) => {
    e.preventDefault();
    const inUpload = e.target.closest(".upload-zone");
    if (inUpload) return;
    const items = e.dataTransfer?.items;
    if (!items) return;
    collectDropped(items).then(files => {
      if (files.length > 0) {
        handleFiles(files);
        if (state.pendingFiles.length > 0 && emptyState.style.display === "none") {
          uploadAndAnalyze();
        }
      }
    });
  });
}

// ═══ Utils ═══
function escHtml(s) {
  return (s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// ═══ Start ═══
init();
