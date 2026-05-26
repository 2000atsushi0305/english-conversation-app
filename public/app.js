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

// テーマ別スターター文（Boba から見た会話の入り口）
const THEME_STARTERS = {
  daily: [
    "How was your day so far?",
    "What's the weather like?",
    "Tell me something good that happened today.",
    "What are you up to?",
  ],
  travel: [
    "Where would you love to go next?",
    "Tell me about a trip you remember.",
    "What's your dream vacation?",
    "Beach, mountain, or city?",
  ],
  business: [
    "How's work going?",
    "What did you work on today?",
    "Any meetings this week?",
    "What's a goal you're chasing right now?",
  ],
  hobbies: [
    "What do you do to relax?",
    "Tell me about a hobby you love.",
    "Watched or played anything fun lately?",
    "What's on your weekend plan?",
  ],
  food: [
    "What did you eat today?",
    "What's your comfort food?",
    "Any restaurant you keep going back to?",
    "Sweet or savory snacks?",
  ],
  movies: [
    "Watched anything good lately?",
    "What's a movie you'd recommend?",
    "What music are you into these days?",
    "Tell me about a song stuck in your head.",
  ],
};

// Boba から最初に話しかける一言（テーマ別、ランダム選択）
const THEME_OPENERS = {
  daily: [
    { english: "Hey {name} 🫧 I just had a warm sip of milk tea. How's your day going?",
      japanese_translation: "やっほ{name} 🫧  ちょうどミルクティー飲んでたとこ。今日はどんな感じ？" },
    { english: "Hi {name}! It's nice and quiet today. What've you been up to?",
      japanese_translation: "やっほ{name}！今日は静かでいい感じ。何してたの？" },
  ],
  travel: [
    { english: "Hi {name} ✈️ I was just daydreaming about beaches. Where would you love to go?",
      japanese_translation: "やっほ{name} ✈️ ビーチに行きたいな〜って妄想してた。{name}はどこ行きたい？" },
    { english: "Hey {name}! If you could hop on a plane right now, where would you go?",
      japanese_translation: "やっほ{name}！今すぐ飛行機乗れるとしたら、どこ行く？" },
  ],
  business: [
    { english: "Hi {name} ☕ Hope work isn't too tough today. How's it going?",
      japanese_translation: "やっほ{name} ☕ お仕事大変じゃないといいけど… 今日どう？" },
    { english: "Hey {name}! Quick break from work? Tell me what you're working on.",
      japanese_translation: "やっほ{name}！ちょっと休憩タイム？何やってるか教えて〜" },
  ],
  hobbies: [
    { english: "Hi {name} 🌿 What do you do when you want to unwind?",
      japanese_translation: "やっほ{name} 🌿 リラックスしたい時、何してる？" },
    { english: "Hey {name}! What's a hobby that makes you smile?",
      japanese_translation: "やっほ{name}！楽しくなる趣味とかある？" },
  ],
  food: [
    { english: "Hi {name} 🍡 I'm curious — what did you eat today?",
      japanese_translation: "やっほ{name} 🍡 気になる〜、今日は何食べた？" },
    { english: "Hey {name}! Tell me about your favorite snack.",
      japanese_translation: "やっほ{name}！好きなおやつ教えて〜" },
  ],
  movies: [
    { english: "Hi {name} 🎬 Watched anything cozy lately?",
      japanese_translation: "やっほ{name} 🎬 最近ほっこりする映画とか観た？" },
    { english: "Hey {name}! What song's been stuck in your head?",
      japanese_translation: "やっほ{name}！最近頭から離れない曲ある？" },
  ],
};

// ===== State =====
let conversationHistory = [];
let currentSessionId    = null;
let currentTheme        = "daily";
let currentDifficulty   = "intermediate";
let currentNickname     = "";
let isRecording         = false;
let mediaRecorder       = null;
let audioChunks         = [];
let ttsVoice            = null;
let _audioCtx           = null;

// ===== DOM =====
const messagesEl      = document.getElementById("messages");
const textInput       = document.getElementById("text-input");
const sendBtn         = document.getElementById("send-btn");
const micBtn          = document.getElementById("mic-btn");
const voiceStatus     = document.getElementById("voice-status");
const speechPreview   = document.getElementById("speech-preview");
const ttsToggle       = document.getElementById("tts-toggle");
const voiceSelect     = document.getElementById("voice-select");
const settingsPanel   = document.getElementById("settings-panel");
const menuBtn         = document.getElementById("menu-btn");
const drawer          = document.getElementById("drawer");
const drawerOverlay   = document.getElementById("drawer-overlay");
const drawerClose     = document.getElementById("drawer-close");

function openDrawer() {
  if (!drawer) return;
  drawer.classList.remove("hidden");
  drawer.classList.add("open");
  drawerOverlay.classList.remove("hidden");
  drawer.setAttribute("aria-hidden", "false");
  drawerOverlay.setAttribute("aria-hidden", "false");
  menuBtn?.setAttribute("aria-expanded", "true");
  document.body.classList.add("drawer-open");
}
function closeDrawer() {
  if (!drawer) return;
  drawer.classList.remove("open");
  drawerOverlay.classList.add("hidden");
  drawer.setAttribute("aria-hidden", "true");
  drawerOverlay.setAttribute("aria-hidden", "true");
  menuBtn?.setAttribute("aria-expanded", "false");
  document.body.classList.remove("drawer-open");
  // フェードアウトアニメ後に hidden（ドロワー幅をmeasureできるよう少し遅延）
  setTimeout(() => drawer.classList.add("hidden"), 280);
}
menuBtn?.addEventListener("click", openDrawer);
drawerClose?.addEventListener("click", closeDrawer);
drawerOverlay?.addEventListener("click", closeDrawer);
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && drawer?.classList.contains("open")) closeDrawer();
});
// ドロワー内リンク/ボタンのタップ後はドロワー閉じる（ただし設定操作は閉じない）
document.querySelectorAll(".drawer-link-item").forEach(item => {
  item.addEventListener("click", () => { setTimeout(closeDrawer, 80); });
});
const themeSelect     = document.getElementById("theme-select");
const nicknameInput   = document.getElementById("nickname-input");
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

let _currentStreak = 0;

// ===== Boba mood state =====
const VALID_MOODS = new Set(["happy", "cheer", "wow", "think", "oops", "shy", "sleep"]);
let _moodResetTimer = null;
let _idleTimer = null;

function setBobaMood(mood, opts = {}) {
  if (!VALID_MOODS.has(mood)) mood = "happy";
  const char = document.getElementById("ai-character");
  if (!char) return;
  // Remove any existing mood class
  char.classList.forEach(c => { if (c.startsWith("mood-")) char.classList.remove(c); });
  char.classList.add(`mood-${mood}`);
  // Auto-revert to happy after `revertAfter` ms (default: 6s for emotional moods, 0 = stay)
  if (_moodResetTimer) { clearTimeout(_moodResetTimer); _moodResetTimer = null; }
  const revertAfter = opts.revertAfter ?? (mood === "happy" || mood === "sleep" ? 0 : 6000);
  if (revertAfter > 0) {
    _moodResetTimer = setTimeout(() => setBobaMood("happy"), revertAfter);
  }
  resetIdleTimer();
}

function resetIdleTimer() {
  if (_idleTimer) clearTimeout(_idleTimer);
  _idleTimer = setTimeout(() => {
    const char = document.getElementById("ai-character");
    if (!char) return;
    if ([...char.classList].some(c => c === "talking")) return;
    setBobaMood("sleep", { revertAfter: 0 });
  }, 90000); // 90秒触らないとうとうと
}

// Wake from sleep on user activity
["click", "keydown", "touchstart"].forEach(ev => {
  document.addEventListener(ev, () => {
    const char = document.getElementById("ai-character");
    if (char && char.classList.contains("mood-sleep")) setBobaMood("happy");
    else resetIdleTimer();
  }, { passive: true });
});

async function checkAuth() {
  const res = await fetch("/api/me");
  if (res.status === 401) {
    location.href = "/auth";
    return false;
  }
  const data = await res.json();
  _currentStreak = data.streak || 0;
  updateUsageBadge(data);
  if (data.referral_code) setupReferralLink(data.referral_code);
  return true;
}

