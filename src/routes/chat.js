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

router.post('/', (req, res) => {
  const { messages, model: requestedModel, stream = false, temperature, max_tokens, tools, tool_choice } = req.body;

  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({
      error: {
        message: 'messages is required and must be a non-empty array',
        type: 'invalid_request_error',
      },
    });
  }

  const model = getModelMapping(requestedModel);
  const prompt = messagesToPrompt(messages);
  const id = newId('chatcmpl');

  const flags = [];
  if (max_tokens != null) flags.push('--max-tokens', String(max_tokens));
  if (temperature != null) flags.push('--temperature', String(temperature));
  
  // Handle tool calling
  if (tools && Array.isArray(tools) && tools.length > 0) {
    // For now, we'll add tools support but qodercli uses its built-in tools
    // We could potentially map OpenAI tool specs to qodercli tools in the future
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
        
        // Handle tool calls
        if (toolCalls && toolCalls.length > 0) {
          res.write(`data: ${JSON.stringify(buildToolCallStreamChunk(data, model, id))}\n\n`);
          lastFinishReason = 'tool_calls';
        }
        // Handle regular text content
        else if (content) {
          res.write(`data: ${JSON.stringify(buildStreamChunk(content, model, id))}\n\n`);
        }
      },
      onDone: (_code, _stderr) => {
        // Send a final chunk with finish_reason so clients know why we stopped
        res.write(`data: ${JSON.stringify(buildDoneChunk(model, id, lastFinishReason))}\n\n`);
        res.write('data: [DONE]\n\n');
        res.end();
      },
      onError: (err) => {
        console.error('[chat/completions]', err.message);
        // Headers already sent — signal via SSE error event
        res.write(
          `data: ${JSON.stringify({
            error: { message: err.message, type: err.code === 'TIMEOUT' ? 'timeout_error' : 'api_error' },
          })}\n\n`
        );
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
        
        // Send response with tool calls if present
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

    // For non-streaming, don't kill on client disconnect - let it complete
    // req.on('close', () => child.kill());
  }
});

module.exports = router;
