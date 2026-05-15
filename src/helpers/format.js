const { v4: uuidv4 } = require("uuid");

// ---------------------------------------------------------------------------
// ID generation
// ---------------------------------------------------------------------------

/** Generate a prefixed ID like `chatcmpl-abc123...` */
const newId = (prefix) => `${prefix}-${uuidv4().replace(/-/g, "")}`;

// ---------------------------------------------------------------------------
// Content extraction
// ---------------------------------------------------------------------------

/**
 * Extract plain text from a qodercli message object.
 * Handles both array-of-parts and plain string content gracefully.
 */
const extractTextContent = (message) => {
  if (!message) return "";
  if (Array.isArray(message.content)) {
    return message.content
      .filter((part) => part.type === "text")
      .map((part) => part.text)
      .join("");
  }
  return message.content || "";
};

// ---------------------------------------------------------------------------
// Model catalogue
// ---------------------------------------------------------------------------

/**
 * Full catalogue of qodercli models.
 *
 * `id`          — the exact value to pass to `--model`
 * `label`       — human-readable display name
 * `tier`        — 'free' | 'paid' | 'new'
 * `description` — brief explanation shown in /v1/models
 */
const QODER_MODELS = [
  // ── Assistant scene models ────────────────────────────────────────────────
  {
    id: "auto",
    label: "Auto (Smart Select)",
    tier: "paid",
    description:
      "Paid tier — automatically selects the best model per task (default for paid plans).",
  },
  {
    id: "ultimate",
    label: "Ultimate (Best Quality)",
    tier: "paid",
    description: "Paid tier — top-tier model, maximum quality.",
  },
  {
    id: "performance",
    label: "Performance",
    tier: "paid",
    description: "Paid tier — high-performance model for demanding tasks.",
  },
  {
    id: "Qwen3.6-Plus",
    label: "Qwen3.6-Plus",
    tier: "new",
    description: "New model — Qwen 3.6 Plus (Alibaba).",
  },
  {
    id: "lite",
    label: "Lite",
    tier: "free",
    description: "Free tier — fast, lightweight model for everyday tasks.",
  },
  {
    id: "efficient",
    label: "Efficient",
    tier: "paid",
    description: "Paid tier — optimised for speed and cost efficiency.",
  },
  // ── Quest scene models ────────────────────────────────────────────────────
  {
    id: "kmodel",
    label: "Kimi-K2.6",
    tier: "new",
    description: "New model — Kimi-K2.6 (Moonshot AI).",
  },
  {
    id: "mmodel",
    label: "MiniMax-M2.7",
    tier: "new",
    description: "New model — MiniMax-M2.7.",
  },
  {
    id: "deepseek-v4-pro",
    label: "deepseek-v4-pro",
    tier: "new",
    description: "New model — Deepseek-Pro series.",
  },
  {
    id: "deepseek-v4-flash",
    label: "deepseek-v4-flash",
    tier: "new",
    description: "New model — Deepseek-V4-Flash series.",
  },
  {
    id: "glm-5.1",
    label: "glm-5.1",
    tier: "new",
    description: "New model — GLM-5.1 series (Zhipu AI).",
  }
];

/** Quick lookup: qodercli model id → catalogue entry */
const QODER_MODEL_BY_ID = Object.fromEntries(
  QODER_MODELS.map((m) => [m.id, m]),
);

/**
 * OpenAI-name → qodercli model id aliases.
 *
 * Mapping philosophy:
 *   - gpt-4o / gpt-4 class  → 'auto'  (best balanced paid tier)
 *   - gpt-4o-mini / 3.5     → 'lite'  (lightweight free tier)
 *   - claude-3.5-sonnet      → 'auto'
 *   - claude-3-haiku         → 'lite'
 *   - Direct qodercli names pass through unchanged.
 */
const ALIAS_MAP = {
  // GPT-4 class → auto tier
  "gpt-4": "auto",
  "gpt-4-turbo": "auto",
  "gpt-4o": "auto",
  o1: "ultimate",
  "o1-mini": "performance",
  "o3-mini": "performance",
  // Lightweight → lite
  "gpt-4o-mini": "lite",
  "gpt-3.5-turbo": "lite",
  // Claude aliases
  "claude-3-opus": "ultimate",
  "claude-3-sonnet": "performance",
  "claude-3-haiku": "lite",
  "claude-3.5-sonnet": "auto",
  "claude-3.5-haiku": "efficient",
  "claude-3.7-sonnet": "auto",
  // Gemini aliases
  "gemini-pro": "performance",
  "gemini-flash": "efficient",
  // Friendly names for "new model" tier
  kimi: "kmodel",
  minimax: "mmodel",
  deepseekv4pro: "deepseek-v4-pro",
  deepseekv4flash: "deepseek-v4-flash",
  glm51: "glm-5.1",
  qwen36plus: "Qwen3.6-Plus",
};

