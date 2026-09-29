const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const request = require('supertest');
const { createApp } = require('../src/app');
const { encryptEnvelope, decryptEnvelope } = require('../shared/cryptoEnvelope');

const config = {
  secret: crypto.randomBytes(32).toString('base64'),
  requestLimit: '32kb',
  maxClockSkewMs: 60_000
};
const transport = {
  secret: config.secret,
  method: 'POST',
  path: '/v1/query'
};

test('桥接接口只接受加密请求并返回加密响应', async () => {
  const app = createApp({
    config,
    getDatabase: async () => ({ marker: 'db' }),
    operationExecutor: async (db, operation, params) => ({ operation, params, marker: db.marker })
  });
  const envelope = encryptEnvelope({
    operation: 'television.mbtv',
    params: { content: '测试' }
  }, transport);

  const response = await request(app).post('/v1/query').send(envelope).expect(200);
  assert.doesNotMatch(JSON.stringify(response.body), /测试|television/);
  assert.deepEqual(decryptEnvelope(response.body, transport), {
    ok: true,
    requestNonce: envelope.nonce,
    data: {
      operation: 'television.mbtv',
      params: { content: '测试' },
      marker: 'db'
    }
  });

  await request(app).post('/v1/query').send(envelope).expect(409);
  await request(app).post('/v1/query').send({ plaintext: true }).expect(401);
});
