const crypto = require('crypto');
const { DASHBOARD_SECRET } = require('../config');

const COOKIE  = 'qoder_dash';
const MAX_AGE = 60 * 60 * 24 * 7; // 7 days

// ── Token helpers ────────────────────────────────────────────────────────────

const hmac = (data) =>
  crypto.createHmac('sha256', DASHBOARD_SECRET).update(data).digest('hex');

const createToken = () => {
  const payload = `${Date.now()}.${crypto.randomBytes(16).toString('hex')}`;
  return Buffer.from(`${payload}.${hmac(payload)}`).toString('base64url');
};

const verifyToken = (token) => {
  try {
    const raw   = Buffer.from(token, 'base64url').toString();
    const cut   = raw.lastIndexOf('.');
    const data  = raw.slice(0, cut);
    const sig   = raw.slice(cut + 1);
    return sig === hmac(data);
  } catch { return false; }
};

// ── Cookie helpers ────────────────────────────────────────────────────────────

const parseCookies = (req) =>
  Object.fromEntries(
    (req.headers.cookie || '').split(';').map((c) => {
      const [k, ...v] = c.trim().split('=');
      return [k.trim(), v.join('=')];
    })
  );

const setCookie  = (res, token) =>
  res.setHeader('Set-Cookie',
    `${COOKIE}=${token}; HttpOnly; SameSite=Lax; Max-Age=${MAX_AGE}; Path=/`);

const clearCookie = (res) =>
  res.setHeader('Set-Cookie',
    `${COOKIE}=; HttpOnly; SameSite=Lax; Max-Age=0; Path=/`);

const getToken = (req) => parseCookies(req)[COOKIE] || null;

// ── Middleware ────────────────────────────────────────────────────────────────

const dashboardAuth = (req, res, next) => {
  const token = getToken(req);
  if (token && verifyToken(token)) return next();
  if (req.path.startsWith('/api/')) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  res.redirect('/dashboard/login');
};

module.exports = { dashboardAuth, createToken, setCookie, clearCookie, getToken, verifyToken };
