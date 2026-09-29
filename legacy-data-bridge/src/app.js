const express = require('express');
const { encryptEnvelope, decryptEnvelope, ReplayCache } = require('../shared/cryptoEnvelope');
const { executeOperation } = require('./repositories/queryRepository');

function createRateLimiter({ limit = 120, windowMs = 60_000 } = {}) {
  const buckets = new Map();
  return (req, res, next) => {
    const now = Date.now();
    const key = req.ip || req.socket.remoteAddress || 'unknown';
    const bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      buckets.set(key, { count: 1, resetAt: now + windowMs });
      return next();
    }
    bucket.count += 1;
    if (bucket.count > limit) return res.status(429).json({ error: '请求过于频繁' });
    next();
  };
}

function createApp({ config, getDatabase, operationExecutor = executeOperation }) {
  const app = express();
  const replayCache = new ReplayCache(config.maxClockSkewMs * 2);
  app.disable('x-powered-by');
  app.use(express.json({ limit: config.requestLimit }));
  app.use(createRateLimiter());

  app.get('/health', (req, res) => {
    res.json({ status: 'ok', service: 'baibai-legacy-data-bridge', version: 1 });
  });

  app.post('/v1/query', async (req, res) => {
    const transport = {
      secret: config.secret,
      method: req.method,
      path: req.path,
      maxClockSkewMs: config.maxClockSkewMs
    };
    let request;
    try {
      request = decryptEnvelope(req.body, transport);
      if (!replayCache.consume(req.body.nonce)) {
        return res.status(409).json({ error: '重复请求' });
      }
    } catch (_) {
      return res.status(401).json({ error: '无效的加密请求' });
    }

    try {
      const db = await getDatabase(config);
      const data = await operationExecutor(db, request.operation, request.params);
      return res.json(encryptEnvelope({
        ok: true,
        requestNonce: req.body.nonce,
        data
      }, transport));
    } catch (error) {
      console.error(`[bridge] ${request.operation || 'unknown'} 查询失败: ${error.message}`);
      return res.status(500).json(encryptEnvelope({
        ok: false,
        requestNonce: req.body.nonce,
        error: '数据库查询失败'
      }, transport));
    }
  });

  app.use((req, res) => res.status(404).json({ error: 'not found' }));
  return app;
}

module.exports = { createApp, createRateLimiter };