/**
 * Resolve an OpenAI model name (or any alias) to a qodercli --model value.
 *
 * Resolution order:
 *   1. Direct qodercli model id (auto, lite, ultimate, etc.) → pass through
 *   2. Known OpenAI/alias name → map to qodercli tier
 *   3. Partial match heuristics for common unknown model names
 *   4. Unknown → fall back to 'lite' with a console warning
 */
const getModelMapping = (requestedModel) => {
  if (!requestedModel) return "lite";

  // 1. Direct qodercli model id
  if (QODER_MODEL_BY_ID[requestedModel]) return requestedModel;

  // 2. Exact alias match
  if (ALIAS_MAP[requestedModel]) return ALIAS_MAP[requestedModel];

  // 3. Heuristic partial matching for model families
  const lower = requestedModel.toLowerCase();

  // Claude family heuristics
  if (lower.includes("claude")) {
    if (lower.includes("opus")) return "ultimate";
    if (lower.includes("haiku")) return "efficient";
    // sonnet and anything else in claude family → auto
    return "auto";
  }
  // GPT-4 family
  if (lower.includes("gpt-4") || lower.includes("gpt4")) {
    if (lower.includes("mini")) return "lite";
    return "auto";
  }
  // GPT-3.5 family
  if (lower.includes("gpt-3") || lower.includes("gpt3")) return "lite";
  // o1/o3 reasoning models
  if (/^o\d/.test(lower)) {
    if (lower.includes("mini")) return "performance";
    return "ultimate";
  }
  // Gemini family
  if (lower.includes("gemini")) {
    if (lower.includes("flash") || lower.includes("nano")) return "efficient";
    return "performance";
  }
  // Kimi / Moonshot
  if (lower.includes("kimi") || lower.includes("moonshot")) return "kmodel";

  // MiniMax
  if (lower.includes("minimax")) return "mmodel";
  
  // Deepseek
  if (lower.includes("deepseek-v4-pro")) return "deepseek-v4-pro";
  if (lower.includes("deepseek-v4-flash")) return "deepseek-v4-flash";
  // GLM / Zhipu
  if (lower.includes("glm-5.1")) return "glm-5.1";
  // Qwen family
  if (lower.includes("qwen-3.6-plus")) return "Qwen3.6-Plus";

  // 4. Unknown model — warn and fall back to lite
  console.warn(
    `[model] Unknown model "${requestedModel}" — falling back to "lite". Add an alias in ALIAS_MAP to suppress this warning.`,
  );
  return "lite";
};

// ---------------------------------------------------------------------------
// Message → prompt conversion
// ---------------------------------------------------------------------------

/**
 * Convert an OpenAI messages array into a single prompt string for qodercli.
 *
 * Includes conversation history (up to last 10 messages) so the model has
 * context for follow-up questions and multi-turn edits. Older messages are
 * dropped to avoid exceeding qodercli's context limits.
 *
 * Format:
 *   System: <system message if present>
 *   User: <message>
 *   Assistant: <message>
 *   User: <latest message>
 */
const messagesToPrompt = (messages) => {
  if (!messages || messages.length === 0) return "Hello";

  // Separate system message from conversation
  const systemMsg = messages.find((m) => m.role === "system");
  const conversation = messages.filter((m) => m.role !== "system");

  // Keep last 10 conversation turns to avoid context overflow
  const recent = conversation.slice(-10);

  const extractContent = (msg) => {
    if (Array.isArray(msg.content)) {
      return msg.content
        .filter((p) => p.type === "text")
        .map((p) => p.text)
        .join("");
    }
    return msg.content || "";
  };

  const parts = [];

  // Include system message if present
  if (systemMsg) {
    const sysContent = extractContent(systemMsg);
    if (sysContent.trim()) parts.push(`System: ${sysContent.trim()}`);
  }

  // Include conversation history
  for (const msg of recent) {
    const content = extractContent(msg).trim();
    if (!content) continue;
    if (msg.role === "user") parts.push(`User: ${content}`);
    else if (msg.role === "assistant") parts.push(`Assistant: ${content}`);
  }

  return parts.join("\n\n") || "Hello";
};

