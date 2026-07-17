"use strict";

const LANGUAGES = {
  italian: { flag: "🇮🇹", name: "Italiano", sceneLabel: "La scena" },
  spanish: { flag: "🇪🇸", name: "Español", sceneLabel: "La escena" },
};

const TOPICS = [
  { id: "Travel", emoji: "✈️", en: "Travel", italian: "Viaggi", spanish: "Viajes" },
  { id: "Food & Cooking", emoji: "🍝", en: "Food & Cooking", italian: "Cucina", spanish: "Cocina" },
  { id: "Daily Life", emoji: "☕", en: "Daily Life", italian: "Vita quotidiana", spanish: "Vida diaria" },
  { id: "Work & Career", emoji: "💼", en: "Work & Career", italian: "Lavoro", spanish: "Trabajo" },
  { id: "Hobbies", emoji: "🎨", en: "Hobbies", italian: "Hobby", spanish: "Aficiones" },
  { id: "Movies & Music", emoji: "🎬", en: "Movies & Music", italian: "Film e musica", spanish: "Cine y música" },
  { id: "Family & Friends", emoji: "👨‍👩‍👧", en: "Family & Friends", italian: "Famiglia e amici", spanish: "Familia y amigos" },
  { id: "Sports", emoji: "⚽", en: "Sports", italian: "Sport", spanish: "Deportes" },
];

const state = {
  language: null,
  mode: null,
  topic: null,
  messages: [],
  transcript: [],
  busy: false,
  session: 0,
};

/* ---------- Session persistence ---------- */

const SESSION_KEY = "chiacchiera.session";

function saveSession() {
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify({
      language: state.language,
      mode: state.mode,
      topic: state.topic,
      transcript: state.transcript,
    }));
  } catch (_) {
    /* localStorage unavailable (private mode, quota) — chat still works */
  }
}

function clearSession() {
  try {
    localStorage.removeItem(SESSION_KEY);
  } catch (_) {
    /* ignore */
  }
}

function loadSession() {
  let raw = null;
  try {
    raw = localStorage.getItem(SESSION_KEY);
  } catch (_) {
    return null;
  }
  if (!raw) return null;

  let saved = null;
  try {
    saved = JSON.parse(raw);
  } catch (_) {
    clearSession();
    return null;
  }

  const valid = saved
    && typeof saved === "object"
    && Object.prototype.hasOwnProperty.call(LANGUAGES, saved.language)
    // sessions saved before modes existed have no mode — treated as "chat"
    && (saved.mode === undefined || saved.mode === "chat" || saved.mode === "roleplay")
    && TOPICS.some((t) => t.id === saved.topic)
    && Array.isArray(saved.transcript)
    && saved.transcript.every((entry) => entry
      && typeof entry === "object"
      && (entry.role === "user" || entry.role === "assistant")
      && typeof entry.content === "string");

  if (!valid) {
    clearSession();
    return null;
  }
  return saved;
}

const startScreen = document.getElementById("start-screen");
const chatScreen = document.getElementById("chat-screen");
const topicGrid = document.getElementById("topic-grid");
const newChatButton = document.getElementById("new-chat-button");
const chatFlag = document.getElementById("chat-flag");
const chatTopic = document.getElementById("chat-topic");
const chatMode = document.getElementById("chat-mode");
const chatLog = document.getElementById("chat-log");
const chatForm = document.getElementById("chat-form");
const chatInput = document.getElementById("chat-input");
const sendButton = document.getElementById("send-button");
const errorNotice = document.getElementById("error-notice");
const errorText = document.getElementById("error-text");
const errorDismiss = document.getElementById("error-dismiss");

const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

/* ---------- Start screen ---------- */

function topicLabel(topic) {
  if (state.language && topic[state.language]) return topic[state.language];
  return topic.en;
}

function buildTopicGrid() {
  TOPICS.forEach((topic) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "topic-card";
    button.dataset.topic = topic.id;
    button.setAttribute("aria-pressed", "false");

    const emoji = document.createElement("span");
    emoji.className = "topic-emoji";
    emoji.setAttribute("aria-hidden", "true");
    emoji.textContent = topic.emoji;

    const label = document.createElement("span");
    label.className = "topic-label";
    label.textContent = topic.en;

    button.append(emoji, label);
    button.addEventListener("click", () => {
      state.topic = topic.id;
      updateStartScreen();
      maybeStartConversation();
    });
    topicGrid.appendChild(button);
  });
}

