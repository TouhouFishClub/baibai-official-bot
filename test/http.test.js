const test = require('node:test');
const assert = require('node:assert/strict');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-jwt-secret-that-is-long-enough';
process.env.ADMIN_USERNAME = 'test-admin';
process.env.ADMIN_PASSWORD = 'test-password';
process.env.QQ_BOT_APP_ID = 'test-app-id';
process.env.QQ_BOT_SECRET = 'test-app-secret';

const request = require('supertest');
const { app } = require('../src');
const { generateSignature, verifySignature } = require('../utils/signature');

test('健康状态与本地 OpenAPI 可访问', async () => {
  const health = await request(app).get('/').expect(200);
  assert.equal(health.body.message, 'service ok');

  const openapi = await request(app).get('/openapi').expect(200);
  assert.equal(openapi.body.status, 'ok');
  assert.ok(openapi.body.commands.includes('mblogs'));

  const deferred = await request(app).get('/openapi/mbcd').expect(200);
  assert.match(deferred.body.data.message, /数据库桥接服务暂不可用/);

  await request(app).get('/openapi/uni?content=test').expect(404);
});

test('探针路径不会暴露环境文件', async () => {
  await request(app).get('/.env').expect(404);
});

test('管理登录后可访问受保护状态接口', async () => {
  const login = await request(app)
    .post('/admin/login')
    .send({ username: 'test-admin', password: 'test-password' })
    .expect(200);

  assert.ok(login.body.data.token);
  await request(app)
    .get('/auto-push/configs')
    .set('Authorization', `Bearer ${login.body.data.token}`)
    .expect(200);
});

test('Ed25519 签名可本地生成并验证', () => {
  const signature = generateSignature('test-app-secret', 'timestamp-token');
  assert.equal(verifySignature('test-app-secret', 'timestamp-token', signature), true);
  assert.equal(verifySignature('test-app-secret', 'different-message', signature), false);
});
