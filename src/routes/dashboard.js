const express = require('express');
const path    = require('path');
const pkg     = require('../../package.json');

const config  = require('../config');
const { dashboardAuth, createToken, setCookie, clearCookie } = require('../middleware/dashboardAuth');
const { getRequests, getSystem, clearRequests, clearSystem, addSystem } = require('../store/logStore');
const { QODER_MODELS, getModelMapping, messagesToPrompt, extractTextContent, newId, buildStreamChunk, buildDoneChunk } = require('../helpers/format');
const { checkQoderCli, runQoderRequest } = require('../helpers/spawn');

const router     = express.Router();
const PUBLIC_DIR = path.join(__dirname, '..', 'dashboard', 'public');

// ── Static assets ────────────────────────────────────────────────────────────
router.use('/static', express.static(PUBLIC_DIR));

// ── Public routes (no auth) ──────────────────────────────────────────────────

router.get('/login', (_req, res) => res.sendFile(path.join(PUBLIC_DIR, 'index.html')));

router.post('/login', express.urlencoded({ extended: false }), (req, res) => {
  const { password } = req.body || {};
  if (password && password === config.DASHBOARD_PASSWORD) {
    setCookie(res, createToken());
    addSystem('Dashboard login successful', 'info', 'auth');
    return res.redirect('/dashboard/');
  }
  addSystem('Dashboard login failed — wrong password', 'warn', 'auth');
  res.redirect('/dashboard/login?error=1');
});

router.get('/logout', (req, res) => {
  clearCookie(res);
  addSystem('Dashboard logout', 'info', 'auth');
  res.redirect('/dashboard/login');
});

// ── Auth wall ────────────────────────────────────────────────────────────────
router.use(dashboardAuth);

// ── SPA shell ────────────────────────────────────────────────────────────────
router.get('/', (_req, res)  => res.sendFile(path.join(PUBLIC_DIR, 'index.html')));

// ── API — config ─────────────────────────────────────────────────────────────
router.get('/api/config', (req, res) => {
  const publicBaseUrl = config.PUBLIC_BASE_URL ||
    `${req.protocol}://${req.get('host')}`;
  res.json({
    publicBaseUrl,
    proxyApiKey:  config.API_KEY  || null,
    authEnabled:  !!config.API_KEY,
    version:      pkg.version,
  });
});

// ── API — status ─────────────────────────────────────────────────────────────
router.get('/api/status', async (_req, res) => {
  const version = await checkQoderCli();
  const mem     = process.memoryUsage();
  res.json({
    status:      version ? 'ok' : 'degraded',
    qodercli:    version || 'unavailable',
    uptime:      process.uptime(),
    memoryMB:    (mem.rss / 1024 / 1024).toFixed(1),
    heapUsedMB:  (mem.heapUsed / 1024 / 1024).toFixed(1),
    timestamp:   new Date().toISOString(),
    version:     pkg.version,
  });
});

// ── API — models ─────────────────────────────────────────────────────────────
router.get('/api/models', (_req, res) => res.json({ models: QODER_MODELS }));

// ── API — playground chat (SSE) ──────────────────────────────────────────────
router.post('/api/chat', (req, res) => {
  const { messages, model: requestedModel = 'lite' } = req.body;
  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'messages is required and must be a non-empty array' });
  }
  const model  = getModelMapping(requestedModel);
  const prompt = messagesToPrompt(messages);
  const id     = newId('chatcmpl');

  res.setHeader('Content-Type',    'text/event-stream');
  res.setHeader('Cache-Control',   'no-cache');
  res.setHeader('Connection',      'keep-alive');
  res.setHeader('X-Accel-Buffering','no');

  let lastFinishReason = 'stop';

  const child = runQoderRequest({
    prompt, model, flags: [],
    timeoutMs: config.QODER_TIMEOUT_MS,
    onChunk: (data) => {
      const content = extractTextContent(data.message);
      if (data.message?.stop_reason) lastFinishReason = data.message.stop_reason;
      if (content) res.write(`data: ${JSON.stringify(buildStreamChunk(content, model, id))}\n\n`);
    },
    onDone: (_code) => {
      res.write(`data: ${JSON.stringify(buildDoneChunk(model, id, lastFinishReason))}\n\n`);
      res.write('data: [DONE]\n\n');
      res.end();
    },
    onError: (err) => {
      res.write(`data: ${JSON.stringify({ error: { message: err.message } })}\n\n`);
      res.end();
    },
  });

  req.on('close', () => {
    console.log('[runQoderRequest] HTTP request closed, killing qodercli process');
    child.kill();
  });
});

// ── API — request logs ───────────────────────────────────────────────────────
router.get('/api/logs',    (_req, res)  => res.json({ logs: getRequests() }));
router.delete('/api/logs', (_req, res)  => { clearRequests(); addSystem('Request logs cleared', 'info', 'dashboard'); res.json({ ok: true }); });

// ── API — system logs ────────────────────────────────────────────────────────
router.get('/api/logs/system',    (_req, res) => res.json({ logs: getSystem() }));
router.delete('/api/logs/system', (_req, res) => { clearSystem(); res.json({ ok: true }); });

module.exports = router;
