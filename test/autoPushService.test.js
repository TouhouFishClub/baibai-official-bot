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

test('开启推送后会把开关写入文件，重启后恢复运行', async () => {
  await autoPushService.initializeService();
  const saved = await autoPushService.saveConfig({
    name: '持久化开关',
    channelId: 'channel-placeholder',
    enabled: false,
    sourceUrl: 'https://example.invalid/articles',
    checkInterval: 60 * 60 * 1000
  });

  await autoPushService.startConfigPush(saved.id);
  const startedFile = JSON.parse(
    await fs.readFile(path.join(temporaryRoot, 'push_configs.json'), 'utf8')
  );
  assert.equal(startedFile.find((item) => item.id === saved.id).enabled, true);
  assert.equal(autoPushService.getConfig(saved.id).running, true);

  await autoPushService.initializeService();
  const restored = autoPushService.getConfig(saved.id);
  assert.equal(restored.enabled, true);
  assert.equal(restored.running, true);

  await autoPushService.stopConfigPush(saved.id);
  const stoppedFile = JSON.parse(
    await fs.readFile(path.join(temporaryRoot, 'push_configs.json'), 'utf8')
  );
  assert.equal(stoppedFile.find((item) => item.id === saved.id).enabled, false);
  assert.equal(autoPushService.getConfig(saved.id).running, false);

  await autoPushService.deleteConfig(saved.id);
});
