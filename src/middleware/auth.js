const { API_KEY } = require('../config');

/**
 * Bearer token auth middleware.
 * Skips auth entirely if PROXY_API_KEY is not configured (open access).
 */
const authMiddleware = (req, res, next) => {
  if (!API_KEY) return next();

  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      error: {
        message: 'Missing or invalid Authorization header. Expected: Bearer <token>',
        type: 'invalid_request_error',
        code: 'invalid_api_key',
      },
    });
  }

  const token = authHeader.slice(7);
  if (token !== API_KEY) {
    return res.status(401).json({
      error: {
        message: 'Invalid API key',
        type: 'invalid_request_error',
        code: 'invalid_api_key',
      },
    });
  }

  next();
};

module.exports = authMiddleware;
