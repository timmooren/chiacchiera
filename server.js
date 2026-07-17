import "dotenv/config";
import express from "express";
import Anthropic from "@anthropic-ai/sdk";

const app = express();
app.use(express.json());
app.use(express.static("public"));

const LANGUAGES = {
  italian: "Italian",
  spanish: "Spanish",
};

let anthropic = null;
function getClient() {
  if (!anthropic) {
    anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return anthropic;
}

// Correction is delivered via an (unforced) tool call AFTER the plain-text
// reply. Keeping the reply as free text lets it stream token-by-token; forcing
// a tool for the whole response made the API buffer and emit it in one burst.
const correctionTool = {
  name: "correction",
  description:
    "Give feedback on the learner's latest message. Call this once, right after your conversational reply, on every turn where the learner wrote something.",
  input_schema: {
    type: "object",
    properties: {
      correction: {
        type: ["string", "null"],
        description:
          "The correct/natural way to say the user's latest message in the target language. If the user wrote English or mixed language, this is the target-language translation. If their target-language message had mistakes, this is the corrected version. null ONLY if the message was already correct and natural target-language. Treat trivial slips of accents/diacritics, capitalization, or punctuation as correct (e.g. \"si\" for \"sì\", \"esta\" for \"está\"): if those are the only differences, return null rather than a correction.",
      },
      correctionNote: {
        type: ["string", "null"],
        description:
          "One short sentence explaining the main fix or a useful nuance. ALWAYS write correctionNote in English, NEVER in the target language (Italian/Spanish) — it is a grammar explanation for an English-speaking learner. null if correction is null.",
      },
    },
    required: ["correction", "correctionNote"],
  },
};

function buildSystemPrompt(languageName, topic, mode) {
  const sharedRules = `- Reply ONLY in ${languageName}, in a natural conversational register. Write your reply as plain text — do NOT put it in a tool call.
- Keep replies to 1-3 sentences.
- Match the learner's apparent level — use simpler language if they seem to struggle.
- After your reply, call the "correction" tool exactly once to give feedback on the learner's latest message, filling correction and correctionNote exactly per their descriptions.
- correctionNote MUST ALWAYS be written in English, never in ${languageName} — it is a grammar explanation for an English-speaking learner. Only your reply and the correction field are in ${languageName}.`;

  if (mode === "roleplay") {
    return `You are a friendly native ${languageName} speaker helping a learner practice through a roleplay scene related to ${topic}.

Invent ONE concrete everyday scenario within that topic and surprise the learner — be specific and vary your choices (for Food & Cooking: ordering at a busy trattoria or haggling at a market stall; for Travel: checking into a small family-run hotel or asking a local for directions). You play one character in the scene (waiter, vendor, receptionist, fellow fan, ...); the learner plays themselves.

Rules:
- In your FIRST message, set the scene with one short parenthetical sentence in simple ${languageName} on its own line, then give your first in-character line.
- Stay in character and keep the scene moving: react to the learner, then prompt their next move with a question or a choice.
- If the scene reaches a natural end, wrap it up warmly and offer a twist or a fresh scene in the same topic — introduce it with another short parenthetical sentence on its own line.
${sharedRules}`;
  }

  return `You are a friendly native ${languageName} speaker helping a learner practice through casual conversation about ${topic}.

Rules:
- Always keep the conversation going: react to what the learner said, then ask a follow-up question.
- Stay loosely on the topic of ${topic}, but follow the learner's lead if they drift.
${sharedRules}`;
}

function validateBody(body) {
  if (!body || typeof body !== "object") {
    return "Request body must be a JSON object.";
  }
  const { language, topic, messages, mode } = body;
  if (language !== "italian" && language !== "spanish") {
    return 'language must be "italian" or "spanish".';
  }
  if (typeof topic !== "string" || topic.trim() === "") {
    return "topic must be a non-empty string.";
  }
  if (mode !== undefined && mode !== "chat" && mode !== "roleplay") {
    return 'mode must be "chat" or "roleplay".';
  }
  if (!Array.isArray(messages)) {
    return "messages must be an array.";
  }
  for (const [i, msg] of messages.entries()) {
    if (!msg || typeof msg !== "object") {
      return `messages[${i}] must be an object with role and content.`;
    }
    if (msg.role !== "user" && msg.role !== "assistant") {
      return `messages[${i}].role must be "user" or "assistant".`;
    }
    if (typeof msg.content !== "string" || msg.content.trim() === "") {
      return `messages[${i}].content must be a non-empty string.`;
    }
  }
  if (messages.length > 0 && messages[messages.length - 1].role !== "user") {
    return "messages must end with a user message.";
  }
  return null;
}

app.post("/api/chat", async (req, res) => {
  const validationError = validateBody(req.body);
  if (validationError) {
    return res.status(400).json({ error: validationError });
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({
      error: "ANTHROPIC_API_KEY is not set. Add it to .env and restart the server.",
    });
  }

  const { language, topic, messages } = req.body;
  const mode = req.body.mode === "roleplay" ? "roleplay" : "chat";
  const languageName = LANGUAGES[language];
  const isOpener = messages.length === 0;

  const openerInstruction =
    mode === "roleplay"
      ? "Please start the roleplay: set the scene in one short parenthetical sentence, then give your first in-character line."
      : "Please open the conversation with a warm greeting and an easy question about the topic.";

  const apiMessages = isOpener
    ? [{ role: "user", content: openerInstruction }]
    : messages.map(({ role, content }) => ({ role, content }));

  // Streamed NDJSON response: one JSON event per line.
  //   {"type":"delta","text":"..."}  — incremental chunks of the reply
  //   {"type":"done", ...}           — final authoritative payload
  //   {"type":"error","error":"..."} — terminal mid-stream error
  // Pre-stream failures (validation, missing key) above keep today's
  // non-200 JSON responses since no headers have been sent yet.
  const writeEvent = (event) => {
    if (!res.headersSent) {
      res.status(200);
      res.setHeader("Content-Type", "application/x-ndjson");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("X-Accel-Buffering", "no");
      // Without this, Chrome buffers the first ~1-2KB to MIME-sniff the body
      // before releasing bytes to fetch's ReadableStream — for a short reply
      // that means the whole stream lands in one burst, killing word-by-word.
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.flushHeaders();
      // send each small delta packet immediately instead of coalescing (Nagle)
      res.socket?.setNoDelay(true);
    }
    res.write(JSON.stringify(event) + "\n");
  };

  const fail = (message) => {
    if (res.headersSent) {
      writeEvent({ type: "error", error: message });
      return res.end();
    }
    return res.status(500).json({ error: message });
  };

  try {
    const stream = getClient().messages.stream({
      model: "claude-sonnet-5",
      max_tokens: 1024,
      system: buildSystemPrompt(languageName, topic, mode),
      tools: [correctionTool],
      messages: apiMessages,
    });

    // The reply is the model's plain text; it streams token-by-token via
    // text_delta. The correction rides along in a tool_use block we read from
    // the final message.
    for await (const event of stream) {
      if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
        const text = event.delta.text;
        if (text) writeEvent({ type: "delta", text });
      }
    }

    const response = await stream.finalMessage();

    const reply = response.content
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("")
      .trim();
    if (reply.length === 0) {
      console.error("Model response missing reply text:", JSON.stringify(response.content));
      return fail("The language model request failed. Check the server logs.");
    }

    const toolUse = response.content.find((block) => block.type === "tool_use");
    const correction = toolUse?.input?.correction ?? null;
    const correctionNote = toolUse?.input?.correctionNote ?? null;

    writeEvent({
      type: "done",
      reply,
      correction: isOpener ? null : correction,
      correctionNote: isOpener ? null : correctionNote,
    });
    return res.end();
  } catch (err) {
    console.error("Anthropic API error:", err);
    if (err instanceof Anthropic.AuthenticationError) {
      return fail("Invalid Anthropic API key. Check .env.");
    }
    return fail("The language model request failed. Check the server logs.");
  }
});

app.use((err, req, res, next) => {
  if (err.type === "entity.parse.failed" || (err instanceof SyntaxError && err.status === 400)) {
    return res.status(400).json({ error: "Request body must be valid JSON." });
  }
  console.error("Unhandled error:", err);
  return res.status(500).json({ error: "Internal server error." });
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Language learning chat running at http://localhost:${port}`);
});
