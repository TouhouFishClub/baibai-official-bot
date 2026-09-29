const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');

const temporaryRoot = path.join(os.tmpdir(), `baibai-auto-push-${process.pid}`);
process.env.PUSH_DATA_DIR = temporaryRoot;

const autoPushService = require('../services/autoPushService');

test.after(async () => {
  await fs.rm(temporaryRoot, { recursive: true, force: true });
});

test('推送配置可创建、读取和删除', async () => {
  await autoPushService.initializeService();
  const saved = await autoPushService.saveConfig({
    name: '测试配置',
    channelId: 'channel-placeholder',
    enabled: false,
    sourceUrl: 'https://example.invalid/articles'
  });

  assert.ok(saved.id);
  assert.equal(autoPushService.getConfig(saved.id).name, '测试配置');
  assert.equal(autoPushService.getAllConfigs().length, 1);

  assert.equal(await autoPushService.deleteConfig(saved.id), true);
  assert.equal(autoPushService.getConfig(saved.id), null);
});