function updateStartScreen() {
  document.querySelectorAll(".language-card").forEach((card) => {
    card.setAttribute("aria-pressed", String(card.dataset.language === state.language));
  });
  document.querySelectorAll(".mode-card").forEach((card) => {
    card.setAttribute("aria-pressed", String(card.dataset.mode === state.mode));
  });
  document.querySelectorAll(".topic-card").forEach((card) => {
    const topic = TOPICS.find((t) => t.id === card.dataset.topic);
    card.querySelector(".topic-label").textContent = topicLabel(topic);
    card.setAttribute("aria-pressed", String(topic.id === state.topic));
  });
}

function maybeStartConversation() {
  if (state.language && state.mode && state.topic) showChatScreen();
}

document.querySelectorAll(".language-card").forEach((card) => {
  card.addEventListener("click", () => {
    state.language = card.dataset.language;
    updateStartScreen();
    maybeStartConversation();
  });
});

document.querySelectorAll(".mode-card").forEach((card) => {
  card.addEventListener("click", () => {
    state.mode = card.dataset.mode;
    updateStartScreen();
    maybeStartConversation();
  });
});

/* ---------- Chat rendering ---------- */

function isNearBottom() {
  return chatLog.scrollHeight - chatLog.scrollTop - chatLog.clientHeight < 120;
}

/**
 * Follows new content only when the reader is already at (or near) the bottom,
 * so a streamed reply never drags them away from an earlier message they
 * scrolled up to re-read. Pass force=true to jump regardless (own message,
 * session restore).
 */
function scrollToBottom(force = false) {
  if (!force && !isNearBottom()) return;
  chatLog.scrollTo({
    top: chatLog.scrollHeight,
    behavior: prefersReducedMotion.matches ? "auto" : "smooth",
  });
}

function appendBubble(role, text) {
  const bubble = document.createElement("div");
  bubble.className = "bubble bubble-" + (role === "user" ? "user" : "assistant");

  const body = document.createElement("p");
  body.className = "bubble-text";
  body.style.margin = "0";
  body.textContent = text;

  bubble.appendChild(body);
  chatLog.appendChild(bubble);
  scrollToBottom(role === "user");
  return bubble;
}

/**
 * Splits a leading parenthetical scene-setting sentence off an assistant
 * message: "(Sei in un bar...) Buongiorno!" → { scene, rest }. Returns null
 * when the message doesn't open with one, so callers fall back to a plain
 * bubble and nothing is ever lost.
 */
function splitScene(text) {
  const match = /^\s*\(([^)]+)\)\s*/.exec(text);
  if (!match || !match[1].trim()) return null;
  return { scene: match[1].trim(), rest: text.slice(match[0].length) };
}

function appendSceneCard(scene, beforeNode = null) {
  const card = document.createElement("div");
  card.className = "scene-card";
  card.setAttribute("role", "note");

  const label = document.createElement("span");
  label.className = "scene-label";
  label.textContent = LANGUAGES[state.language].sceneLabel;

  const body = document.createElement("p");
  body.className = "scene-text";
  body.style.margin = "0";
  const pin = document.createElement("span");
  pin.className = "scene-pin";
  pin.setAttribute("aria-hidden", "true");
  pin.textContent = "📍";
  body.append(pin, document.createTextNode(scene));

  card.append(label, body);
  chatLog.insertBefore(card, beforeNode);
  scrollToBottom();
  return card;
}

function normalizeToken(token) {
  return token.toLocaleLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
}

