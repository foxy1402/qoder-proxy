const { addRequest } = require('../store/logStore');

/**
 * Logger middleware — captures request + response bodies and writes to logStore.
 * Also prints a one-line summary to console on every request.
 */
const logger = (req, res, next) => {
  const start = Date.now();
  const requestPayload = (req.body && Object.keys(req.body).length > 0) ? req.body : null;

  let responsePayload = null;
  let isStream        = false;
  let streamText      = '';
  let streamChunks    = 0;

  // Intercept res.json() to sniff JSON responses
  const origJson = res.json.bind(res);
  res.json = (body) => {
    responsePayload = body;
    return origJson(body);
  };

  // Intercept res.write() to assemble SSE stream text
  const origWrite = res.write.bind(res);
  res.write = (chunk) => {
    isStream = true;
    const raw = chunk.toString();
    for (const line of raw.split('\n')) {
      if (!line.startsWith('data: ') || line === 'data: [DONE]') continue;
      try {
        const d = JSON.parse(line.slice(6));
        const delta = d.choices?.[0]?.delta?.content ?? d.choices?.[0]?.text ?? '';
        if (delta) { streamText += delta; streamChunks++; }
      } catch { /* ignore parse errors */ }
    }
    return origWrite(chunk);
  };

  res.on('finish', () => {
    const ms  = Date.now() - start;
    const ts  = new Date().toISOString();
    const tag = isStream ? ' [stream]' : '';
    console.log(`[${ts}] ${req.method} ${req.path} → ${res.statusCode} (${ms}ms)${tag}`);

    // Only log interesting paths
    const path = req.path;
    if (path.startsWith('/v1') || path.startsWith('/dashboard/api/chat')) {
      addRequest({
        method:          req.method,
        path,
        statusCode:      res.statusCode,
        durationMs:      ms,
        isStream,
        streamChunks:    isStream ? streamChunks : undefined,
        requestPayload,
        responsePayload: isStream ? (streamText || null) : responsePayload,
        error:           res.statusCode >= 400 ? (responsePayload?.error ?? null) : null,
      });
    }
  });

  next();
};

module.exports = logger;