// ---------------------------------------------------------------------------
// Response builders — chat completions
// ---------------------------------------------------------------------------

const buildStreamChunk = (content, model, id) => ({
  id,
  object: "chat.completion.chunk",
  created: Math.floor(Date.now() / 1000),
  model,
  choices: [
    { index: 0, delta: { role: "assistant", content }, finish_reason: null },
  ],
});

const buildDoneChunk = (model, id, finishReason = "stop") => ({
  id,
  object: "chat.completion.chunk",
  created: Math.floor(Date.now() / 1000),
  model,
  choices: [{ index: 0, delta: {}, finish_reason: finishReason }],
});

const buildFullChatResponse = (content, model, finishReason, id) => ({
  id,
  object: "chat.completion",
  created: Math.floor(Date.now() / 1000),
  model,
  choices: [
    {
      index: 0,
      message: { role: "assistant", content },
      finish_reason: finishReason || "stop",
    },
  ],
  usage: { prompt_tokens: null, completion_tokens: null, total_tokens: null },
});

// ---------------------------------------------------------------------------
// Response builders — legacy text completions
// ---------------------------------------------------------------------------

const buildCompletionStreamChunk = (text, model, id) => ({
  id,
  object: "text_completion_chunk",
  created: Math.floor(Date.now() / 1000),
  model,
  choices: [{ index: 0, text, finish_reason: null }],
});

const buildFullCompletionResponse = (text, model, finishReason, id) => ({
  id,
  object: "text_completion",
  created: Math.floor(Date.now() / 1000),
  model,
  choices: [{ index: 0, text, finish_reason: finishReason || "stop" }],
  usage: { prompt_tokens: null, completion_tokens: null, total_tokens: null },
});

/**
 * Extracts tool calls from qodercli message content
 * @param {Array} content - The content array from qodercli message
 * @returns {Array|null} - Array of OpenAI-format tool calls or null
 */
const extractToolCalls = (content) => {
  if (!Array.isArray(content)) return null;

  const toolCalls = [];
  for (const item of content) {
    if (item.type === "function" && item.id && item.name && item.input) {
      toolCalls.push({
        id: item.id,
        type: "function",
        function: {
          name: item.name,
          arguments: item.input,
        },
      });
    }
  }

  return toolCalls.length > 0 ? toolCalls : null;
};

/**
 * Build streaming chunk with tool calls
 * @param {Object} data - qodercli data object
 * @param {string} model - model name
 * @param {string} id - completion id
 * @returns {Object} - OpenAI format streaming chunk
 */
const buildToolCallStreamChunk = (data, model, id) => {
  const toolCalls = extractToolCalls(data.message?.content);

  return {
    id,
    object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [
      {
        index: 0,
        delta: toolCalls ? { tool_calls: toolCalls } : {},
        finish_reason:
          data.message?.status === "tool_calling" ? null : "tool_calls",
      },
    ],
  };
};

/**
 * Build full chat response with tool calls
 * @param {Array} toolCalls - Array of tool calls
 * @param {string} content - Text content
 * @param {string} model - model name
 * @param {string} finishReason - finish reason
 * @param {string} id - completion id
 * @returns {Object} - OpenAI format response
 */
const buildFullChatResponseWithTools = (
  toolCalls,
  content,
  model,
  finishReason,
  id,
) => ({
  id,
  object: "chat.completion",
  created: Math.floor(Date.now() / 1000),
  model,
  choices: [
    {
      index: 0,
      message: {
        role: "assistant",
        content: content || null,
        tool_calls: toolCalls,
      },
      finish_reason: finishReason || (toolCalls ? "tool_calls" : "stop"),
    },
  ],
  usage: { prompt_tokens: null, completion_tokens: null, total_tokens: null },
});

module.exports = {
  newId,
  extractTextContent,
  extractToolCalls,
  getModelMapping,
  messagesToPrompt,
  buildStreamChunk,
  buildDoneChunk,
  buildFullChatResponse,
  buildToolCallStreamChunk,
  buildFullChatResponseWithTools,
  buildCompletionStreamChunk,
  buildFullCompletionResponse,
  // Model catalogue — used by /v1/models endpoint
  QODER_MODELS,
};
