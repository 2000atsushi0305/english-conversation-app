// ===== Constants =====
const THEME_LABELS = {
  daily:    "💬 日常会話",
  travel:   "✈️ 旅行",
  business: "💼 ビジネス",
  hobbies:  "🎮 趣味",
  food:     "🍜 食べ物",
  movies:   "🎬 映画・音楽",
};
const DIFF_LABELS = { beginner: "初級", intermediate: "中級", advanced: "上級" };

// ===== State =====
let conversationHistory = [];
let currentSessionId    = null;
let currentTheme        = "daily";
let currentDifficulty   = "intermediate";
let isRecording         = false;
let recognition         = null;
let availableVoices     = [];

// ===== DOM =====
const messagesEl      = document.getElementById("messages");
const textInput       = document.getElementById("text-input");
const sendBtn         = document.getElementById("send-btn");
const micBtn          = document.getElementById("mic-btn");
const voiceStatus     = document.getElementById("voice-status");
const speechPreview   = document.getElementById("speech-preview");
const ttsToggle       = document.getElementById("tts-toggle");
const voiceSelect     = document.getElementById("voice-select");
const settingsBtn     = document.getElementById("settings-btn");
const settingsPanel   = document.getElementById("settings-panel");
const themeSelect     = document.getElementById("theme-select");
const newChatBtn      = document.getElementById("new-chat-btn");
const sessionInfo     = document.getElementById("session-info");
const sessionThemeLbl = document.getElementById("session-theme-label");
const sessionDiffLbl  = document.getElementById("session-diff-label");
const historyBtn      = document.getElementById("history-btn");
const historyModal    = document.getElementById("history-modal");
const historyClose    = document.getElementById("history-close");
const modalOverlay    = document.getElementById("modal-overlay");
const historyList     = document.getElementById("history-list");

// ===== Auth =====
const usageBadge = document.getElementById("usage-badge");
const logoutBtn  = document.getElementById("logout-btn");

async function checkAuth() {
  const res = await fetch("/api/me");
  if (res.status === 401) {
    location.href = "/auth";
    return false;
  }
  const data = await res.json();
  updateUsageBadge(data);
  return true;
}

function updateUsageBadge({ remaining, limit }) {
  usageBadge.classList.remove("hidden", "usage-low", "usage-empty");
  if (limit === null) {
    usageBadge.textContent = "∞ 無制限";
  } else {
    usageBadge.textContent = `残り ${remaining}/${limit}`;
    if (remaining === 0)     usageBadge.classList.add("usage-empty");
    else if (remaining <= 5) usageBadge.classList.add("usage-low");
  }
}

logoutBtn.addEventListener("click", async () => {
  await fetch("/api/logout", { method: "POST" });
  location.href = "/auth";
});

// ===== Init =====
async function init() {
  const ok = await checkAuth();
  if (!ok) return;
  setupSpeechRecognition();
  loadVoices();
  loadSettings();
  setupEventListeners();
  newConversation();
}

function setupEventListeners() {
  sendBtn.addEventListener("click", sendMessage);
  micBtn.addEventListener("click", toggleRecording);
  textInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  });

  settingsBtn.addEventListener("click", () => settingsPanel.classList.toggle("hidden"));

  themeSelect.addEventListener("change", () => {
    currentTheme = themeSelect.value;
    saveSettings();
    updateSessionInfo();
  });

  document.querySelectorAll(".diff-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".diff-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      currentDifficulty = btn.dataset.level;
      saveSettings();
      updateSessionInfo();
    });
  });

  newChatBtn.addEventListener("click", () => {
    saveCurrentSession();
    newConversation();
    settingsPanel.classList.add("hidden");
  });

  historyBtn.addEventListener("click", openHistory);
  historyClose.addEventListener("click", closeHistory);
  modalOverlay.addEventListener("click", closeHistory);
}

// ===== Settings =====
function loadSettings() {
  const s = JSON.parse(localStorage.getItem("english_settings") || "{}");
  currentTheme      = s.theme      || "daily";
  currentDifficulty = s.difficulty || "intermediate";
  themeSelect.value = currentTheme;
  document.querySelectorAll(".diff-btn").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.level === currentDifficulty);
  });
}

