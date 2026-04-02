const express = require('express');
const { checkQoderCli } = require('../helpers/spawn');
const { QODER_MODELS } = require('../helpers/format');

const router = express.Router();

// ---------------------------------------------------------------------------
// GET /v1/models
// ---------------------------------------------------------------------------

/**
 * Build the OpenAI-compatible model list from the Qoder catalogue.
 *
 * Each entry includes extra metadata in the `qoder` field so clients that
 * know about it can display tier/description information:
 *
 *   - owned_by: "qoder-free" | "qoder-paid" | "qoder-new"
 *   - qoder.tier, qoder.description, qoder.label
 *
 * OpenAI-alias models are also listed so any client using standard model
 * names (gpt-4, claude-3.5-sonnet, etc.) sees them in the list.
 */
const OPENAI_ALIASES = [
  // id → resolves-to  (mirrors ALIAS_MAP in format.js)
  { id: 'gpt-4',            resolves_to: 'auto',        description: 'Alias → auto tier' },
  { id: 'gpt-4-turbo',      resolves_to: 'auto',        description: 'Alias → auto tier' },
  { id: 'gpt-4o',           resolves_to: 'auto',        description: 'Alias → auto tier' },
  { id: 'gpt-4o-mini',      resolves_to: 'lite',        description: 'Alias → lite tier' },
  { id: 'gpt-3.5-turbo',    resolves_to: 'lite',        description: 'Alias → lite tier' },
  { id: 'o1',               resolves_to: 'ultimate',    description: 'Alias → ultimate tier' },
  { id: 'o1-mini',          resolves_to: 'performance', description: 'Alias → performance tier' },
  { id: 'o3-mini',          resolves_to: 'performance', description: 'Alias → performance tier' },
  { id: 'claude-3-opus',    resolves_to: 'ultimate',    description: 'Alias → ultimate tier' },
  { id: 'claude-3-sonnet',  resolves_to: 'performance', description: 'Alias → performance tier' },
  { id: 'claude-3-haiku',   resolves_to: 'lite',        description: 'Alias → lite tier' },
  { id: 'claude-3.5-sonnet',resolves_to: 'auto',        description: 'Alias → auto tier' },
  { id: 'claude-3.5-haiku', resolves_to: 'efficient',   description: 'Alias → efficient tier' },
  { id: 'claude-3.7-sonnet',resolves_to: 'auto',        description: 'Alias → auto tier' },
  { id: 'gemini-pro',       resolves_to: 'performance', description: 'Alias → performance tier' },
  { id: 'gemini-flash',     resolves_to: 'efficient',   description: 'Alias → efficient tier' },
  { id: 'qwen',             resolves_to: 'qmodel',      description: 'Alias → Qwen new model' },
  { id: 'qwen-3.5',         resolves_to: 'q35model',    description: 'Alias → Qwen 3.5 new model' },
  { id: 'glm',              resolves_to: 'gmodel',      description: 'Alias → GLM new model' },
  { id: 'kimi',             resolves_to: 'kmodel',      description: 'Alias → Kimi new model' },
  { id: 'minimax',          resolves_to: 'mmodel',      description: 'Alias → MiniMax new model' },
];

const TS = 1700000000;

router.get('/models', (_req, res) => {
  const nativeModels = QODER_MODELS.map((m) => ({
    id: m.id,
    object: 'model',
    created: TS,
    owned_by: `qoder-${m.tier}`,
    qoder: {
      label: m.label,
      tier: m.tier,
      description: m.description,
      is_alias: false,
    },
  }));

  const aliasModels = OPENAI_ALIASES.map((a) => ({
    id: a.id,
    object: 'model',
    created: TS,
    owned_by: 'qoder-alias',
    qoder: {
      label: a.id,
      tier: 'alias',
      description: a.description,
      resolves_to: a.resolves_to,
      is_alias: true,
    },
  }));

  res.json({ object: 'list', data: [...nativeModels, ...aliasModels] });
});

// ---------------------------------------------------------------------------
// POST /v1/embeddings — not supported
// ---------------------------------------------------------------------------

router.post('/embeddings', (_req, res) => {
  res.status(501).json({
    error: {
      message:
        'Embeddings are not supported. qodercli does not generate embeddings. ' +
        'Use OpenAI, Cohere, or a local model (Ollama / sentence-transformers) instead.',
      type: 'not_implemented_error',
      code: 'endpoint_not_supported',
    },
  });
});

// ---------------------------------------------------------------------------
// GET /health — checks qodercli availability
// ---------------------------------------------------------------------------

const healthHandler = async (_req, res) => {
  const version = await checkQoderCli();
  res.status(version ? 200 : 503).json({
    status: version ? 'ok' : 'degraded',
    qodercli: version || 'unavailable',
    timestamp: new Date().toISOString(),
  });
};

module.exports = { router, healthHandler };
