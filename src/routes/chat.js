const express = require('express');
const {
  getModelMapping,
  messagesToPrompt,
  extractTextContent,
  newId,
  buildStreamChunk,
  buildDoneChunk,
  buildFullChatResponse,
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
  const { messages, model: requestedModel, stream = false, temperature, max_tokens } = req.body;

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
        const finishReason = data.message?.stop_reason || null;
        if (finishReason) lastFinishReason = finishReason;
        if (content) {
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

    const child = runQoderRequest({
      prompt,
      model,
      flags,
      timeoutMs: QODER_TIMEOUT_MS,
      onChunk: (data) => {
        fullContent += extractTextContent(data.message);
        if (data.message?.stop_reason) finishReason = data.message.stop_reason;
      },
      onDone: (code, stderr) => {
        if (code !== 0) {
          return res.status(500).json({
            error: { message: `qodercli exited with code ${code}`, type: 'api_error', details: stderr },
          });
        }
        res.json(buildFullChatResponse(fullContent, model, finishReason, id));
      },
      onError: (err) => {
        res.status(err.code === 'TIMEOUT' ? 504 : 500).json({
          error: { message: err.message, type: err.code === 'TIMEOUT' ? 'timeout_error' : 'api_error' },
        });
      },
    });

    req.on('close', () => child.kill());
  }
});

module.exports = router;
