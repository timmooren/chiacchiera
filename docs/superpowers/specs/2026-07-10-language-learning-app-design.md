# Language Learning Chat App — Design

Date: 2026-07-10

## Purpose

Responsive web app for practicing Italian or Spanish by chatting with an LLM (Claude Sonnet). The assistant always replies in the target language, conversational style. Every user message gets a correction: the correct way to say it in the target language (also serves as translation when the user writes English). Start screen lets the user pick a language and a conversation topic.

## Architecture

Two units, one HTTP contract:

1. **Backend** — Node + Express (`server.js`). Serves the static frontend and proxies chat requests to the Anthropic API (`claude-sonnet-5`). API key from `.env` (`ANTHROPIC_API_KEY`), never sent to the browser.
2. **Frontend** — vanilla HTML/CSS/JS in `public/`. No build step. Two screens: start (language + topic selection) and chat. Conversation history kept client-side and sent with each request (stateless server).

## API Contract

`POST /api/chat`

Request body:
```json
{
  "language": "italian" | "spanish",
  "topic": "<topic id string>",
  "messages": [ { "role": "user" | "assistant", "content": "<text>" }, ... ]
}
```
`messages` is the full conversation so far, ending with the newest user message. Assistant entries contain only the reply text (not corrections). An **empty `messages` array** means "open the conversation": the server asks the model for a topic-appropriate greeting/question and returns it with `correction: null`.

Response `200`:
```json
{
  "reply": "<assistant response in target language>",
  "correction": "<correct target-language phrasing of the user's last message, or null if already correct>",
  "correctionNote": "<one short English note explaining the main fix, or null>"
}
```
Errors: `400` for invalid body, `500` with `{ "error": "<message>" }` for upstream failures (including missing API key).

## LLM Strategy

Single Anthropic API call per user message. System prompt instructs the model to:
- Reply ONLY in the target language, natural conversational register, 1–3 sentences, keep the conversation going (ask follow-up questions), stay roughly on the chosen topic, match the learner's apparent level.
- Also produce the correction of the user's latest message: if the user wrote English (or mixed), translate it to the target language; if they wrote the target language with mistakes, give the corrected version; if already correct, correction is null.

Structured output enforced via a forced tool call (`tool_choice`) with an input schema matching the response contract — no fragile JSON parsing from prose.

## Frontend Behavior

**Start screen:** app title, language picker (Italian / Spanish cards with flags), topic grid (8 topics: Travel, Food & Cooking, Daily Life, Work & Career, Hobbies, Movies & Music, Family & Friends, Sports), Start button enabled once both selected.

**Chat screen:**
- Header shows chosen language + topic, "New chat" button returns to start screen (clears history).
- Assistant opens the conversation with a topic-appropriate greeting/question in the target language (first API call fires on entry with an empty `messages` array; see API contract).
- User bubble: the user's text; when the response arrives, a correction block is appended inside the same bubble ("✓ <correction>" + short note) — omitted when correction is null.
- Assistant bubble: reply in target language.
- Typing indicator while awaiting response; input disabled during flight; errors shown as a dismissible inline notice, user message preserved in input for retry.
- Responsive: single-column layout, works from 360 px phones to desktop; input bar sticky at bottom.

## Error Handling

- Server validates body shape; maps Anthropic SDK errors to 500 with a safe message; logs details server-side.
- Missing `ANTHROPIC_API_KEY`: server starts but `/api/chat` returns 500 with an explanatory message so the UI can display it.
- Frontend: network/500 → inline error notice, conversation state intact.

## Testing / Verification

- Boot server, verify static serving and `/api/chat` validation errors (no key required).
- Browser check: start screen renders, selection flow works, chat screen reachable, graceful error shown when key missing.
- With a real key: full conversation round-trip.

## Out of Scope (YAGNI)

Accounts, persistence, streaming, audio/TTS, more languages, spaced repetition, session resume.
