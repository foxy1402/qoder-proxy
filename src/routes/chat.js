const express = require('express');
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
} = require('../helpers/format');
const { runQoderRequest } = require('../helpers/spawn');
const { QODER_TIMEOUT_MS } = require('../config');

const router = express.Router();

const setSSEHeaders = (res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
};

// ── GET handler for client compatibility ────────────────────────────────────
router.get('/', (req, res) => {
  console.log('[GET /chat/completions] Query:', req.query);
  console.log('[GET /chat/completions] User-Agent:', req.headers['user-agent']);
  
  // Return helpful error - OpenAI SDK should use POST
  return res.status(400).json({
    error: {
      message: 'Use POST method for chat completions',
      type: 'invalid_request_error',
      help: 'POST /v1/chat/completions with JSON body: {"messages": [...], "model": "auto"}',
      debug: {
        receivedMethod: 'GET',
        expectedMethod: 'POST',
        userAgent: req.headers['user-agent']
      }
    }
  });
});

// ── POST handler (standard OpenAI-compatible endpoint) ──────────────────────
router.post('/', (req, res) => {
  // Debug logging
  console.log('[POST /chat/completions] Content-Type:', req.headers['content-type']);
  console.log('[POST /chat/completions] Body keys:', Object.keys(req.body || {}));
  
  const { messages, model: requestedModel, stream = false, temperature, max_tokens, tools, tool_choice } = req.body || {};

  // Validate messages
  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({
      error: {
        message: 'messages is required and must be a non-empty array',
        type: 'invalid_request_error',
        debug: {
          receivedBody: req.body,
          bodyType: typeof req.body,
          contentType: req.headers['content-type']
        }
      },
    });
  }

  const model = getModelMapping(requestedModel);
  const prompt = messagesToPrompt(messages);
  const id = newId('chatcmpl');
  
  console.log('[POST /chat/completions] Model:', model, 'Prompt length:', prompt.length, 'Stream:', stream);

  const flags = [];
  // Note: qodercli uses --max-output-tokens, not --max-tokens
  // And it only accepts specific values like "16k" or "32k"
  if (max_tokens != null) {
    // Convert OpenAI max_tokens to qodercli format
    if (max_tokens >= 32000) {
      flags.push('--max-output-tokens', '32k');
    } else if (max_tokens >= 16000) {
      flags.push('--max-output-tokens', '16k');
    }
    // Smaller values: qodercli will use its default
  }
  // Note: temperature is not supported by qodercli

  // Log tool requests (not yet implemented)
  if (tools && Array.isArray(tools) && tools.length > 0) {
    console.log('[chat/completions] Tools requested but mapping not implemented yet');
  }
  if (tool_choice && tool_choice !== 'auto') {
    console.log('[chat/completions] Tool choice specified but not implemented yet');
  }

  if (stream) {
    setSSEHeaders(res);
    let lastFinishReason = 'stop';

    const child = runQoderRequest({
      prompt,
      model,
      flags,
      timeoutMs: QODER_TIMEOUT_MS,
      onChunk: (data) => {
        const content = extractTextContent(data.message);
        const toolCalls = extractToolCalls(data.message?.content);
        const finishReason = data.message?.stop_reason || null;
        
        if (finishReason) lastFinishReason = finishReason;
        
        if (toolCalls && toolCalls.length > 0) {
          res.write(`data: ${JSON.stringify(buildToolCallStreamChunk(data, model, id))}\n\n`);
          lastFinishReason = 'tool_calls';
        } else if (content) {
          res.write(`data: ${JSON.stringify(buildStreamChunk(content, model, id))}\n\n`);
        }
      },
      onDone: (_code, _stderr) => {
        res.write(`data: ${JSON.stringify(buildDoneChunk(model, id, lastFinishReason))}\n\n`);
        res.write('data: [DONE]\n\n');
        res.end();
      },
      onError: (err) => {
        console.error('[chat/completions]', err.message);
        res.write(`data: ${JSON.stringify({ error: { message: err.message, type: err.code === 'TIMEOUT' ? 'timeout_error' : 'api_error' } })}\n\n`);
        res.end();
      },
    });

    req.on('close', () => child.kill());
  } else {
    let fullContent = '';
    let finishReason = 'stop';
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
          finishReason = 'tool_calls';
        }
        if (data.message?.stop_reason) finishReason = data.message.stop_reason;
      },
      onDone: (code, stderr) => {
        if (code !== 0) {
          return res.status(500).json({
            error: { message: `qodercli exited with code ${code}`, type: 'api_error', details: stderr },
          });
        }
        
        if (allToolCalls.length > 0) {
          res.json(buildFullChatResponseWithTools(allToolCalls, fullContent, model, finishReason, id));
        } else {
          res.json(buildFullChatResponse(fullContent, model, finishReason, id));
        }
      },
      onError: (err) => {
        res.status(err.code === 'TIMEOUT' ? 504 : 500).json({
          error: { message: err.message, type: err.code === 'TIMEOUT' ? 'timeout_error' : 'api_error' },
        });
      },
    });
  }
});

module.exports = router;
