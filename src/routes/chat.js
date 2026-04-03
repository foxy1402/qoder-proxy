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
  // Return helpful error - OpenAI SDK should use POST
  return res.status(400).json({
    error: {
      message: 'Use POST method for chat completions',
      type: 'invalid_request_error',
      help: 'POST /v1/chat/completions with JSON body: {"messages": [...], "model": "auto"}'
    }
  });
});

// ── POST handler (standard OpenAI-compatible endpoint) ──────────────────────
router.post('/', (req, res) => {
  const { messages, model: requestedModel, stream = false, temperature, max_tokens, tools, tool_choice } = req.body || {};

  // Log IDE/client info for debugging
  const userAgent = req.headers['user-agent'] || 'unknown';
  if (userAgent.includes('Continue') || userAgent.includes('Zed') || userAgent.includes('Cursor')) {
    console.log('[IDE Request]', userAgent, 'stream:', stream, 'model:', requestedModel, 'messages:', messages?.length || 0);
  }

  // Validate messages
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
  
  // Debug: Log prompt for IDE tools
  if (userAgent.includes('Continue') || userAgent.includes('Zed') || userAgent.includes('Cursor')) {
    console.log('[IDE Prompt]', prompt.substring(0, 150) + (prompt.length > 150 ? '...' : ''));
  }

  const flags = [];
  // qodercli uses --max-output-tokens with values "16k" or "32k"
  if (max_tokens != null) {
    if (max_tokens >= 32000) {
      flags.push('--max-output-tokens', '32k');
    } else if (max_tokens >= 16000) {
      flags.push('--max-output-tokens', '16k');
    }
  }
  // Note: temperature is not supported by qodercli
  // Note: tools/tool_choice not yet implemented

  if (stream) {
    setSSEHeaders(res);
    
    const streamStartTime = Date.now();
    console.log('[Stream Timing] Stream started at', streamStartTime);
    
    // Disable socket timeout and enable keepalive for long-running streams
    req.socket.setTimeout(0);
    req.socket.setKeepAlive(true);
    
    // Send SSE comment immediately to keep connection alive (IDE compatibility)
    // Don't send an empty delta - some IDEs interpret that as end of stream
    res.write(': keep-alive\n\n');
    console.log('[Stream Timing] Keepalive sent at', Date.now() - streamStartTime, 'ms');
    
    // Explicitly flush the response buffer
    if (typeof res.flush === 'function') res.flush();
    
    let lastFinishReason = 'stop';
    let hasReceivedData = false;

    const child = runQoderRequest({
      prompt,
      model,
      flags,
      timeoutMs: QODER_TIMEOUT_MS,
      onChunk: (data) => {
        const content = extractTextContent(data.message);
        const toolCalls = extractToolCalls(data.message?.content);
        const finishReason = data.message?.stop_reason || null;
        
        if (!hasReceivedData) {
          console.log('[Stream Timing] First chunk received at', Date.now() - streamStartTime, 'ms');
        }
        
        if (finishReason) lastFinishReason = finishReason;
        
        if (toolCalls && toolCalls.length > 0) {
          res.write(`data: ${JSON.stringify(buildToolCallStreamChunk(data, model, id))}\n\n`);
          lastFinishReason = 'tool_calls';
        } else if (content) {
          // First chunk should include role, subsequent chunks should not
          const delta = hasReceivedData 
            ? { content }
            : { role: 'assistant', content };
          
          const chunk = {
            id,
            object: 'chat.completion.chunk',
            created: Math.floor(Date.now() / 1000),
            model,
            choices: [{ index: 0, delta, finish_reason: null }]
          };
          
          res.write(`data: ${JSON.stringify(chunk)}\n\n`);
          hasReceivedData = true;
        }
      },
      onDone: (code, stderr) => {
        if (code !== 0 || stderr) {
          console.error('[chat/completions] qodercli exited with code:', code, 'stderr:', stderr?.substring(0, 200));
        }
        res.write(`data: ${JSON.stringify(buildDoneChunk(model, id, lastFinishReason))}\n\n`);
        res.write('data: [DONE]\n\n');
        res.end();
      },
      onError: (err) => {
        console.error('[chat/completions] error:', err.message);
        res.write(`data: ${JSON.stringify({ error: { message: err.message, type: err.code === 'TIMEOUT' ? 'timeout_error' : 'api_error' } })}\n\n`);
        res.end();
      },
    });

    req.on('close', () => {
      const disconnectTime = Date.now() - streamStartTime;
      console.log('[Stream Timing] Client disconnected at', disconnectTime, 'ms');
      if (!hasReceivedData) {
        console.log('[chat/completions] Client disconnected before receiving any data');
      }
      child.kill();
    });
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