function renderCorrectionText(el, original, correction) {
  const parts = correction.split(/(\s+)/);
  const corrTokens = parts.filter((p) => p !== "" && !/^\s+$/.test(p));
  const a = original.split(/\s+/).filter(Boolean).map(normalizeToken);
  const b = corrTokens.map(normalizeToken);
  const m = a.length;
  const n = b.length;

  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i -= 1) {
    for (let j = n - 1; j >= 0; j -= 1) {
      dp[i][j] = a[i] !== "" && a[i] === b[j]
        ? dp[i + 1][j + 1] + 1
        : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  const matched = new Array(n).fill(false);
  let i = 0;
  let j = 0;
  while (i < m && j < n) {
    if (a[i] !== "" && a[i] === b[j]) {
      matched[j] = true;
      i += 1;
      j += 1;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      i += 1;
    } else {
      j += 1;
    }
  }

  const matchCount = matched.filter(Boolean).length;
  const skip = n === 0 || matchCount / n < 0.3;

  let tokenIndex = 0;
  parts.forEach((part) => {
    if (part === "") return;
    if (/^\s+$/.test(part)) {
      el.appendChild(document.createTextNode(part));
      return;
    }
    const idx = tokenIndex;
    tokenIndex += 1;
    if (skip || matched[idx] || b[idx] === "") {
      el.appendChild(document.createTextNode(part));
    } else {
      const span = document.createElement("span");
      span.className = "diff";
      span.textContent = part;
      el.appendChild(span);
    }
  });
}

function appendCorrection(bubble, original, correction, note) {
  const block = document.createElement("div");
  block.className = "correction";

  const label = document.createElement("span");
  label.className = "correction-label";
  label.textContent = "More natural";
  block.appendChild(label);

  const text = document.createElement("p");
  text.className = "correction-text";
  text.style.margin = "0";
  renderCorrectionText(text, original, correction);
  block.appendChild(text);

  if (note) {
    const noteEl = document.createElement("p");
    noteEl.className = "correction-note";
    noteEl.style.margin = "0.2rem 0 0";
    noteEl.textContent = note;
    block.appendChild(noteEl);
  }

  bubble.appendChild(block);
}

function showTypingIndicator() {
  const bubble = document.createElement("div");
  bubble.className = "bubble bubble-assistant";
  bubble.setAttribute("aria-label", "Assistant is typing");

  const dots = document.createElement("span");
  dots.className = "typing";
  for (let i = 0; i < 3; i += 1) {
    const dot = document.createElement("span");
    dot.className = "typing-dot";
    dots.appendChild(dot);
  }
  bubble.appendChild(dots);
  chatLog.appendChild(bubble);
  scrollToBottom();
  return bubble;
}

/* ---------- Errors ---------- */

function showError(message) {
  errorText.textContent = message;
  errorNotice.hidden = false;
}

function hideError() {
  errorNotice.hidden = true;
  errorText.textContent = "";
}

errorDismiss.addEventListener("click", hideError);

/* ---------- API ---------- */

/**
 * POSTs to /api/chat and reads the streamed NDJSON response.
 * `onDelta(text)` is called for each incremental reply chunk; if it returns
 * false (stale session), reading is aborted via reader.cancel() and null is
 * returned. Resolves with the final `done` payload {reply, correction,
 * correctionNote}. Non-OK or plain-JSON responses keep today's error path.
 */
async function requestReply(onDelta) {
  const response = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      language: state.language,
      mode: state.mode,
      topic: state.topic,
      messages: state.messages,
    }),
  });

  const contentType = response.headers.get("content-type") || "";
  if (!response.ok || contentType.includes("application/json")) {
    let data = null;
    try {
      data = await response.json();
    } catch (_) {
      data = null;
    }
    if (!response.ok) {
      const message = data && data.error ? data.error : "Could not reach the server.";
      throw new Error(message);
    }
    return data;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let done = null;

  const handleLine = (line) => {
    const trimmed = line.trim();
    if (!trimmed) return true;
    let event = null;
    try {
      event = JSON.parse(trimmed);
    } catch (_) {
      return true;
    }
    if (event.type === "delta") {
      if (typeof event.text === "string" && onDelta(event.text) === false) {
        return false; // stale session — stop reading
      }
    } else if (event.type === "done") {
      done = event;
    } else if (event.type === "error") {
      throw new Error(event.error || "The language model request failed. Check the server logs.");
    }
    return true;
  };

  try {
    for (;;) {
      const { value, done: readerDone } = await reader.read();
      buffer += readerDone ? decoder.decode() : decoder.decode(value, { stream: true });
      let newlineIndex;
      while ((newlineIndex = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, newlineIndex);
        buffer = buffer.slice(newlineIndex + 1);
        if (!handleLine(line)) return null; // stale — abort via cancel in finally
      }
      if (readerDone) {
        if (buffer && !handleLine(buffer)) return null; // partial trailing line
        break;
      }
      if (done) break;
    }
  } finally {
    try {
      await reader.cancel();
    } catch (_) {
      /* ignore */
    }
  }

  if (!done) {
    throw new Error("Could not reach the server.");
  }
  return done;
}