function setupReferralLink(code) {
  const url = `${location.origin}/auth?ref=${code}`;
  const existing = document.getElementById("referral-row");
  if (existing) return;
  const row = document.createElement("div");
  row.id = "referral-row";
  row.className = "settings-row";
  row.innerHTML = `
    <label class="settings-label">招待リンク</label>
    <div class="referral-wrap">
      <span class="referral-url">${url}</span>
      <button class="referral-copy-btn" onclick="copyReferral('${url}')">コピー</button>
    </div>
    <p class="referral-note">友達が登録すると双方に+70回ボーナス！</p>
  `;
  const newChatBtn = document.getElementById("new-chat-btn");
  newChatBtn.parentNode.insertBefore(row, newChatBtn);
}

function copyReferral(url) {
  navigator.clipboard.writeText(url).then(() => {
    const btn = document.querySelector(".referral-copy-btn");
    btn.textContent = "コピー済み ✅";
    setTimeout(() => btn.textContent = "コピー", 2000);
  });
}

const PLAN_LABELS = { free: "無料プラン", light: "スタンダード", premium: "プレミアム" };

function updateUsageBadge({ remaining, limit, plan, streak }) {
  if (streak != null) _currentStreak = streak;
  usageBadge.classList.remove("hidden", "usage-low", "usage-empty");
  const planLabel  = PLAN_LABELS[plan] || plan;
  const streakHtml = _currentStreak >= 1
    ? `<span class="badge-streak">🔥${_currentStreak}</span>` : "";
  if (limit === null) {
    // 念のため: 旧データで limit=null が来た場合は ∞ 表示
    usageBadge.innerHTML = `${streakHtml}<span class="badge-plan">${planLabel}</span><span class="badge-usage">🧋 ∞</span>`;
  } else {
    usageBadge.innerHTML = `${streakHtml}<span class="badge-plan">${planLabel}</span><span class="badge-usage">🧋 ${remaining} boba</span>`;
    if (remaining === 0)     usageBadge.classList.add("usage-empty");
    else if (remaining <= 10) usageBadge.classList.add("usage-low");
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
  loadBestVoice();
  loadSettings();
  setupEventListeners();
  setBobaMood("happy");
  loadCharacters();
  checkOnboarding();
  if (localStorage.getItem("onboarding_done")) newConversation();
  setupNotify();
  loadDailyChallenge();
  loadProgress();
}

// ===== Characters =====
let _characters = [];
let _userPlan   = "free";
window._currentCharacter = "milk";

async function loadCharacters() {
  try {
    const res = await fetch("/api/characters");
    if (!res.ok) return;
    const data = await res.json();
    _characters = data.characters || [];
    _userPlan = data.plan || "free";
    window._currentCharacter = data.chosen || "milk";
    renderCharacterPicker();
    updateCurrentCharacterLabel();

    // 管理者判定 → 管理者でなければ dev プラン切替UIを丸ごと非表示
    try {
      const ar = await fetch("/api/dev/is-admin");
      const ad = await ar.json();
      if (!ad.is_admin) {
        const wrap = document.getElementById("dev-plan-switcher");
        const label = wrap?.previousElementSibling; // 「🛠️ プラン切替（テスト用）」見出し
        const note = wrap?.nextElementSibling;       // 説明 <p>
        wrap?.remove();
        if (label && label.classList.contains("drawer-section-label")) label.remove();
        if (note && note.classList.contains("dev-plan-note")) note.remove();
      }
    } catch (_) { /* silent */ }
  } catch (_) { /* silent */ }
}

function renderCharacterPicker() {
  const el = document.getElementById("character-picker");
  if (!el || !_characters.length) return;
  el.innerHTML = _characters.map(c => {
    const isActive = c.id === window._currentCharacter;
    const locked = !c.unlocked;
    return `
      <button class="char-card ${isActive ? 'is-active' : ''} ${locked ? 'is-locked' : ''}"
              data-id="${c.id}" type="button"
              ${locked ? 'aria-disabled="true"' : ''}>
        <img src="/public/characters/${c.id}.svg" alt="${c.name}" class="char-card-img" loading="lazy" />
        <span class="char-card-body">
          <span class="char-card-name">${c.emoji} ${c.name}</span>
          <span class="char-card-meta">${themeShort(c.theme_specialty)}</span>
        </span>
        ${locked ? '<span class="char-card-lock">🔒</span>' : (isActive ? '<span class="char-card-check">✓</span>' : '')}
      </button>
    `;
  }).join("");
  el.querySelectorAll(".char-card").forEach(btn => {
    btn.addEventListener("click", () => {
      const id = btn.dataset.id;
      const c = _characters.find(x => x.id === id);
      if (!c) return;
      if (!c.unlocked) {
        if (confirm(`「${c.name}」は有料プラン限定。アップグレード画面を開く？`)) {
          location.href = "/plans";
        }
        return;
      }
      selectCharacter(id);
    });
  });
}

function themeShort(theme) {
  const map = {daily:"💬 日常会話", travel:"✈️ 旅行", business:"💼 ビジネス",
               hobbies:"🎮 趣味", food:"🍜 食べ物", movies:"🎬 映画・音楽"};
  return map[theme] || theme;
}

async function selectCharacter(id) {
  try {
    const res = await fetch("/api/character", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ character: id }),
    });
    const data = await res.json();
    if (!data.ok) {
      if (data.error === "premium_required") {
        location.href = "/plans";
      }
      return;
    }
    window._currentCharacter = id;
    renderCharacterPicker();
    updateCurrentCharacterLabel();
    // ドロワーを閉じる
    setTimeout(() => { try { closeDrawer(); } catch(_) {} }, 200);
  } catch (_) { /* silent */ }
}

function currentCharacterInfo() {
  return _characters.find(c => c.id === window._currentCharacter)
      || { id: "milk", name: "ミルクボバ", emoji: "🫧" };
}

function updateCurrentCharacterLabel() {
  const c = currentCharacterInfo();
  // 全てのAIメッセージラベル更新
  document.querySelectorAll(".message.ai .message-label").forEach(el => {
    el.textContent = `${c.emoji} ${c.name}`;
  });
  // チャット上部のキャラを色変更（CSS製、表情はそのまま動く）
  const charEl = document.getElementById("ai-character");
  if (charEl) {
    ["milk","matcha","kokutou","ichigo","coffee","sakura"].forEach(id =>
      charEl.classList.remove(`char-of-${id}`));
    charEl.classList.add(`char-of-${c.id}`);
  }
  const label = document.querySelector(".char-label");
  if (label) label.textContent = c.name;
}

function autoResizeInput() {
  textInput.style.height = "auto";
  textInput.style.height = textInput.scrollHeight + "px";
}

function setupEventListeners() {
  sendBtn.addEventListener("click", sendMessage);
  micBtn.addEventListener("click", toggleRecording);
  textInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  });
  textInput.addEventListener("input", autoResizeInput);

  // settings-panel はドロワー内に常駐するので toggle は不要

  themeSelect.addEventListener("change", () => {
    currentTheme = themeSelect.value;
    saveSettings();
    updateSessionInfo();
    if (conversationHistory.length > 0) addChangeMarker();
  });

  nicknameInput.addEventListener("change", () => {
    currentNickname = nicknameInput.value.trim();
    saveSettings();
  });

  document.querySelectorAll(".diff-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".diff-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      currentDifficulty = btn.dataset.level;
      saveSettings();
      updateSessionInfo();
      if (conversationHistory.length > 0) addChangeMarker();
    });
  });

  newChatBtn.addEventListener("click", () => {
    closeDrawer();
    const msgs = conversationHistory.filter(m => m.role !== "marker");
    const userCount = msgs.filter(m => m.role === "user").length;
    if (userCount >= 2) {
      showReviewModal(msgs);
    } else {
      saveCurrentSession();
      newConversation();
    }
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
  currentNickname   = s.nickname   || "";
  themeSelect.value = currentTheme;
  nicknameInput.value = currentNickname;
  document.querySelectorAll(".diff-btn").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.level === currentDifficulty);
  });
  const notifyToggle = document.getElementById("notify-toggle");
  if (notifyToggle) notifyToggle.checked = !!s.notify;
}

