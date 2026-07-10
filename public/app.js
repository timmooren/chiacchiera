"use strict";

const LANGUAGES = {
  italian: { flag: "🇮🇹", name: "Italiano", correctionLabel: "meglio così:" },
  spanish: { flag: "🇪🇸", name: "Español", correctionLabel: "mejor así:" },
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
  topic: null,
  messages: [],
  busy: false,
  session: 0,
};

const startScreen = document.getElementById("start-screen");
const chatScreen = document.getElementById("chat-screen");
const topicGrid = document.getElementById("topic-grid");
const startButton = document.getElementById("start-button");
const newChatButton = document.getElementById("new-chat-button");
const chatFlag = document.getElementById("chat-flag");
const chatTopic = document.getElementById("chat-topic");
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
    });
    topicGrid.appendChild(button);
  });
}

function updateStartScreen() {
  document.querySelectorAll(".language-card").forEach((card) => {
    card.setAttribute("aria-pressed", String(card.dataset.language === state.language));
  });
  document.querySelectorAll(".topic-card").forEach((card) => {
    const topic = TOPICS.find((t) => t.id === card.dataset.topic);
    card.querySelector(".topic-label").textContent = topicLabel(topic);
    card.setAttribute("aria-pressed", String(topic.id === state.topic));
  });
  startButton.disabled = !(state.language && state.topic);
}

document.querySelectorAll(".language-card").forEach((card) => {
  card.addEventListener("click", () => {
    state.language = card.dataset.language;
    updateStartScreen();
  });
});

/* ---------- Chat rendering ---------- */

function scrollToBottom() {
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
  scrollToBottom();
  return bubble;
}

function appendCorrection(bubble, correction, note) {
  const block = document.createElement("div");
  block.className = "correction";

  const label = document.createElement("span");
  label.className = "correction-label";
  label.textContent = LANGUAGES[state.language].correctionLabel;
  block.appendChild(label);

  const text = document.createElement("p");
  text.className = "correction-text";
  text.style.margin = "0";
  text.textContent = correction;
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

async function requestReply() {
  const response = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      language: state.language,
      topic: state.topic,
      messages: state.messages,
    }),
  });

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

function setBusy(busy) {
  state.busy = busy;
  chatInput.disabled = busy;
  sendButton.disabled = busy;
}

/* ---------- Conversation flow ---------- */

async function openConversation() {
  const session = state.session;
  setBusy(true);
  const typing = showTypingIndicator();
  try {
    const data = await requestReply();
    if (session !== state.session) return;
    typing.remove();
    appendBubble("assistant", data.reply);
    state.messages.push({ role: "assistant", content: data.reply });
  } catch (err) {
    if (session !== state.session) return;
    typing.remove();
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

  try {
    const data = await requestReply();
    if (session !== state.session) return;
    typing.remove();
    if (data.correction) {
      appendCorrection(userBubble, data.correction, data.correctionNote);
    }
    appendBubble("assistant", data.reply);
    state.messages.push({ role: "assistant", content: data.reply });
    scrollToBottom();
  } catch (err) {
    if (session !== state.session) return;
    typing.remove();
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
  startScreen.hidden = true;
  chatScreen.hidden = false;
  state.messages = [];
  chatLog.replaceChildren();
  hideError();
  openConversation();
}

function showStartScreen() {
  state.session += 1;
  state.language = null;
  state.topic = null;
  state.messages = [];
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

startButton.addEventListener("click", showChatScreen);
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

buildTopicGrid();
updateStartScreen();
