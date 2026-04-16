const express = require("express");
const {
  getModelMapping,
  messagesToPrompt,
  extractTextContent,
  extractToolCalls,
  newId,
  buildStreamChunk,
  buildDoneChunk,
  buildFullChatResponse,
  buildToolCallStreamChunk,
  buildFullChatResponseWithTools,
} = require("../helpers/format");
const { runQoderRequest } = require("../helpers/spawn");
const { QODER_TIMEOUT_MS } = require("../config");
const {
  buildPromptWithTools,
  parseToolCallFromText,
  toOpenAIToolCalls,
} = require("../helpers/toolPrompt");

const router = express.Router();

const setSSEHeaders = (res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
};

// ── GET handler for client compatibility ────────────────────────────────────
router.get("/", (req, res) => {
  // Return helpful error - OpenAI SDK should use POST
  return res.status(400).json({
    error: {
      message: "Use POST method for chat completions",
      type: "invalid_request_error",
      help: 'POST /v1/chat/completions with JSON body: {"messages": [...], "model": "auto"}',
    },
  });
});

// ── POST handler (standard OpenAI-compatible endpoint) ──────────────────────
router.post("/", (req, res) => {
  const {
    messages,
    model: requestedModel,
    stream = false,
    temperature,
    max_tokens,
    tools,
    tool_choice,
  } = req.body || {};

  const userAgent = req.headers["user-agent"] || "unknown";
  const hasTools = Array.isArray(tools) && tools.length > 0;

  if (
    userAgent.includes("Continue") ||
    userAgent.includes("Zed") ||
    userAgent.includes("Cursor") ||
    userAgent.includes("opencode")
  ) {
    console.log(
      "[IDE Request]",
      userAgent,
      "stream:",
      stream,
      "model:",
      requestedModel,
      "tools:",
      hasTools ? tools.length : 0,
    );
  }

  // Validate messages
  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({
      error: {
        message: "messages is required and must be a non-empty array",
        type: "invalid_request_error",
      },
    });
  }

  const model = getModelMapping(requestedModel);

  // Log model resolution so dashboard system logs show what happened
  if (requestedModel && model !== requestedModel) {
    const { addSystem } = require("../store/logStore");
    addSystem(
      `Model "${requestedModel}" resolved to "${model}"`,
      "info",
      "model-map",
    );
  }

  // Use tool-aware prompt builder when tools are present
  const prompt = hasTools
    ? buildPromptWithTools(messages, tools, messagesToPrompt)
    : messagesToPrompt(messages);
  const id = newId("chatcmpl");

  const flags = [];
  if (max_tokens != null) {
    if (max_tokens >= 32000) flags.push("--max-output-tokens", "32k");
    else if (max_tokens >= 16000) flags.push("--max-output-tokens", "16k");
  }

  if (stream) {
    setSSEHeaders(res);

    const streamStartTime = Date.now();
    req.socket.setTimeout(0);
    req.socket.setKeepAlive(true);

    // Send role chunk immediately for IDE compatibility
    const firstChunk = {
      id,
      object: "chat.completion.chunk",
      created: Math.floor(Date.now() / 1000),
      model,
      choices: [
        {
          index: 0,
          delta: { role: "assistant", content: "" },
          finish_reason: null,
        },
      ],
    };
    res.write(`data: ${JSON.stringify(firstChunk)}\n\n`);
    if (typeof res.flush === "function") res.flush();

    let lastFinishReason = "stop";
    let hasReceivedData = false;
    // Accumulate full text so we can detect tool calls at the end
    let fullStreamText = "";

    const child = runQoderRequest({
      prompt,
      model,
      flags,
      timeoutMs: QODER_TIMEOUT_MS,
      onChunk: (data) => {
        const content = extractTextContent(data.message);
        const finishReason = data.message?.stop_reason || null;
        if (!hasReceivedData) {
          console.log(
            "[Stream Timing] First chunk at",
            Date.now() - streamStartTime,
            "ms",
          );
          hasReceivedData = true;
        }
        if (finishReason) lastFinishReason = finishReason;
        if (content) {
          fullStreamText += content;
          // Stream content chunks normally — tool call detection happens onDone
          const chunk = {
            id,
            object: "chat.completion.chunk",
            created: Math.floor(Date.now() / 1000),
            model,
            choices: [{ index: 0, delta: { content }, finish_reason: null }],
          };
          res.write(`data: ${JSON.stringify(chunk)}\n\n`);
        }
      },
      onDone: (code, stderr) => {
        if (code !== 0) {
          console.error(
            "[chat/completions] qodercli exit code:",
            code,
            stderr?.substring(0, 200),
          );
        }

        // Check if the full accumulated text is actually a tool call
        if (hasTools) {
          const toolCall = parseToolCallFromText(fullStreamText);
          if (toolCall) {
            const callId = `call_${newId("tc").replace("tc-", "")}`;
            const toolCalls = toOpenAIToolCalls(toolCall, callId);
            // Emit a tool_calls delta chunk
            const tcChunk = {
              id,
              object: "chat.completion.chunk",
              created: Math.floor(Date.now() / 1000),
              model,
              choices: [
                {
                  index: 0,
                  delta: { tool_calls: toolCalls },
                  finish_reason: null,
                },
              ],
            };
            res.write(`data: ${JSON.stringify(tcChunk)}\n\n`);
            lastFinishReason = "tool_calls";
          }
        }

        res.write(
          `data: ${JSON.stringify(buildDoneChunk(model, id, lastFinishReason))}\n\n`,
        );
        res.write("data: [DONE]\n\n");
        res.end();
      },
      onError: (err) => {
        console.error("[chat/completions] error:", err.message);
        res.write(
          `data: ${JSON.stringify({ error: { message: err.message, type: err.code === "TIMEOUT" ? "timeout_error" : "api_error" } })}\n\n`,
        );
        res.end();
      },
    });

    req.on("close", () => {
      console.log(
        "[Stream] Client disconnected at",
        Date.now() - streamStartTime,
        "ms",
      );
      child.kill();
    });
  } else {
    // Non-streaming path
    let fullContent = "";
    let finishReason = "stop";
    let allToolCalls = [];

    const child = runQoderRequest({
      prompt,
      model,
      flags,
      timeoutMs: QODER_TIMEOUT_MS,
      onChunk: (data) => {
        const content = extractTextContent(data.message);
        const toolCalls = extractToolCalls(data.message?.content);
        if (content) fullContent += content;
        if (toolCalls && toolCalls.length > 0) {
          allToolCalls.push(...toolCalls);
          finishReason = "tool_calls";
        }
        if (data.message?.stop_reason) finishReason = data.message.stop_reason;
      },
      onDone: (code, stderr) => {
        if (code !== 0) {
          return res.status(500).json({
            error: {
              message: `qodercli exited with code ${code}`,
              type: "api_error",
              details: stderr,
            },
          });
        }

        // Check text output for fake tool calls when tools were provided
        if (hasTools && allToolCalls.length === 0) {
          const toolCall = parseToolCallFromText(fullContent);
          if (toolCall) {
            const callId = `call_${newId("tc").replace("tc-", "")}`;
            allToolCalls = toOpenAIToolCalls(toolCall, callId);
            finishReason = "tool_calls";
            fullContent = ""; // tool call responses have null content
          }
        }

        if (allToolCalls.length > 0) {
          res.json(
            buildFullChatResponseWithTools(
              allToolCalls,
              fullContent || null,
              model,
              finishReason,
              id,
            ),
          );
        } else {
          res.json(buildFullChatResponse(fullContent, model, finishReason, id));
        }
      },
      onError: (err) => {
        res.status(err.code === "TIMEOUT" ? 504 : 500).json({
          error: {
            message: err.message,
            type: err.code === "TIMEOUT" ? "timeout_error" : "api_error",
          },
        });
      },
    });
  }
});

module.exports = router;