function setBusy(busy) {
  state.busy = busy;
  chatInput.disabled = busy;
  sendButton.disabled = busy;
}

/* ---------- Conversation flow ---------- */

function createStreamTarget(session, typing) {
  let bubble = null;
  let textEl = null;
  let buffer = ""; // received-but-not-yet-emitted tail (may hold a partial word)
  let sceneEl = null;
  // Replies may open with a parenthetical scene line (roleplay). Hold the
  // stream until the opening "(" resolves either way, then render the scene
  // as a card above the bubble instead of inside it.
  let scenePending = true;

  // Emit whole words from `buffer` as fade-in spans; keep the trailing partial
  // word buffered until its whitespace boundary arrives (or the stream ends).
  const emit = (final) => {
    let cut = buffer.length;
    if (!final) {
      // hold everything after the last whitespace — it may be an unfinished word
      cut = 0;
      for (let i = buffer.length - 1; i >= 0; i--) {
        if (/\s/.test(buffer[i])) {
          cut = i + 1;
          break;
        }
      }
    }
    const ready = buffer.slice(0, cut);
    buffer = buffer.slice(cut);
    for (const part of ready.match(/\s+|\S+/g) || []) {
      if (/^\s/.test(part)) {
        textEl.appendChild(document.createTextNode(part));
      } else {
        const span = document.createElement("span");
        span.className = "word";
        span.textContent = part;
        textEl.appendChild(span);
      }
    }
  };

  return {
    onDelta(text) {
      if (session !== state.session) return false; // stale — abort the stream
      buffer += text;
      if (scenePending) {
        const head = buffer.replace(/^\s+/, "");
        if (head === "") return true;
        if (head[0] === "(") {
          const close = head.indexOf(")");
          if (close === -1) return true; // scene line still streaming — keep holding
          const scene = head.slice(1, close).trim();
          if (scene) sceneEl = appendSceneCard(scene, typing);
          buffer = head.slice(close + 1).replace(/^\s+/, "");
        }
        scenePending = false;
      }
      if (!bubble) {
        if (buffer.trim() === "") return true; // nothing after the scene yet
        typing.remove();
        bubble = appendBubble("assistant", "");
        textEl = bubble.querySelector(".bubble-text");
      }
      emit(false);
      scrollToBottom();
      return true;
    },
    finish(reply) {
      const split = splitScene(reply);
      const body = split ? split.rest : reply;
      if (!bubble) {
        // never streamed (plain-JSON path) or the whole reply was still held;
        // typing is already detached here, so append at the end of the log
        if (split && !sceneEl) sceneEl = appendSceneCard(split.scene);
        if (body.trim() !== "") bubble = appendBubble("assistant", body);
        return;
      }
      emit(true); // flush the last word
      // Safety net: if the streamed words drifted from the authoritative reply,
      // fall back to the plain text (rare; loses the animation but stays correct).
      if (textEl.textContent !== body) {
        textEl.textContent = body;
      }
    },
    removePartial() {
      if (bubble) bubble.remove();
      if (sceneEl) sceneEl.remove();
    },
  };
}

async function openConversation() {
  const session = state.session;
  setBusy(true);
  const typing = showTypingIndicator();
  const target = createStreamTarget(session, typing);
  try {
    const data = await requestReply(target.onDelta);
    if (session !== state.session || data === null) return;
    typing.remove();
    target.finish(data.reply);
    state.messages.push({ role: "assistant", content: data.reply });
    state.transcript.push({ role: "assistant", content: data.reply });
    saveSession();
    scrollToBottom();
  } catch (err) {
    if (session !== state.session) return;
    typing.remove();
    target.removePartial();
    showError(err instanceof TypeError ? "Could not reach the server." : err.message);
  } finally {
    if (session === state.session) {
      setBusy(false);
      chatInput.focus();
    }
  }
}

