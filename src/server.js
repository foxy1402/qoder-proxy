const express = require('express');
const cors    = require('cors');
const config  = require('./config');
const { PORT, API_KEY, CORS_ORIGIN, DASHBOARD_ENABLED, DASHBOARD_PASSWORD } = config;

const authMiddleware      = require('./middleware/auth');
const logger              = require('./middleware/logger');
const chatRouter          = require('./routes/chat');
const completionsRouter   = require('./routes/completions');
const dashboardRouter     = require('./routes/dashboard');
const { router: v1Router, healthHandler } = require('./routes/misc');
const { checkQoderCli }   = require('./helpers/spawn');
const { addSystem }       = require('./store/logStore');

const app = express();

// ── Global middleware ────────────────────────────────────────────────────────
app.use(cors({ origin: CORS_ORIGIN }));
app.use(express.json());
app.use(logger);

// ── Public routes ────────────────────────────────────────────────────────────
app.get('/', (_req, res) => res.json({
  name:      'Qoder OpenAI Proxy',
  version:   '2.0.0',
  dashboard: DASHBOARD_ENABLED ? '/dashboard/' : 'disabled',
  endpoints: ['GET /v1/models','POST /v1/chat/completions','POST /v1/completions','GET /health'],
}));

app.get('/health', healthHandler);

// Redirect bare /dashboard → /dashboard/
app.get('/dashboard', (_req, res) => res.redirect('/dashboard/'));

// ── Dashboard (optional) ─────────────────────────────────────────────────────
if (DASHBOARD_ENABLED) {
  app.use('/dashboard', dashboardRouter);
}

// ── Protected v1 routes ──────────────────────────────────────────────────────
app.use('/v1', authMiddleware);
app.use('/v1/chat/completions', chatRouter);
app.use('/v1/completions', completionsRouter);
app.use('/v1', v1Router);

// ── Startup ──────────────────────────────────────────────────────────────────
const start = async () => {
  const version = await checkQoderCli();
  if (version) {
    addSystem(`qodercli detected: ${version}`, 'info', 'startup');
  } else {
    addSystem('qodercli not found on PATH — requests will fail', 'error', 'startup');
    console.warn('⚠️  Install: npm install -g @qoder-ai/qodercli && set QODER_PERSONAL_ACCESS_TOKEN');
  }

  if (!API_KEY) {
    addSystem('PROXY_API_KEY not set — proxy is open (no auth)', 'warn', 'startup');
    console.warn('⚠️  Set PROXY_API_KEY in .env to require Bearer token auth');
  }

  if (DASHBOARD_ENABLED && !DASHBOARD_PASSWORD) {
    addSystem('DASHBOARD_PASSWORD not set — dashboard is inaccessible', 'error', 'startup');
    console.warn('⚠️  Set DASHBOARD_PASSWORD in .env to access the dashboard');
  }

  app.listen(PORT, () => {
    console.log(`\n🚀 Qoder OpenAI Proxy  →  http://localhost:${PORT}`);
    console.log(`   Auth     : ${API_KEY ? 'Enabled (Bearer token)' : 'Disabled (open access)'}`);
    console.log(`   Dashboard: ${DASHBOARD_ENABLED ? `http://localhost:${PORT}/dashboard/` : 'Disabled'}`);
    console.log(`   CORS     : ${CORS_ORIGIN}`);
    console.log(`   Timeout  : ${config.QODER_TIMEOUT_MS}ms\n`);
  });
};

start().catch((err) => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});