function saveSettings() {
  const notifyToggle = document.getElementById("notify-toggle");
  localStorage.setItem("english_settings", JSON.stringify({
    theme: currentTheme, difficulty: currentDifficulty, nickname: currentNickname,
    notify: notifyToggle ? notifyToggle.checked : false,
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
  const all = JSON.parse(localStorage.getItem("english_sessions") || "[]");
  if (all.length > 5) {
    const trimmed = all.slice(0, 5);
    localStorage.setItem("english_sessions", JSON.stringify(trimmed));
    return trimmed;
  }
  return all;
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
  saveSessions(sessions.slice(0, 5));
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
    } else if (msg.role === "marker") {
      renderMarker(msg.content);
    } else {
      let data;
      try { data = JSON.parse(msg.content); } catch(e) { data = { english: msg.content }; }
      addAIMessage(data);
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
  const starters = THEME_STARTERS[currentTheme] || THEME_STARTERS.daily;

  const challenge = JSON.parse(localStorage.getItem("challenge_expression") || "null");
  const challengeHtml = challenge ? `
    <div class="challenge-banner">
      <div class="challenge-label">🎯 前回のチャレンジ表現</div>
      <div class="challenge-expression">${escapeHtml(challenge.expression)}</div>
      <div class="challenge-hint">${escapeHtml(challenge.japanese)} — ${escapeHtml(challenge.hint)}</div>
      <button class="starter-btn challenge-btn" onclick="useStarter('${challenge.expression.replace(/'/g, "\\'")}')">この表現で練習する</button>
      <button class="challenge-dismiss" onclick="dismissChallenge()">✕</button>
    </div>` : "";

  // テーマ切替pill (1tap)
  const themePillsHtml = `
    <div class="theme-pills" role="tablist" aria-label="会話テーマ">
      ${Object.entries(THEME_LABELS).map(([k, v]) =>
        `<button class="theme-pill ${k === currentTheme ? 'active' : ''}" data-theme="${k}" onclick="switchTheme('${k}')">${v}</button>`
      ).join("")}
    </div>`;

  const greeting = currentNickname ? `${currentNickname}、` : "";
  const el = document.createElement("div");
  el.className = "welcome";
  el.innerHTML = `
    <h2>${greeting}おかえり〜 🫧</h2>
    <p class="welcome-sub">テーマを選んで、英語でゆっくりおしゃべりしようね</p>
    ${themePillsHtml}
    ${challengeHtml}
    <div class="starter-buttons">
      <div class="starter-label">話しかけてみる</div>
      ${starters.map(s => `<button class="starter-btn" onclick="useStarter('${s.replace(/'/g, "\\'")}')">${s}</button>`).join("")}
    </div>
    `;
  messagesEl.appendChild(el);
  if (_dailyChallenge) refreshDailyBanner();

  // Boba から先に話しかける（少し遅延でタイピング演出）
  if (!_quickMode) showBobaOpener();
}

function switchTheme(theme) {
  if (currentTheme === theme) return;
  currentTheme = theme;
  themeSelect.value = theme;
  saveSettings();
  updateSessionInfo();
  if (conversationHistory.length > 0) {
    addChangeMarker();
  } else {
    // welcome画面のpillをactive更新 + スターター更新
    document.querySelectorAll(".theme-pill").forEach(p => {
      p.classList.toggle("active", p.dataset.theme === theme);
    });
    const sb = document.querySelector(".starter-buttons");
    if (sb) {
      const newStarters = THEME_STARTERS[theme] || THEME_STARTERS.daily;
      sb.innerHTML = `<div class="starter-label">話しかけてみる</div>` +
        newStarters.map(s => `<button class="starter-btn" onclick="useStarter('${s.replace(/'/g, "\\'")}')">${s}</button>`).join("");
    }
  }
}

function showBobaOpener() {
  // 既にBobaの開幕メッセージを出していればスキップ
  if (document.querySelector(".boba-opener")) return;

  const openers = THEME_OPENERS[currentTheme] || THEME_OPENERS.daily;
  const opener = openers[Math.floor(Math.random() * openers.length)];
  const namePart = currentNickname ? ` ${currentNickname}` : "";
  const english = opener.english.replace(/\{name\}/g, currentNickname || "there").replace(/  +/g, " ");
  const japanese = opener.japanese_translation.replace(/\{name\}/g, currentNickname || "");

  setBobaMood("shy");

  const typingEl = showTyping();
  setTimeout(() => {
    typingEl.remove();
    const data = { english, japanese_translation: japanese };
    addAIMessage(data, { extraClass: "boba-opener" });
    setBobaMood("happy");
    if (ttsToggle?.checked) speak(english);
    // 履歴には保存しない（実会話のターンとしてカウントしないため）
  }, 1100);
}

function dismissChallenge() {
  localStorage.removeItem("challenge_expression");
  document.querySelector(".challenge-banner")?.remove();
}

function useStarter(text) { textInput.value = text; sendMessage(); }

// ===== Send =====
async function sendMessage() {
  stopRecording();
  _unlockAudioCtx(); // ユーザー操作のタイミングでAudioContextを解放

  const text = textInput.value.trim();
  if (!text) return;

  // ヒントチップを閉じる
  hintChips.classList.add("hidden");

  textInput.value = "";
  autoResizeInput();
  const userMsgEl = addUserMessage(text);
  // Bobaちゃんが考え中
  setBobaMood("think");
  // タピオカパールが飛ぶ演出
  spawnPearlBurst(userMsgEl);
  conversationHistory.push({ role: "user", content: text });
  updateSessionInfo();
  saveCurrentSession();

  const typingEl = showTyping();

  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages:   conversationHistory.filter(m => m.role !== "marker"),
        theme:      currentTheme,
        difficulty: currentDifficulty,
        nickname:   currentNickname,
        character:  window._currentCharacter || "milk",
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
    if (data.streak != null) {
      _currentStreak = data.streak;
      if (data.usage) data.usage.streak = data.streak;
      if (data.streak_updated) {
        showStreakCard(data.streak);
        if (isStreakMilestone(data.streak)) celebrateMilestone(data.streak);
      }
    }
    checkFeedbackPrompt();

    addUserTranslation(userMsgEl, data.user_translation);
    attachUserFeedback(userMsgEl, data);
    addAIMessage(data);

    // Mood切替（AIが返してきた mood を尊重、無ければ correction → oops, expression_tip → think, default happy）
    let mood = data.mood;
    if (!VALID_MOODS.has(mood)) {
      if (data.correction)           mood = "oops";
      else if (data.expression_tip)  mood = "think";
      else                           mood = "happy";
    }
    setBobaMood(mood);
    checkQuickModeDone();
    const assistantJson = JSON.stringify({
      english: data.english,
      japanese_translation: data.japanese_translation || "",
      correction: data.correction || null,
      expression_tip: data.expression_tip || null,
    });
    conversationHistory.push({ role: "assistant", content: assistantJson });
    saveCurrentSession();

    if (ttsToggle.checked && data.english) speak(data.english);

  } catch {
    typingEl.remove();
    addErrorMessage("通信エラーが発生しました。サーバーが起動しているか確認してください。");
    conversationHistory.pop();
  }
}

// ===== Render =====
function addChangeMarker() {
  const label = `${THEME_LABELS[currentTheme] || currentTheme}　${DIFF_LABELS[currentDifficulty] || currentDifficulty}`;
  const marker = { role: "marker", content: label };
  conversationHistory.push(marker);
  saveCurrentSession();
  renderMarker(label);
}

function renderMarker(label) {
  const el = document.createElement("div");
  el.className = "change-marker";
  el.textContent = `── ${label} に変更 ──`;
  messagesEl.appendChild(el);
  scrollToBottom();
}

function addUserMessage(text) {
  document.querySelector(".welcome")?.remove();
  const el = document.createElement("div");
  el.className = "message user";
  el.innerHTML = `<div class="message-label">あなた</div><div class="bubble">${escapeHtml(text)}</div>`;
  messagesEl.appendChild(el);
  scrollToBottom();
  return el;
}

function addUserTranslation(userMsgEl, translation) {
  if (!translation || !userMsgEl) return;
  const tr = document.createElement("div");
  tr.className = "user-translation";
  tr.textContent = translation;
  userMsgEl.appendChild(tr);
  scrollToBottom();
}