function saveSettings() {
  localStorage.setItem("english_settings", JSON.stringify({
    theme: currentTheme, difficulty: currentDifficulty,
  }));
}

function updateSessionInfo() {
  sessionThemeLbl.textContent = THEME_LABELS[currentTheme]  || currentTheme;
  sessionDiffLbl.textContent  = DIFF_LABELS[currentDifficulty] || currentDifficulty;
  if (conversationHistory.length > 0) sessionInfo.classList.remove("hidden");
}

// ===== Conversation =====
function newConversation() {
  conversationHistory = [];
  currentSessionId    = Date.now().toString();
  messagesEl.innerHTML = "";
  sessionInfo.classList.add("hidden");
  showWelcome();
}

// ===== History =====
function getSessions() {
  return JSON.parse(localStorage.getItem("english_sessions") || "[]");
}
function saveSessions(sessions) {
  localStorage.setItem("english_sessions", JSON.stringify(sessions));
}

function saveCurrentSession() {
  if (conversationHistory.length === 0) return;
  const sessions = getSessions();
  const idx = sessions.findIndex(s => s.id === currentSessionId);
  const session = {
    id:         currentSessionId,
    date:       new Date().toLocaleString("ja-JP", { year:"numeric", month:"2-digit", day:"2-digit", hour:"2-digit", minute:"2-digit" }),
    theme:      currentTheme,
    difficulty: currentDifficulty,
    preview:    conversationHistory[0]?.content || "",
    messages:   conversationHistory,
  };
  if (idx >= 0) sessions[idx] = session;
  else          sessions.unshift(session);
  saveSessions(sessions.slice(0, 20));
}

function openHistory() {
  saveCurrentSession();
  renderHistory();
  historyModal.classList.remove("hidden");
  modalOverlay.classList.remove("hidden");
}

function closeHistory() {
  historyModal.classList.add("hidden");
  modalOverlay.classList.add("hidden");
}

function renderHistory() {
  const sessions = getSessions();
  if (sessions.length === 0) {
    historyList.innerHTML = '<p class="no-history">まだ会話履歴がありません</p>';
    return;
  }
  historyList.innerHTML = sessions.map(s => `
    <div class="history-item">
      <div class="history-meta">
        <span class="history-date">${s.date}</span>
        <span class="history-badge">${THEME_LABELS[s.theme] || s.theme}</span>
        <span class="history-badge">${DIFF_LABELS[s.difficulty] || s.difficulty}</span>
      </div>
      <div class="history-preview">${escapeHtml((s.preview || "").slice(0, 60))}${(s.preview||"").length > 60 ? "…" : ""}</div>
      <div class="history-actions">
        <button class="btn-history-load" onclick="loadSession('${s.id}')">続きから</button>
        <button class="btn-history-delete" onclick="deleteSession('${s.id}')">削除</button>
      </div>
    </div>
  `).join("");
}

function loadSession(id) {
  const session = getSessions().find(s => s.id === id);
  if (!session) return;

  conversationHistory = session.messages;
  currentSessionId    = session.id;
  currentTheme        = session.theme;
  currentDifficulty   = session.difficulty;

  themeSelect.value = currentTheme;
  document.querySelectorAll(".diff-btn").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.level === currentDifficulty);
  });

  messagesEl.innerHTML = "";
  session.messages.forEach(msg => {
    if (msg.role === "user") {
      addUserMessage(msg.content);
    } else {
      const el = document.createElement("div");
      el.className = "message ai";
      el.innerHTML = `
        <div class="message-label">AI 先生</div>
        <div class="bubble"><div class="ai-english">${escapeHtml(msg.content)}</div></div>`;
      messagesEl.appendChild(el);
    }
  });
  scrollToBottom();
  updateSessionInfo();
  closeHistory();
}

function deleteSession(id) {
  saveSessions(getSessions().filter(s => s.id !== id));
  renderHistory();
}

