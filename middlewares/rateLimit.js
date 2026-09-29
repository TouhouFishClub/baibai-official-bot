/**
 * 简易内存限流：登录接口严格限制，其余请求按 IP 节流。
 * QQ webhook 不限流，避免平台回调被误伤。
 */

const loginHits = new Map();
const generalHits = new Map();

const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX = 8;
const GENERAL_WINDOW_MS = 60 * 1000;
const GENERAL_MAX = 90;

function getClientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.trim()) {
    return forwarded.split(',')[0].trim();
  }
  return req.ip || req.socket?.remoteAddress || 'unknown';
}

function takeSlot(store, key, windowMs, max) {
  const now = Date.now();
  let bucket = store.get(key);
  if (!bucket || now - bucket.start >= windowMs) {
    bucket = { start: now, count: 0 };
  }
  bucket.count += 1;
  store.set(key, bucket);
  return bucket.count > max;
}

function prune(store, windowMs) {
  const now = Date.now();
  for (const [key, bucket] of store) {
    if (now - bucket.start >= windowMs) {
      store.delete(key);
    }
  }
}

setInterval(() => {
  prune(loginHits, LOGIN_WINDOW_MS);
  prune(generalHits, GENERAL_WINDOW_MS);
}, 60 * 1000).unref();

function rateLimit(req, res, next) {
  if (req.path === '/qq/webhook' || req.originalUrl?.startsWith('/qq/webhook')) {
    return next();
  }

  const ip = getClientIp(req);
  const isLogin = req.method === 'POST' && (req.path === '/admin/login' || req.originalUrl?.startsWith('/admin/login'));

  if (isLogin && takeSlot(loginHits, ip, LOGIN_WINDOW_MS, LOGIN_MAX)) {
    return res.status(429).json({
      success: false,
      message: '登录尝试过于频繁，请稍后再试',
      error: 'TOO_MANY_REQUESTS'
    });
  }

  if (takeSlot(generalHits, ip, GENERAL_WINDOW_MS, GENERAL_MAX)) {
    return res.status(429).json({ error: '请求过于频繁' });
  }

  next();
}

module.exports = rateLimit;