// ===== User feedback chip (evaluation badge + collapsible details) =====
const NATURALNESS_META = {
  perfect: {
    icon: "✨", label: "Perfect", short: "ナチュラル！",
    cls: "fb-perfect",
  },
  natural: {
    icon: "👍", label: "Natural", short: "OK!",
    cls: "fb-natural",
  },
  understood_but_improvable: {
    icon: "💡", label: "通じる", short: "もっと自然な言い方あり",
    cls: "fb-improve",
  },
  has_errors: {
    icon: "📝", label: "直し", short: "ちっちゃい直しだけ",
    cls: "fb-error",
  },
  unclear: {
    icon: "❓", label: "うまく取れず", short: "もう一度ゆっくり",
    cls: "fb-unclear",
  },
};
const MISTAKE_TYPE_LABEL_JS = {
  tense: "時制", subject_verb: "主語/動詞一致", article: "冠詞", preposition: "前置詞",
  word_order: "語順", countable: "可算/不可算", gerund_infinitive: "動名詞/不定詞",
  relative: "関係代名詞", plural: "単複", spelling: "スペリング", other: "その他",
};

function attachUserFeedback(userMsgEl, data) {
  if (!userMsgEl) return;
  const naturalness = data.naturalness || "natural";
  const meta = NATURALNESS_META[naturalness] || NATURALNESS_META.natural;

  // チップタグ部分（タグはミスありなら mistake_type、それ以外は label）
  const tagText = naturalness === "has_errors" && data.mistake_type
    ? `${meta.icon} ${MISTAKE_TYPE_LABEL_JS[data.mistake_type] || data.mistake_type}`
    : `${meta.icon} ${meta.label}`;

  // 詳細パネル内容
  const detailParts = [];

  // perfect / natural: 短いメッセージのみ
  if (naturalness === "perfect" || naturalness === "natural") {
    detailParts.push(`<div class="fb-detail-msg">${meta.short}</div>`);
  }

  // 音声補正
  if (data.corrected_input) {
    detailParts.push(`
      <div class="fb-detail-block">
        <div class="fb-detail-label">🎙️ 音声補正</div>
        <div class="fb-detail-value">${escapeHtml(data.corrected_input)}</div>
      </div>`);
  }

  // ミスありの場合: correction + corrected_english + 練習ボタン
  if (naturalness === "has_errors" && data.correction) {
    detailParts.push(`
      <div class="fb-detail-block fb-correction">
        <div class="fb-detail-label">✏️ 文法チェック</div>
        <div class="fb-detail-value">${escapeHtml(data.correction)}</div>
      </div>`);
    if (data.corrected_english) {
      detailParts.push(`
        <button class="fb-practice-btn" data-practice="${escapeHtml(data.corrected_english).replace(/"/g, '&quot;')}">
          🎯 この英文で1回練習する
        </button>`);
    }
  }

  // understood_but_improvable: natural_alternatives 表示
  if (naturalness === "understood_but_improvable" && Array.isArray(data.natural_alternatives) && data.natural_alternatives.length > 0) {
    const altsHtml = data.natural_alternatives.map((a, i) => `
      <div class="fb-alt-item">
        <div class="fb-alt-head">
          <span class="fb-alt-style fb-alt-style-${a.style || 'standard'}">${labelForStyle(a.style)}</span>
          <span class="fb-alt-english">${escapeHtml(a.english || "")}</span>
        </div>
        <div class="fb-alt-japanese">${escapeHtml(a.japanese || "")}</div>
        <button class="fb-practice-btn fb-practice-alt" data-practice="${escapeHtml(a.english || "").replace(/"/g, '&quot;')}">
          この言い方で練習
        </button>
      </div>`).join("");
    detailParts.push(`
      <div class="fb-detail-block">
        <div class="fb-detail-label">💡 もっと自然な言い方</div>
        <div class="fb-alts">${altsHtml}</div>
      </div>`);
  }

  // unclear: ヒント
  if (naturalness === "unclear") {
    detailParts.push(`<div class="fb-detail-msg">英語として読み取れませんでした。もう一度ゆっくり言ってみよう。</div>`);
  }

  const fb = document.createElement("div");
  fb.className = `user-feedback ${meta.cls}`;
  fb.innerHTML = `
    <button class="fb-chip" type="button" aria-expanded="false">
      <span class="fb-chip-text">${escapeHtml(tagText)}</span>
      <span class="fb-chip-arrow">▼</span>
    </button>
    <div class="fb-details" hidden>
      ${detailParts.join("")}
    </div>`;

  // チップトグル
  const chipBtn = fb.querySelector(".fb-chip");
  const details = fb.querySelector(".fb-details");
  chipBtn.addEventListener("click", () => {
    const isOpen = !details.hidden;
    details.hidden = isOpen;
    chipBtn.setAttribute("aria-expanded", String(!isOpen));
    chipBtn.querySelector(".fb-chip-arrow").textContent = isOpen ? "▼" : "▲";
  });

  // 練習ボタン
  fb.querySelectorAll(".fb-practice-btn").forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const text = btn.dataset.practice;
      if (text) {
        textInput.value = text;
        autoResizeInput();
        textInput.focus();
      }
    });
  });

  userMsgEl.appendChild(fb);
  scrollToBottom();
}

function labelForStyle(style) {
  switch (style) {
    case "casual":   return "カジュアル";
    case "concise":  return "シンプル";
    case "standard":
    default:         return "定番";
  }
}

function addAIMessage(data, opts = {}) {
  const el = document.createElement("div");
  el.className = "message ai" + (opts.extraClass ? ` ${opts.extraClass}` : "");
  let content = `
    <div class="ai-english-row">
      <span class="ai-english">${escapeHtml(data.english)}</span>
      <button class="replay-btn" title="もう一度聞く">🔊</button>
    </div>`;
  if (data.japanese_translation)
    content += `<div class="ai-translation">${escapeHtml(data.japanese_translation)}</div>`;
  // ※ corrected_input / correction はユーザー吹き出し下のフィードバックチップへ移動
  if (data.expression_tip)
    content += `<div class="ai-tip">${escapeHtml(data.expression_tip)}</div>`;
  const c = currentCharacterInfo();
  el.innerHTML = `<div class="message-label">${c.emoji} ${c.name}</div><div class="bubble">${content}</div>`;
  el.querySelector(".replay-btn").addEventListener("click", () => speak(data.english));
  messagesEl.appendChild(el);
  // Boba がメッセージ到着でちょっと喜ぶバウンス
  const char = document.getElementById("ai-character");
  if (char) {
    char.classList.add("ai-arrived");
    setTimeout(() => char.classList.remove("ai-arrived"), 700);
  }
  scrollToBottom();
}

// ── タピオカパール飛ばし演出 ──
function spawnPearlBurst(originEl) {
  if (!originEl) return;
  const rect = originEl.getBoundingClientRect();
  const layer = document.getElementById("fx-layer") || (() => {
    const l = document.createElement("div");
    l.id = "fx-layer";
    document.body.appendChild(l);
    return l;
  })();
  const charEl = document.getElementById("ai-character");
  const target = charEl ? charEl.getBoundingClientRect() : { left: rect.left, top: rect.top - 100 };
  const startX = rect.left + rect.width / 2;
  const startY = rect.top + rect.height / 2;
  const endX = target.left + (target.width || 60) / 2;
  const endY = target.top + (target.height || 60) / 2;

  for (let i = 0; i < 5; i++) {
    const p = document.createElement("div");
    p.className = "fx-pearl";
    const dx = (endX - startX) + (Math.random() * 40 - 20);
    const dy = (endY - startY) + (Math.random() * 30 - 15);
    p.style.setProperty("--dx", `${dx}px`);
    p.style.setProperty("--dy", `${dy}px`);
    p.style.left = `${startX}px`;
    p.style.top  = `${startY}px`;
    p.style.animationDelay = `${i * 35}ms`;
    layer.appendChild(p);
    setTimeout(() => p.remove(), 800 + i * 35);
  }
}

// ── ストリーク マイルストーン祝祭 ──
function isStreakMilestone(s) {
  return s === 3 || s === 7 || s === 14 || s === 30 || s === 50 || s === 100 || (s > 30 && s % 10 === 0);
}