// ===== Welcome =====
function showWelcome() {
  const starters = [
    "Hi! How are you?",
    "Let's talk about my hobbies.",
    "Can you help me practice conversation?",
    "Tell me about your day.",
    "I want to improve my English.",
  ];
  const el = document.createElement("div");
  el.className = "welcome";
  el.innerHTML = `
    <h2>👋 ようこそ！AI英会話へ</h2>
    <p>英語で話しかけてみましょう。<br>⚙️ で テーマ・難易度を変更できます。</p>
    <div class="starter-buttons">
      ${starters.map(s => `<button class="starter-btn" onclick="useStarter('${s}')">${s}</button>`).join("")}
    </div>`;
  messagesEl.appendChild(el);
}

function useStarter(text) { textInput.value = text; sendMessage(); }

// ===== Transcript Correction =====
async function correctTranscript(rawText) {
  // Show subtle hint that correction is in progress
  speechPreview.textContent = "✨ 補正中...";
  speechPreview.classList.remove("hidden");

  try {
    const res = await fetch("/api/correct", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: rawText }),
    });
    const data = await res.json();
    const corrected = data.corrected || rawText;

    // Only update if user hasn't manually edited the input yet
    if (textInput.value.trim() === rawText && corrected !== rawText) {
      textInput.value = corrected;
      speechPreview.textContent = `📝 補正: "${rawText}" → "${corrected}"`;
    } else {
      speechPreview.classList.add("hidden");
      return;
    }
  } catch {
    // Silently fail — keep raw text as-is
  }

  setTimeout(() => speechPreview.classList.add("hidden"), 3000);
}

// ===== Send =====
async function sendMessage() {
  const text = textInput.value.trim();
  if (!text) return;

  textInput.value = "";
  addUserMessage(text);
  conversationHistory.push({ role: "user", content: text });
  updateSessionInfo();
  saveCurrentSession();

  const typingEl = showTyping();

  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages:   conversationHistory,
        theme:      currentTheme,
        difficulty: currentDifficulty,
      }),
    });

    const data = await res.json();
    typingEl.remove();

    if (data.error) {
      if (res.status === 401) { location.href = "/auth"; return; }
      if (data.limit_reached) { showLimitReached(); conversationHistory.pop(); return; }
      addErrorMessage(data.error);
      conversationHistory.pop();
      return;
    }

    if (data.usage) updateUsageBadge(data.usage);

    addAIMessage(data);
    conversationHistory.push({ role: "assistant", content: data.english });
    saveCurrentSession();

    if (ttsToggle.checked && data.english) speak(data.english);

  } catch {
    typingEl.remove();
    addErrorMessage("通信エラーが発生しました。サーバーが起動しているか確認してください。");
    conversationHistory.pop();
  }
}

// ===== Render =====
function addUserMessage(text) {
  document.querySelector(".welcome")?.remove();
  const el = document.createElement("div");
  el.className = "message user";
  el.innerHTML = `<div class="message-label">あなた</div><div class="bubble">${escapeHtml(text)}</div>`;
  messagesEl.appendChild(el);
  scrollToBottom();
}

function addAIMessage(data) {
  const el = document.createElement("div");
  el.className = "message ai";
  let content = `<div class="ai-english">${escapeHtml(data.english)}</div>`;
  if (data.japanese_translation)
    content += `<div class="ai-translation">${escapeHtml(data.japanese_translation)}</div>`;
  if (data.correction)
    content += `<div class="ai-correction">${escapeHtml(data.correction)}</div>`;
  if (data.expression_tip)
    content += `<div class="ai-tip">${escapeHtml(data.expression_tip)}</div>`;
  el.innerHTML = `<div class="message-label">AI 先生</div><div class="bubble">${content}</div>`;
  messagesEl.appendChild(el);
  scrollToBottom();
}

function showLimitReached() {
  // Remove any existing limit banner first
  document.getElementById("limit-banner")?.remove();
  const el = document.createElement("div");
  el.id = "limit-banner";
  el.className = "limit-banner";
  el.innerHTML = `
    <div class="limit-banner-icon">🔒</div>
    <div class="limit-banner-text">
      <strong>今月の利用上限に達しました</strong>
      <span>引き続き練習するにはプランをアップグレード</span>
    </div>
    <a href="/plans" class="limit-banner-btn">プランを見る</a>`;
  messagesEl.appendChild(el);
  scrollToBottom();
}

