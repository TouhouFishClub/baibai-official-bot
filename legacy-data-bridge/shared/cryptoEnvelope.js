const crypto = require('crypto');

const VERSION = 1;
const MAX_CLOCK_SKEW_MS = 60_000;

function decodeSecret(secret) {
  const value = String(secret || '').trim();
  if (!value) throw new Error('DATABASE_BRIDGE_SECRET 未配置');
  const key = Buffer.from(value, 'base64');
  if (key.length !== 32 || key.toString('base64').replace(/=+$/, '') !== value.replace(/=+$/, '')) {
    throw new Error('DATABASE_BRIDGE_SECRET 必须是 32 字节 Base64 密钥');
  }
  return key;
}

function buildAad({ method, path, timestamp, nonce }) {
  return Buffer.from([
    VERSION,
    String(method || 'POST').toUpperCase(),
    String(path || '/v1/query'),
    String(timestamp),
    String(nonce)
  ].join('\n'));
}

function encryptEnvelope(payload, options) {
  const timestamp = Number(options.timestamp || Date.now());
  const nonce = options.nonce || crypto.randomBytes(16).toString('hex');
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', decodeSecret(options.secret), iv);
  cipher.setAAD(buildAad({ ...options, timestamp, nonce }));
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(payload), 'utf8'),
    cipher.final()
  ]);

  return {
    v: VERSION,
    timestamp,
    nonce,
    iv: iv.toString('base64'),
    ciphertext: ciphertext.toString('base64'),
    tag: cipher.getAuthTag().toString('base64')
  };
}

function decryptEnvelope(envelope, options) {
  if (!envelope || envelope.v !== VERSION) throw new Error('不支持的加密协议版本');
  const timestamp = Number(envelope.timestamp);
  const now = Number(options.now || Date.now());
  if (!Number.isFinite(timestamp) || Math.abs(now - timestamp) > (options.maxClockSkewMs || MAX_CLOCK_SKEW_MS)) {
    throw new Error('请求时间戳已过期');
  }
  if (!/^[a-f0-9]{32}$/i.test(String(envelope.nonce || ''))) throw new Error('无效 nonce');

  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    decodeSecret(options.secret),
    Buffer.from(envelope.iv || '', 'base64')
  );
  decipher.setAAD(buildAad({
    ...options,
    timestamp,
    nonce: envelope.nonce
  }));
  decipher.setAuthTag(Buffer.from(envelope.tag || '', 'base64'));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(envelope.ciphertext || '', 'base64')),
    decipher.final()
  ]);
  return JSON.parse(plaintext.toString('utf8'));
}

class ReplayCache {
  constructor(ttlMs = MAX_CLOCK_SKEW_MS * 2) {
    this.ttlMs = ttlMs;
    this.entries = new Map();
  }

  consume(nonce, now = Date.now()) {
    for (const [key, expiresAt] of this.entries) {
      if (expiresAt <= now) this.entries.delete(key);
    }
    if (this.entries.has(nonce)) return false;
    this.entries.set(nonce, now + this.ttlMs);
    return true;
  }
}

module.exports = {
  VERSION,
  MAX_CLOCK_SKEW_MS,
  decodeSecret,
  encryptEnvelope,
  decryptEnvelope,
  ReplayCache
};
