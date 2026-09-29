const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const {
  createClient,
  BridgeUnavailableError
} = require('../services/legacyDataBridgeClient');
const {
  decryptEnvelope,
  encryptEnvelope
} = require('../legacy-data-bridge/shared/cryptoEnvelope');

test('桥接客户端加密请求并解密响应', async () => {
  const secret = crypto.randomBytes(32).toString('base64');
  const transport = { secret, method: 'POST', path: '/v1/query' };
  const httpClient = {
    async post(url, envelope) {
      assert.equal(url, 'https://old.example.test/v1/query');
      assert.doesNotMatch(JSON.stringify(envelope), /稀有道具/);
      assert.deepEqual(decryptEnvelope(envelope, transport), {
        operation: 'television.mbtv',
        params: { content: '稀有道具' }
      });
      return {
        status: 200,
        data: encryptEnvelope({
          ok: true,
          requestNonce: envelope.nonce,
          data: { rows: [{ reward: '稀有道具' }] }
        }, transport)
      };
    }
  };
  const client = createClient({
    baseURL: 'https://old.example.test',
    secret,
    timeout: 1000
  }, httpClient);

  assert.deepEqual(await client.television('mbtv', { content: '稀有道具' }), {
    rows: [{ reward: '稀有道具' }]
  });
});

test('缺少配置时稳定降级为桥接不可用错误', () => {
  assert.throws(
    () => createClient({ baseURL: '', secret: '', timeout: 1000 }),
    BridgeUnavailableError
  );
});
