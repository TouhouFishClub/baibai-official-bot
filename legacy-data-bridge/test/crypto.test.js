const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const {
  encryptEnvelope,
  decryptEnvelope,
  ReplayCache
} = require('../shared/cryptoEnvelope');

const secret = crypto.randomBytes(32).toString('base64');
const options = { secret, method: 'POST', path: '/v1/query' };

test('AES-GCM 信封可往返且不暴露明文', () => {
  const envelope = encryptEnvelope({ operation: 'smuggler.latest', params: {} }, options);
  assert.doesNotMatch(JSON.stringify(envelope), /smuggler/);
  assert.deepEqual(decryptEnvelope(envelope, options), {
    operation: 'smuggler.latest',
    params: {}
  });
});

test('篡改、错误密钥和过期信封会被拒绝', () => {
  const envelope = encryptEnvelope({ value: 1 }, options);
  assert.throws(() => decryptEnvelope(
    { ...envelope, ciphertext: `${envelope.ciphertext.slice(0, -2)}AA` },
    options
  ));
  assert.throws(() => decryptEnvelope(envelope, {
    ...options,
    secret: crypto.randomBytes(32).toString('base64')
  }));

  const expired = encryptEnvelope({ value: 1 }, { ...options, timestamp: Date.now() - 120_000 });
  assert.throws(() => decryptEnvelope(expired, options), /过期/);
});

test('nonce 只能消费一次', () => {
  const cache = new ReplayCache();
  assert.equal(cache.consume('a'), true);
  assert.equal(cache.consume('a'), false);
});
