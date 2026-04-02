const express = require('express');
const {
  getModelMapping,
  extractTextContent,
  newId,
  buildCompletionStreamChunk,
  buildFullCompletionResponse,
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
  const { prompt, model: requestedModel, stream = false, temperature, max_tokens } = req.body;

  if (!prompt) {
    return res.status(400).json({
      error: { message: 'prompt is required', type: 'invalid_request_error' },
    });
  }

  const model = getModelMapping(requestedModel);
  const id = newId('cmpl');

  const flags = [];
  if (max_tokens != null) flags.push('--max-tokens', String(max_tokens));
  if (temperature != null) flags.push('--temperature', String(temperature));

  if (stream) {
    setSSEHeaders(res);

    const child = runQoderRequest({
      prompt,
      model,
      flags,
      timeoutMs: QODER_TIMEOUT_MS,
      onChunk: (data) => {
        const text = extractTextContent(data.message);
        if (text) {
          res.write(`data: ${JSON.stringify(buildCompletionStreamChunk(text, model, id))}\n\n`);
        }
      },
      onDone: (_code, _stderr) => {
        res.write('data: [DONE]\n\n');
        res.end();
      },
      onError: (err) => {
        console.error('[completions]', err.message);
        res.write(`data: ${JSON.stringify({ error: { message: err.message } })}\n\n`);
        res.end();
      },
    });

    req.on('close', () => child.kill());
  } else {
    let fullText = '';
    let finishReason = 'stop';

    const child = runQoderRequest({
      prompt,
      model,
      flags,
      timeoutMs: QODER_TIMEOUT_MS,
      onChunk: (data) => {
        fullText += extractTextContent(data.message);
        if (data.message?.stop_reason) finishReason = data.message.stop_reason;
      },
      onDone: (code, stderr) => {
        if (code !== 0) {
          return res.status(500).json({
            error: { message: `qodercli exited with code ${code}`, type: 'api_error', details: stderr },
          });
        }
        res.json(buildFullCompletionResponse(fullText, model, finishReason, id));
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