function celebrateMilestone(streak) {
  setBobaMood("cheer", { revertAfter: 8000 });
  const layer = document.getElementById("fx-layer") || (() => {
    const l = document.createElement("div");
    l.id = "fx-layer";
    document.body.appendChild(l);
    return l;
  })();
  // 紙吹雪 (boba pearls + sakura)
  const colors = ["#3D2615", "#5A3E2A", "#E8B4A0", "#D4A256", "#6B8E5A", "#FBE7DD"];
  for (let i = 0; i < 60; i++) {
    const c = document.createElement("div");
    c.className = "fx-confetti";
    c.style.left = `${Math.random() * 100}vw`;
    c.style.background = colors[i % colors.length];
    c.style.animationDelay = `${Math.random() * 400}ms`;
    c.style.animationDuration = `${1500 + Math.random() * 1500}ms`;
    c.style.transform = `rotate(${Math.random() * 360}deg)`;
    if (Math.random() > 0.5) c.classList.add("fx-confetti-round");
    layer.appendChild(c);
    setTimeout(() => c.remove(), 3500);
  }
  // 中央バナー
  const milestoneBadge = streak >= 100 ? "👑" : streak >= 30 ? "🏆" : streak >= 7 ? "🌟" : "✨";
  const banner = document.createElement("div");
  banner.className = "fx-milestone-banner";
  banner.innerHTML = `<div class="fx-milestone-icon">${milestoneBadge}</div>
    <div class="fx-milestone-num">${streak}日連続！</div>
    <div class="fx-milestone-msg">${getStreakMessage(streak)}</div>`;
  layer.appendChild(banner);
  setTimeout(() => {
    banner.classList.add("fx-milestone-out");
    setTimeout(() => banner.remove(), 400);
  }, 2800);
}

// ===== Stats Modal =====
const statsModal = document.getElementById("stats-modal");
document.getElementById("stats-close").addEventListener("click", () => {
  statsModal.classList.add("hidden");
  modalOverlay.classList.add("hidden");
});

let _mistakesTop = null;

async function loadMistakesTop() {
  try {
    const res = await fetch("/api/mistakes/top");
    if (!res.ok) return;
    _mistakesTop = await res.json();
  } catch (_) { _mistakesTop = null; }
}

async function openStatsModal() {
  statsModal.classList.remove("hidden");
  modalOverlay.classList.remove("hidden");
  renderStatsModal();
  await Promise.all([loadProgress(), loadMistakesTop()]);
  renderStatsModal();
}

function renderStatsModal() {
  const body = document.getElementById("stats-body");

  const streakHtml = `
    <div class="stats-streak-section">
      <div class="stats-streak-num">${_currentStreak > 0 ? "🔥" : "💤"} ${_currentStreak}日連続</div>
      <div class="stats-streak-msg">${getStreakMessage(_currentStreak)}</div>
    </div>`;

  const progressHtml = _progress.length ? _progress.map(p => {
    const lv   = getLevel(p.sessions);
    const pct  = Math.round(lv.fill * 100);
    const icon = THEME_ICONS[p.theme] || "📝";
    const name = (THEME_LABELS[p.theme] || p.theme).replace(/^.\s/, "");
    return `
      <div class="stats-theme-item ${p.sessions === 0 ? "stats-theme-empty" : ""}">
        <div class="stats-theme-top">
          <span class="stats-theme-name">${icon} ${name}</span>
          <span class="stats-theme-level" style="color:${lv.color}">${lv.label}</span>
          <span class="stats-theme-count">${p.sessions}回</span>
        </div>
        <div class="progress-bar-bg">
          <div class="progress-bar-fill" style="width:${pct}%;background:${lv.color}"></div>
        </div>
      </div>`;
  }).join("") : `<p class="review-empty">会話するとここに記録されます</p>`;

  // 苦手分野 TOP（直近30日）
  const medals = ["🥇", "🥈", "🥉"];
  let mistakesHtml = "";
  if (_mistakesTop && _mistakesTop.top && _mistakesTop.top.length > 0) {
    mistakesHtml = `
      <div class="stats-section-label">苦手分野 TOP（直近30日）</div>
      <div class="stats-mistakes">
        ${_mistakesTop.top.slice(0, 3).map((m, i) => `
          <div class="stats-mistake-row">
            <span class="stats-mistake-medal">${medals[i] || "・"}</span>
            <span class="stats-mistake-label">${escapeHtml(m.label)}</span>
            <span class="stats-mistake-count">${m.count}回</span>
          </div>`).join("")}
      </div>
      <div class="stats-mistake-total">直近30日の合計 ${_mistakesTop.total} 件</div>`;
  } else if (_mistakesTop) {
    mistakesHtml = `
      <div class="stats-section-label">苦手分野 TOP（直近30日）</div>
      <p class="review-empty">まだ文法ミスの記録がありません 🌱</p>`;
  }

  body.innerHTML = `
    ${streakHtml}
    <div class="stats-section-label">テーマ別の成長</div>
    <div class="stats-progress-list">${progressHtml}</div>
    ${mistakesHtml}`;
}

function getStreakMessage(streak) {
  if (streak === 0)  return "今日から始めよう！";
  if (streak < 3)    return "いいスタート！続けてみよう";
  if (streak < 7)    return "習慣になってきた！";
  if (streak < 14)   return "1週間以上！すごい継続力";
  if (streak < 30)   return "もう習慣が身についてる！";
  return "英語学習のプロ！";
}

// ===== Theme Progress =====
const THEME_ICONS = { daily:"💬", travel:"✈️", business:"💼", hobbies:"🎮", food:"🍜", movies:"🎬" };

let _progress = [];

async function loadProgress() {
  try {
    const res = await fetch("/api/progress");
    if (!res.ok) return;
    const data = await res.json();
    _progress = data.progress || [];
    refreshProgressPanel();
  } catch { /* silent */ }
}

function getLevel(sessions) {
  if (sessions === 0)   return { label: "未挑戦",       color: "#ccc",    fill: 0,                              next: 1  };
  if (sessions <= 4)    return { label: "初心者",       color: "#90caf9", fill: sessions / 5,                  next: 5  };
  if (sessions <= 9)    return { label: "慣れてきた",   color: "#66bb6a", fill: (sessions - 4) / 6,            next: 10 };
  if (sessions <= 19)   return { label: "中級者",       color: "#26a69a", fill: (sessions - 9) / 11,           next: 20 };
  if (sessions <= 34)   return { label: "上級者",       color: "#ffa726", fill: (sessions - 19) / 16,          next: 35 };
  if (sessions <= 49)   return { label: "エキスパート", color: "#ef5350", fill: (sessions - 34) / 16,          next: 50 };
  return                { label: "🏆 マスター",         color: "#ab47bc", fill: 1,                              next: null };
}

function refreshProgressPanel() {
  const panel = document.querySelector(".progress-panel");
  if (!panel || !_progress.length) return;

  const hasAny = _progress.some(p => p.sessions > 0);
  if (!hasAny) {
    panel.innerHTML = `<div class="progress-empty">会話するとテーマ別の成長が記録されます 📈</div>`;
    return;
  }

  panel.innerHTML = _progress.map(p => {
    const lv   = getLevel(p.sessions);
    const pct  = Math.round(lv.fill * 100);
    const icon = THEME_ICONS[p.theme] || "📝";
    const name = (THEME_LABELS[p.theme] || p.theme).replace(/^.+?\s/, ""); // 絵文字除去
    return `
      <div class="progress-item ${p.sessions === 0 ? "progress-item-empty" : ""}">
        <div class="progress-item-top">
          <span class="progress-theme">${icon} ${name}</span>
          <span class="progress-level" style="color:${lv.color}">${lv.label}</span>
        </div>
        <div class="progress-bar-bg">
          <div class="progress-bar-fill" style="width:${pct}%;background:${lv.color}"></div>
        </div>
        <div class="progress-count">${p.sessions}回</div>
      </div>`;
  }).join("");
}

// ===== Daily Challenge & Notification =====
let _dailyChallenge = null;

async function subscribePush() {
  const sw = await navigator.serviceWorker.ready;
  const res = await fetch("/api/push/vapid-public-key");
  const { publicKey } = await res.json();
  if (!publicKey) return null;

  // base64url → Uint8Array
  const padding = "=".repeat((4 - publicKey.length % 4) % 4);
  const raw = atob((publicKey + padding).replace(/-/g, "+").replace(/_/g, "/"));
  const key = new Uint8Array([...raw].map(c => c.charCodeAt(0)));

  const sub = await sw.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: key,
  });
  await fetch("/api/push/subscribe", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(sub.toJSON()),
  });
  return sub;
}

async function unsubscribePush() {
  const sw = await navigator.serviceWorker.ready;
  const sub = await sw.pushManager.getSubscription();
  if (!sub) return;
  await fetch("/api/push/unsubscribe", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ endpoint: sub.endpoint }),
  });
  await sub.unsubscribe();
}

