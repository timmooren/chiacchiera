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

const respondTool = {
  name: "respond",
  description: "Deliver your conversational reply and feedback on the learner's latest message.",
  input_schema: {
    type: "object",
    properties: {
      reply: {
        type: "string",
        description: "Your conversational response, written ONLY in the target language",
      },
      correction: {
        type: ["string", "null"],
        description:
          "The correct/natural way to say the user's latest message in the target language. If the user wrote English or mixed language, this is the target-language translation. If their target-language message had mistakes, this is the corrected version. null ONLY if the message was already correct and natural target-language.",
      },
      correctionNote: {
        type: ["string", "null"],
        description:
          "One short English sentence explaining the main fix or a useful nuance. null if correction is null.",
      },
    },
    required: ["reply", "correction", "correctionNote"],
  },
};

function buildSystemPrompt(languageName, topic) {
  return `You are a friendly native ${languageName} speaker helping a learner practice through casual conversation about ${topic}.

Rules:
- Reply ONLY in ${languageName}, in a natural conversational register.
- Keep replies to 1-3 sentences.
- Always keep the conversation going: react to what the learner said, then ask a follow-up question.
- Match the learner's apparent level — use simpler language if they seem to struggle.
- Stay loosely on the topic of ${topic}, but follow the learner's lead if they drift.
- Fill in the "respond" tool's correction and correctionNote fields exactly per their descriptions, based on the learner's latest message.`;
}

function validateBody(body) {
  if (!body || typeof body !== "object") {
    return "Request body must be a JSON object.";
  }
  const { language, topic, messages } = body;
  if (language !== "italian" && language !== "spanish") {
    return 'language must be "italian" or "spanish".';
  }
  if (typeof topic !== "string" || topic.trim() === "") {
    return "topic must be a non-empty string.";
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
  const languageName = LANGUAGES[language];
  const isOpener = messages.length === 0;

  const apiMessages = isOpener
    ? [
        {
          role: "user",
          content:
            "Please open the conversation with a warm greeting and an easy question about the topic.",
        },
      ]
    : messages.map(({ role, content }) => ({ role, content }));

  try {
    const response = await getClient().messages.create({
      model: "claude-sonnet-5",
      max_tokens: 1024,
      system: buildSystemPrompt(languageName, topic),
      tools: [respondTool],
      tool_choice: { type: "tool", name: "respond" },
      messages: apiMessages,
    });

    const toolUse = response.content.find((block) => block.type === "tool_use");
    if (!toolUse) {
      console.error("No tool_use block in model response:", JSON.stringify(response.content));
      return res.status(500).json({
        error: "The language model request failed. Check the server logs.",
      });
    }

    const { reply, correction, correctionNote } = toolUse.input;
    if (typeof reply !== "string" || reply.length === 0) {
      console.error("Model response missing reply:", JSON.stringify(toolUse.input));
      return res.status(500).json({
        error: "The language model request failed. Check the server logs.",
      });
    }
    return res.json({
      reply,
      correction: isOpener ? null : correction ?? null,
      correctionNote: isOpener ? null : correctionNote ?? null,
    });
  } catch (err) {
    console.error("Anthropic API error:", err);
    if (err instanceof Anthropic.AuthenticationError) {
      return res.status(500).json({ error: "Invalid Anthropic API key. Check .env." });
    }
    return res.status(500).json({
      error: "The language model request failed. Check the server logs.",
    });
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
