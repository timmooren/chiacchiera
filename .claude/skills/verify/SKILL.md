---
name: verify
description: How to run and verify the Chiacchiera language-learning chat app
---

# Verify Chiacchiera

Build/launch:
```bash
npm install          # once
npm start            # boots even without ANTHROPIC_API_KEY; http://localhost:3000
```

Drive:
- Browser (Playwright MCP): open http://localhost:3000 → pick language card + topic chip → "Start conversation" → chat screen fires POST /api/chat with empty messages.
- Without an API key every /api/chat call returns 500 `{"error":"ANTHROPIC_API_KEY is not set..."}` — the UI must show it as a dismissible inline notice and roll back the failed user bubble, restoring input text.
- Full LLM round-trip needs `ANTHROPIC_API_KEY` in `.env` (copy from `.env.example`).

API probes (no key needed):
```bash
curl -s -X POST localhost:3000/api/chat -H 'Content-Type: application/json' -d '{"language":"french","topic":"x","messages":[]}'   # 400 language
curl -s -X POST localhost:3000/api/chat -H 'Content-Type: application/json' -d '{bad'                                              # 400 JSON error (must be JSON, not HTML)
```

Gotchas:
- Server is plain `node server.js` — no watch mode; restart after edits (`pkill -f "node server.js"`).
- Playwright MCP drops snapshot/console artifacts into `.playwright-mcp/` (gitignored) — clean up screenshots from repo root.