async function sendMessage(text) {
  const session = state.session;
  hideError();
  const userBubble = appendBubble("user", text);
  state.messages.push({ role: "user", content: text });
  chatInput.value = "";
  autogrow();
  setBusy(true);
  const typing = showTypingIndicator();

  const target = createStreamTarget(session, typing);
  try {
    const data = await requestReply(target.onDelta);
    if (session !== state.session || data === null) return;
    typing.remove();
    if (data.correction) {
      appendCorrection(userBubble, text, data.correction, data.correctionNote);
    }
    target.finish(data.reply);
    state.messages.push({ role: "assistant", content: data.reply });
    state.transcript.push({
      role: "user",
      content: text,
      correction: data.correction || null,
      correctionNote: data.correctionNote || null,
    });
    state.transcript.push({ role: "assistant", content: data.reply });
    saveSession();
    scrollToBottom();
  } catch (err) {
    if (session !== state.session) return;
    typing.remove();
    target.removePartial();
    userBubble.remove();
    state.messages.pop();
    chatInput.value = text;
    autogrow();
    showError(err instanceof TypeError ? "Could not reach the server." : err.message);
  } finally {
    if (session === state.session) {
      setBusy(false);
      chatInput.focus();
    }
  }
}

/* ---------- Screen switching ---------- */

function showChatScreen() {
  state.session += 1;
  const language = LANGUAGES[state.language];
  const topic = TOPICS.find((t) => t.id === state.topic);
  chatFlag.textContent = language.flag;
  chatTopic.textContent = topicLabel(topic);
  chatMode.hidden = state.mode !== "roleplay";
  startScreen.hidden = true;
  chatScreen.hidden = false;
  state.messages = [];
  state.transcript = [];
  chatLog.replaceChildren();
  hideError();
  openConversation();
}

function showStartScreen() {
  clearSession();
  state.session += 1;
  state.language = null;
  state.mode = null;
  state.topic = null;
  state.messages = [];
  state.transcript = [];
  state.busy = false;
  chatLog.replaceChildren();
  chatInput.value = "";
  autogrow();
  hideError();
  setBusy(false);
  chatScreen.hidden = true;
  startScreen.hidden = false;
  updateStartScreen();
}

newChatButton.addEventListener("click", showStartScreen);

/* ---------- Input bar ---------- */

function autogrow() {
  chatInput.style.height = "auto";
  const lineHeight = parseFloat(getComputedStyle(chatInput).lineHeight) || 22;
  const maxHeight = lineHeight * 4 + 22;
  chatInput.style.height = Math.min(chatInput.scrollHeight, maxHeight) + "px";
}

chatInput.addEventListener("input", autogrow);

chatInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    chatForm.requestSubmit();
  }
});

chatForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const text = chatInput.value.trim();
  if (!text || state.busy) return;
  sendMessage(text);
});

/* ---------- Init ---------- */

function restoreSession(saved) {
  state.session += 1;
  state.language = saved.language;
  state.mode = saved.mode === "roleplay" ? "roleplay" : "chat";
  state.topic = saved.topic;
  state.transcript = saved.transcript;
  state.messages = saved.transcript.map((entry) => ({
    role: entry.role,
    content: entry.content,
  }));

  const language = LANGUAGES[state.language];
  const topic = TOPICS.find((t) => t.id === state.topic);
  chatFlag.textContent = language.flag;
  chatTopic.textContent = topicLabel(topic);
  chatMode.hidden = state.mode !== "roleplay";

  chatLog.replaceChildren();
  saved.transcript.forEach((entry) => {
    const split = entry.role === "assistant" ? splitScene(entry.content) : null;
    if (split) {
      appendSceneCard(split.scene);
      if (split.rest.trim() !== "") appendBubble("assistant", split.rest);
      return;
    }
    const bubble = appendBubble(entry.role, entry.content);
    if (entry.role === "user" && entry.correction) {
      appendCorrection(bubble, entry.content, entry.correction, entry.correctionNote);
    }
  });

  hideError();
  setBusy(false);
  startScreen.hidden = true;
  chatScreen.hidden = false;
  scrollToBottom(true);
  chatInput.focus();
}

buildTopicGrid();
updateStartScreen();

{
  const saved = loadSession();
  if (saved) restoreSession(saved);
}