function setupNotify() {
  const toggle = document.getElementById("notify-toggle");
  if (!toggle) return;

  toggle.addEventListener("change", async () => {
    if (toggle.checked) {
      if (!("Notification" in window) || !("serviceWorker" in navigator)) {
        alert("このブラウザはプッシュ通知に対応していません");
        toggle.checked = false; return;
      }
      const perm = await Notification.requestPermission();
      if (perm !== "granted") {
        document.getElementById("notify-label").textContent = "通知が許可されていません";
        toggle.checked = false; return;
      }
      try {
        await subscribePush();
        document.getElementById("notify-label").textContent = "毎日の一言を受け取る ✅";
      } catch {
        document.getElementById("notify-label").textContent = "リマインダーの設定に失敗しました";
        toggle.checked = false; return;
      }
    } else {
      await unsubscribePush();
      document.getElementById("notify-label").textContent = "毎日の一言を受け取る";
    }
    saveSettings();
  });

  // 既に許可済み & 設定ONならラベル更新
  if (toggle.checked && Notification.permission === "granted") {
    document.getElementById("notify-label").textContent = "毎日の一言を受け取る ✅";
  }
}

async function loadDailyChallenge() {
  try {
    const res  = await fetch("/api/daily-challenge");
    if (!res.ok) return;
    _dailyChallenge = await res.json();

    // 通知: 今日まだ表示していない場合
    const today     = new Date().toDateString();
    const lastNotif = localStorage.getItem("last_notif_date");
    const s         = JSON.parse(localStorage.getItem("english_settings") || "{}");
    if (s.notify && Notification.permission === "granted" && lastNotif !== today) {
      new Notification("☀️ 今日の一言チャレンジ", {
        body: `"${_dailyChallenge.expression}" — ${_dailyChallenge.japanese}\nやってみよう！`,
        icon: "/public/boba-icon.svg",
      });
      localStorage.setItem("last_notif_date", today);
    }

    // ウェルカム画面を更新（すでに表示中なら差し込む）
    refreshDailyBanner();
  } catch { /* silent */ }
}

function refreshDailyBanner() {
  const welcome = document.querySelector(".welcome");
  if (!welcome || !_dailyChallenge) return;
  document.querySelector(".daily-banner")?.remove();

  const today = new Date().toDateString();
  const done  = localStorage.getItem("daily_done_date") === today;
  if (done) return; // クリア済みはバナーを表示しない

  const banner  = document.createElement("div");
  banner.className = "daily-banner";
  banner.innerHTML = `
    <div class="daily-banner-label">☀️ 今日の一言チャレンジ</div>
    <div class="daily-banner-expression">${escapeHtml(_dailyChallenge.expression)}</div>
    <div class="daily-banner-japanese">${escapeHtml(_dailyChallenge.japanese)}</div>
    <div class="daily-banner-hint">💡 ${escapeHtml(_dailyChallenge.hint)}</div>
    <button class="daily-start-btn" onclick="startQuickMode()">この表現で練習する（3往復）</button>`;
  // チャレンジバナーの前か、starter-buttonsの前に挿入
  const ref = welcome.querySelector(".challenge-banner") || welcome.querySelector(".starter-buttons");
  if (ref) welcome.insertBefore(banner, ref);
  else welcome.appendChild(banner);
}

// クイックモード: 今日の表現を使って3往復
let _quickMode = false;
let _quickCount = 0;

function startQuickMode() {
  if (!_dailyChallenge) return;
  _quickMode  = true;
  _quickCount = 0;
  settingsPanel.classList.add("hidden");
  // 今日の一言を使ったセッション開始
  textInput.value = _dailyChallenge.expression;
  // ウェルカム画面に「クイックモード」表示
  document.querySelector(".daily-banner")?.remove();
  const notice = document.createElement("div");
  notice.className = "quick-mode-notice";
  notice.innerHTML = `🎯 クイックモード: <strong>"${escapeHtml(_dailyChallenge.expression)}"</strong> を使って3往復練習！`;
  document.querySelector(".welcome")?.remove();
  messagesEl.insertBefore(notice, messagesEl.firstChild);
  sendMessage();
}

function checkQuickModeDone() {
  if (!_quickMode) return;
  _quickCount++;
  if (_quickCount >= 3) {
    _quickMode = false;
    localStorage.setItem("daily_done_date", new Date().toDateString());
    const el = document.createElement("div");
    el.className = "quick-done-card";
    el.innerHTML = `🎉 クイックモード完了！<br><small>"${escapeHtml(_dailyChallenge?.expression || "")}" をマスターしました</small>`;
    messagesEl.appendChild(el);
    scrollToBottom();
    document.querySelector(".quick-mode-notice")?.remove();
    loadProgress(); // 進捗を再取得
  }
}

// ===== Review Modal =====
const reviewModal   = document.getElementById("review-modal");
const reviewCards   = document.getElementById("review-cards");
const reviewClose   = document.getElementById("review-close");
const reviewDoneBtn = document.getElementById("review-done-btn");

reviewClose.addEventListener("click",   closeReview);
reviewDoneBtn.addEventListener("click", closeReview);

async function showReviewModal(msgs) {
  reviewCards.innerHTML = `<div class="review-loading">✨ 今日の表現を分析中...</div>`;
  reviewModal.classList.remove("hidden");
  modalOverlay.classList.remove("hidden");

  try {
    const res  = await fetch("/api/review", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: msgs }),
    });
    const data = await res.json();
    renderReviewCards(data.cards || []);
  } catch {
    reviewCards.innerHTML = `<p class="review-error">表現の取得に失敗しました</p>`;
  }
}

function renderReviewCards(cards) {
  if (!cards.length) {
    reviewCards.innerHTML = `<p class="review-empty">会話を続けると表現カードが生成されます 💬</p>`;
    return;
  }
  reviewCards.innerHTML = cards.map((c, i) => `
    <div class="review-card">
      <div class="review-card-expression">${escapeHtml(c.expression)}</div>
      <div class="review-card-japanese">${escapeHtml(c.japanese)}</div>
      <div class="review-card-hint">💡 ${escapeHtml(c.hint)}</div>
      <div class="review-card-example">"${escapeHtml(c.example)}"</div>
      <button class="review-card-challenge" onclick="saveChallenge(${i})" data-idx="${i}">
        🎯 次回チャレンジ
      </button>
    </div>
  `).join("");
  // カードデータを保持
  reviewModal._cards = cards;
}

function saveChallenge(idx) {
  const cards = reviewModal._cards || [];
  const card  = cards[idx];
  if (!card) return;
  localStorage.setItem("challenge_expression", JSON.stringify(card));
  const btn = reviewCards.querySelector(`[data-idx="${idx}"]`);
  if (btn) { btn.textContent = "✅ 保存しました！"; btn.disabled = true; }
}

function closeReview() {
  reviewModal.classList.add("hidden");
  modalOverlay.classList.add("hidden");
  saveCurrentSession();
  newConversation();
}