function addErrorMessage(text) {
  const el = document.createElement("div");
  el.className = "message ai";
  el.innerHTML = `<div class="bubble" style="background:#ffe0e0;color:#c00;">⚠️ ${escapeHtml(text)}</div>`;
  messagesEl.appendChild(el);
  scrollToBottom();
}

function showTyping() {
  const el = document.createElement("div");
  el.className = "message ai";
  el.innerHTML = `<div class="message-label">AI 先生</div>
    <div class="typing-indicator"><span></span><span></span><span></span></div>`;
  messagesEl.appendChild(el);
  scrollToBottom();
  return el;
}

function scrollToBottom() {
  const area = document.getElementById("chat-area");
  area.scrollTop = area.scrollHeight;
}

function escapeHtml(text) {
  const d = document.createElement("div");
  d.textContent = text;
  return d.innerHTML;
}

// ===== Speech Recognition =====
function setupSpeechRecognition() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) {
    micBtn.style.opacity = "0.4";
    micBtn.title = "このブラウザは音声入力に対応していません";
    micBtn.disabled = true;
    return;
  }

  recognition = new SR();
  recognition.lang = "en-US";
  recognition.interimResults = true;
  recognition.continuous = true;

  recognition.onstart = () => {
    isRecording = true;
    micBtn.classList.add("recording");
    micBtn.textContent = "🔴";
    voiceStatus.classList.remove("hidden");
    speechPreview.classList.remove("hidden");
    speechPreview.textContent = "...";
  };

  recognition.onresult = (e) => {
    const transcript = Array.from(e.results).map(r => r[0].transcript).join("");
    speechPreview.textContent = transcript;
    textInput.value = transcript;
  };

  // Restart automatically if still recording (handles browser auto-stop on silence)
  recognition.onend = () => {
    if (isRecording) recognition.start();
  };

  recognition.onerror = (e) => {
    if (e.error === "no-speech") return;
    isRecording = false;
    micBtn.classList.remove("recording");
    micBtn.textContent = "🎙️";
    voiceStatus.classList.add("hidden");
    speechPreview.classList.add("hidden");
    if (e.error !== "aborted") addErrorMessage(`音声認識エラー: ${e.error}`);
  };
}

function toggleRecording() {
  if (!recognition) return;
  if (isRecording) {
    isRecording = false;
    recognition.stop();
    micBtn.classList.remove("recording");
    micBtn.textContent = "🎙️";
    voiceStatus.classList.add("hidden");
    speechPreview.classList.add("hidden");
    textInput.focus();

    const rawText = textInput.value.trim();
    if (rawText) correctTranscript(rawText);
  } else {
    textInput.value = "";
    isRecording = true;
    recognition.start();
  }
}

// ===== TTS =====
function loadVoices() {
  function populate() {
    availableVoices = window.speechSynthesis.getVoices().filter(v => v.lang.startsWith("en"));
    voiceSelect.innerHTML = "";
    availableVoices.forEach((v, i) => {
      const opt = document.createElement("option");
      opt.value = i;
      opt.textContent = `${v.name} (${v.lang})`;
      voiceSelect.appendChild(opt);
    });
    const pref = availableVoices.findIndex(v =>
      v.name.includes("Ava") || v.name.includes("Samantha") ||
      v.name.includes("Alex") || v.name.includes("Karen")
    );
    if (pref >= 0) voiceSelect.value = pref;
  }
  populate();
  if (window.speechSynthesis.onvoiceschanged !== undefined)
    window.speechSynthesis.onvoiceschanged = populate;
}

function speak(text) {
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  const idx = parseInt(voiceSelect.value);
  if (availableVoices[idx]) u.voice = availableVoices[idx];
  u.rate = 0.9;
  window.speechSynthesis.speak(u);
}

// ===== Start =====
init();