function showStreakCard(streak) {
  const PRAISE = {
    1:  "🎉 今日からスタート！最初の一歩が一番大事です！",
    2:  "✨ 2日連続！いい調子です！",
    3:  "🔥 3日連続！習慣になってきた！",
    5:  "🌟 5日連続！すごい！続けていますね！",
    7:  "🏆 1週間連続達成！本当にすごい！",
    10: "💎 10日連続！もう立派な習慣です！",
    14: "🚀 2週間連続！英語力が確実に伸びています！",
    30: "👑 30日連続！あなたはTalkBobaマスターです！",
  };
  const msg = PRAISE[streak] || (streak % 10 === 0
    ? `🎊 ${streak}日連続達成！素晴らしい継続力！`
    : null);
  if (!msg) return;

  document.getElementById("streak-card")?.remove();
  const el = document.createElement("div");
  el.id = "streak-card";
  el.className = "streak-card";
  el.innerHTML = `<span class="streak-card-fire">🔥 ${streak}日連続</span><span class="streak-card-msg">${msg.slice(2)}</span><button class="streak-card-close" onclick="this.parentElement.remove()">✕</button>`;
  messagesEl.appendChild(el);
  scrollToBottom();
  setTimeout(() => el.remove(), 5000);
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
  setBobaMood("think", { revertAfter: 0 });
  const el = document.createElement("div");
  el.className = "message ai";
  const c = currentCharacterInfo();
  el.innerHTML = `<div class="message-label">${c.emoji} ${c.name}</div>
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

// ===== Speech Recognition (Whisper via Groq) =====
function setupSpeechRecognition() {
  if (!navigator.mediaDevices?.getUserMedia) {
    micBtn.style.opacity = "0.4";
    micBtn.title = "このブラウザは音声入力に対応していません";
    micBtn.disabled = true;
  }
}

function stopRecording() {
  if (!isRecording) return;
  isRecording = false;
  if (mediaRecorder && mediaRecorder.state !== "inactive") {
    mediaRecorder.stop(); // onstop → transcribeAudio()
  }
}

async function transcribeAudio() {
  if (audioChunks.length === 0) {
    setRecordingUI(false);
    return;
  }

  // 認識中 UI
  micBtn.classList.remove("recording");
  micBtn.textContent = "⏳";
  micBtn.disabled = true;
  voiceStatus.innerHTML = "⏳ 音声を認識中…";
  voiceStatus.classList.remove("hidden");
  speechPreview.classList.add("hidden");

  const mimeType = mediaRecorder.mimeType || "audio/webm";
  const blob = new Blob(audioChunks, { type: mimeType });
  const ext = mimeType.includes("ogg") ? "ogg" : mimeType.includes("mp4") ? "mp4" : "webm";

  const formData = new FormData();
  formData.append("audio", blob, `recording.${ext}`);
  if (currentNickname) formData.append("nickname", currentNickname);

  try {
    const res = await fetch("/api/transcribe", { method: "POST", body: formData });
    const data = await res.json();
    if (data.text) {
      textInput.value = data.text;
      autoResizeInput();
      textInput.focus();
      if (data.score) {
        showPronunciationScore(data.score);
      }
    } else {
      addErrorMessage("音声を認識できませんでした。もう一度お試しください。");
    }
  } catch (_) {
    addErrorMessage("音声認識に失敗しました。");
  } finally {
    micBtn.textContent = "🎙️";
    micBtn.disabled = false;
    micBtn.classList.remove("recording");
    voiceStatus.classList.add("hidden");
  }
}

// ── Hint ──────────────────────────────────────────────────────────────────────
const hintBtn   = document.getElementById("hint-btn");
const hintChips = document.getElementById("hint-chips");

hintBtn.addEventListener("click", async () => {
  // トグル: 表示中なら閉じる
  if (!hintChips.classList.contains("hidden")) {
    hintChips.classList.add("hidden");
    return;
  }

  hintBtn.textContent = "⏳";
  hintBtn.disabled = true;
  try {
    const res = await fetch("/api/hint", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: conversationHistory,
        theme: currentTheme,
        difficulty: currentDifficulty,
        nickname: currentNickname,
      }),
    });
    const data = await res.json();
    if (data.hints && data.hints.length > 0) {
      hintChips.innerHTML = data.hints
        .map(h => `<button class="hint-chip" onclick="applyHint(this)">${h}</button>`)
        .join("");
      hintChips.classList.remove("hidden");
    }
  } catch (_) {
    // silent fail
  } finally {
    hintBtn.textContent = "💡";
    hintBtn.disabled = false;
  }
});

function applyHint(el) {
  textInput.value = el.textContent;
  autoResizeInput();
  hintChips.classList.add("hidden");
  textInput.focus();
}

function showPronunciationScore(score) {
  // Remove existing score badge
  const existing = document.getElementById("pronunciation-score");
  if (existing) existing.remove();

  const badge = document.createElement("div");
  badge.id = "pronunciation-score";
  badge.className = "pronunciation-score";
  badge.innerHTML = `
    <span class="pron-label">聞き取り</span>
    <span class="pron-grade" style="color:${score.color}">${score.grade}</span>
    <span class="pron-message">${score.message}</span>
    <button class="pron-retry" onclick="retryPronunciation()" title="もう一度録音">🎙️ もう一度</button>
  `;
  // Insert below input-row
  const inputArea = document.getElementById("input-area");
  inputArea.appendChild(badge);

  // Auto-remove after 8s
  setTimeout(() => { if (badge.parentNode) badge.remove(); }, 8000);
}

function retryPronunciation() {
  const badge = document.getElementById("pronunciation-score");
  if (badge) badge.remove();
  textInput.value = "";
  autoResizeInput();
  // Trigger mic
  micBtn.click();
}

function setRecordingUI(active) {
  if (active) {
    micBtn.classList.add("recording");
    micBtn.textContent = "🔴";
    voiceStatus.innerHTML = '<span class="recording-dot"></span> 録音中… もう一度押すと認識';
    voiceStatus.classList.remove("hidden");
    speechPreview.classList.add("hidden");
  } else {
    micBtn.classList.remove("recording");
    micBtn.textContent = "🎙️";
    micBtn.disabled = false;
    voiceStatus.classList.add("hidden");
    speechPreview.classList.add("hidden");
  }
}

async function toggleRecording() {
  _unlockAudioCtx();
  if (isRecording) {
    stopRecording();
  } else {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioChunks = [];

      const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : MediaRecorder.isTypeSupported("audio/webm") ? "audio/webm" : "";
      mediaRecorder = new MediaRecorder(stream, mimeType ? { mimeType } : {});

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunks.push(e.data);
      };
      mediaRecorder.onstop = () => {
        stream.getTracks().forEach(t => t.stop()); // マイクを解放
        transcribeAudio();
      };

      mediaRecorder.start();
      isRecording = true;
      textInput.value = "";
      autoResizeInput();
      setRecordingUI(true);
    } catch (_) {
      addErrorMessage("マイクへのアクセスが許可されていません。");
    }
  }
}

// ===== TTS =====
// 優先順位はボバちゃんの「やわらかい・親しみやすい・自然」を基準にした選定。
// 上ほどデフォルトとして選ばれやすい。
const VOICE_LABELS = [
  // 第一候補：mac の高品質エンハンス女性ボイス（やわらかい）
  { match: /Samantha \(Enhanced\)/i,        label: "🫧 Boba (Samantha)" },
  { match: /^Samantha$/i,                   label: "🫧 Boba (Samantha)" },
  { match: /Nicky \(Enhanced\)/i,           label: "🫧 Boba (Nicky)" },
  { match: /^Nicky$/i,                      label: "🫧 Boba (Nicky)" },
  // Microsoft の最新ニューラルボイス（Windows）
  { match: /Microsoft Aria.*Natural/i,      label: "🫧 Boba (Aria)" },
  { match: /Microsoft Jenny.*Natural/i,     label: "🫧 Boba (Jenny)" },
  { match: /Microsoft Aria/i,               label: "Aria（女性・アメリカ）" },
  { match: /Microsoft Jenny/i,              label: "Jenny（女性・アメリカ）" },
  // Google の標準ボイス
  { match: /Google US English$/i,           label: "Emma（女性・アメリカ）" },
  { match: /Google UK English Female/i,     label: "Olivia（女性・イギリス）" },
  // 男性 / その他選択肢
  { match: /Karen \(Enhanced\)/i,           label: "Karen Enhanced（女性・オーストラリア）" },
  { match: /^Karen$/i,                      label: "Karen（女性・オーストラリア）" },
  { match: /Moira \(Enhanced\)/i,           label: "Moira Enhanced（女性・アイルランド）" },
  { match: /^Moira$/i,                      label: "Moira（女性・アイルランド）" },
  { match: /^Tessa$/i,                      label: "Tessa（女性・南アフリカ）" },
  { match: /Microsoft Sonia.*Natural/i,     label: "Sonia（女性・イギリス）" },
  { match: /Google UK English Male/i,       label: "James（男性・イギリス）" },
  { match: /Microsoft Guy.*Natural/i,       label: "Guy（男性・アメリカ）" },
  { match: /Microsoft Ryan.*Natural/i,      label: "Ryan（男性・イギリス）" },
  { match: /Daniel \(Enhanced\)/i,          label: "Daniel Enhanced（男性・イギリス）" },
  { match: /^Daniel$/i,                     label: "Daniel（男性・イギリス）" },
];

function pickCuratedVoices() {
  const all = window.speechSynthesis.getVoices();
  const result = [];
  for (const { match, label } of VOICE_LABELS) {
    const found = all.find(v => match.test(v.name));
    if (found && !result.find(r => r.voice.name === found.name)) {
      result.push({ voice: found, label });
    }
  }
  if (!result.length) {
    all.filter(v => /^en/i.test(v.lang)).forEach(v => {
      result.push({ voice: v, label: v.name });
    });
  }
  return result;
}

function loadBestVoice() {
  const populate = () => {
    const curated = pickCuratedVoices();
    if (!curated.length) return;
    voiceSelect.innerHTML = "";
    curated.forEach(({ voice, label }, i) => {
      const opt = document.createElement("option");
      opt.value = i;
      opt.textContent = label;
      voiceSelect.appendChild(opt);
    });
    const saved = localStorage.getItem("tts-voice");
    const savedIdx = curated.findIndex(c => c.voice.name === saved);
    const idx = savedIdx >= 0 ? savedIdx : 0;
    voiceSelect.value = idx;
    ttsVoice = curated[idx].voice;
  };
  populate();
  window.speechSynthesis.onvoiceschanged = populate;

  voiceSelect.addEventListener("change", () => {
    const curated = pickCuratedVoices();
    ttsVoice = curated[parseInt(voiceSelect.value)].voice;
    localStorage.setItem("tts-voice", ttsVoice.name);
    speak("Hello! This is a preview of my voice.");
  });
}

function _unlockAudioCtx() {
  if (!_audioCtx) {
    _audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  if (_audioCtx.state === "suspended") {
    _audioCtx.resume();
  }
}

// === TTS playback ===
// 優先: Google Chirp 3 HD (サーバー /api/tts 経由、AudioContext で再生)
// フォールバック: ブラウザ Web Speech API
let _currentSource = null;

function _stopAllSpeech() {
  try { window.speechSynthesis.cancel(); } catch(_) {}
  if (_currentSource) {
    try { _currentSource.stop(); } catch(_) {}
    _currentSource = null;
  }
}

function _speakBrowserTTS(text) {
  const char = document.getElementById("ai-character");
  window.speechSynthesis.cancel();
  setTimeout(() => {
    const u = new SpeechSynthesisUtterance(text);
    if (ttsVoice) u.voice = ttsVoice;
    u.lang = "en-US";
    u.rate = 0.92;
    u.pitch = 1.08;
    u.onstart = () => char && char.classList.add("talking");
    u.onend   = () => char && char.classList.remove("talking");
    u.onerror = () => char && char.classList.remove("talking");
    window.speechSynthesis.speak(u);
  }, 50);
}

async function _speakChirp3(text, characterId) {
  const char = document.getElementById("ai-character");
  _stopAllSpeech();
  // AudioContext がまだ無ければ作成（_unlockAudioCtxはユーザー操作中に呼ばれてる想定）
  _unlockAudioCtx();
  try {
    const res = await fetch("/api/tts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, character: characterId || "milk" }),
    });
    if (!res.ok) throw new Error("tts fetch failed: " + res.status);
    const arrayBuf = await res.arrayBuffer();
    // AudioContext で decode → BufferSource で再生（自動再生制限を回避）
    const audioBuf = await _audioCtx.decodeAudioData(arrayBuf);
    const src = _audioCtx.createBufferSource();
    src.buffer = audioBuf;
    src.connect(_audioCtx.destination);
    _currentSource = src;
    if (char) char.classList.add("talking");
    src.onended = () => {
      if (char) char.classList.remove("talking");
      if (_currentSource === src) _currentSource = null;
    };
    src.start(0);
    return true;
  } catch (e) {
    console.warn("[TTS] Chirp 3 失敗→ブラウザTTSにフォールバック:", e);
    return false;
  }
}

function speak(text) {
  if (!text) return;
  const characterId = window._currentCharacter || "milk";
  _speakChirp3(text, characterId).then(ok => {
    if (!ok) _speakBrowserTTS(text);
  });
}

// 履歴ボタンが押されたらドロワーを閉じてからモーダル表示
historyBtn?.addEventListener("click", closeDrawer);

// ===== Dev: plan switcher =====
function setupDevPlanSwitcher() {
  const wrap = document.getElementById("dev-plan-switcher");
  if (!wrap) return;
  // 現在のプランをハイライト
  const highlight = (plan) => {
    wrap.querySelectorAll(".dev-plan-btn").forEach(b => {
      b.classList.toggle("active", b.dataset.plan === plan);
    });
  };
  highlight(_userPlan);
  wrap.querySelectorAll(".dev-plan-btn").forEach(btn => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const plan = btn.dataset.plan;
      btn.textContent = "切替中…";
      try {
        const res = await fetch("/api/dev/switch-plan", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ plan }),
        });
        const data = await res.json();
        if (!data.ok) throw new Error(data.error || "failed");
        _userPlan = data.plan;
        highlight(data.plan);
        // キャラリスト再取得（ロック状態更新）
        await loadCharacters();
        // バッジ再表示
        await checkAuth();
      } catch (e) {
        alert("切替失敗: " + e.message);
      } finally {
        btn.textContent = {free:"無料", light:"スタンダード", premium:"プレミアム"}[plan];
      }
    });
  });
}
// init() のあと（loadCharactersの後）にも setup する必要があるので、loadCharactersから呼ぶ
const _origLoadCharacters = loadCharacters;
loadCharacters = async function() {
  await _origLoadCharacters();
  setupDevPlanSwitcher();
};

// ===== Feedback =====
let _feedbackRating = 0;

function openFeedback() {
  _feedbackRating = 0;
  document.querySelectorAll(".fstar").forEach(s => s.classList.remove("selected", "hover"));
  document.getElementById("feedback-comment").value = "";
  document.getElementById("modal-overlay").classList.remove("hidden");
  document.getElementById("feedback-modal").classList.remove("hidden");
}

function closeFeedback() {
  document.getElementById("modal-overlay").classList.add("hidden");
  document.getElementById("feedback-modal").classList.add("hidden");
}

function submitFeedback() {
  if (!_feedbackRating) { closeFeedback(); return; }
  const comment = document.getElementById("feedback-comment").value.trim();
  fetch("/api/feedback", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ rating: _feedbackRating, comment }),
  });
  closeFeedback();
}

// 10回会話ごとにフィードバックを促す
function checkFeedbackPrompt() {
  const count = parseInt(localStorage.getItem("conv_count") || "0") + 1;
  localStorage.setItem("conv_count", count);
  if (count % 10 === 0) setTimeout(openFeedback, 2000);
}

document.addEventListener("DOMContentLoaded", () => {
  document.querySelectorAll(".fstar").forEach(star => {
    star.addEventListener("click", () => {
      _feedbackRating = parseInt(star.dataset.v);
      document.querySelectorAll(".fstar").forEach(s => {
        s.classList.toggle("selected", parseInt(s.dataset.v) <= _feedbackRating);
      });
    });
    star.addEventListener("mouseenter", () => {
      const v = parseInt(star.dataset.v);
      document.querySelectorAll(".fstar").forEach(s => {
        s.classList.toggle("hover", parseInt(s.dataset.v) <= v);
      });
    });
    star.addEventListener("mouseleave", () => {
      document.querySelectorAll(".fstar").forEach(s => s.classList.remove("hover"));
    });
  });
});

// ===== Onboarding =====
let _obDiff = "intermediate";

function showOnboarding() {
  document.getElementById("onboarding-overlay").classList.remove("hidden");
}

function obNext(step) {
  // Save nickname from step 2 if filled
  if (step === 3) {
    const name = document.getElementById("ob-nickname").value.trim();
    if (name) {
      currentNickname = name;
      nicknameInput.value = name;
    }
  }
  document.querySelectorAll(".ob-step").forEach(el => el.classList.add("hidden"));
  document.getElementById(`ob-step-${step}`).classList.remove("hidden");
  document.querySelectorAll(".ob-dot").forEach(el => el.classList.remove("ob-dot-active"));
  document.getElementById(`ob-dot-${step}`).classList.add("ob-dot-active");
}

function obSelectDiff(btn) {
  document.querySelectorAll(".ob-diff-btn").forEach(b => b.classList.remove("ob-diff-active"));
  btn.classList.add("ob-diff-active");
  _obDiff = btn.dataset.level;
}

function obFinish() {
  // Apply selections
  const theme = document.getElementById("ob-theme").value;
  currentTheme = theme;
  currentDifficulty = _obDiff;
  themeSelect.value = theme;
  document.querySelectorAll(".diff-btn").forEach(b => {
    b.classList.toggle("active", b.dataset.level === _obDiff);
  });
  saveSettings();
  localStorage.setItem("onboarding_done", "1");
  document.getElementById("onboarding-overlay").classList.add("hidden");
  newConversation();
}

function checkOnboarding() {
  if (!localStorage.getItem("onboarding_done")) {
    showOnboarding();
  }
}

// ===== Start =====
init();

// ===== Service Worker =====
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/public/sw.js").catch(() => {});
}
