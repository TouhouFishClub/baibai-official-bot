const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');

const temporaryRoot = path.join(os.tmpdir(), `baibai-local-command-${process.pid}`);
process.env.QA_STORE_PATH = path.join(temporaryRoot, 'qa');
process.env.IMAGE_DATA_DIR = path.join(temporaryRoot, 'images');
process.env.QA_WRITE_USER_IDS = 'admin-user';

const {
  executeCommand,
  executeInput,
  executeMessage,
  parseCommand
} = require('../services/localCommandService');

test.after(async () => {
  await fs.rm(temporaryRoot, { recursive: true, force: true });
});

test('统一解析有斜杠和无斜杠命令', () => {
  assert.deepEqual(parseCommand('/mbi 工程手套'), {
    command: 'mbi',
    content: '工程手套'
  });
  assert.deepEqual(parseCommand('普通问答'), {
    command: null,
    content: '普通问答'
  });
  assert.deepEqual(parseCommand('mblogs 布里列赫'), {
    command: 'mblogs',
    content: '布里列赫'
  });
  assert.deepEqual(parseCommand('mbtvs 稀有卷'), {
    command: 'mbtvs',
    content: '稀有卷'
  });
  assert.deepEqual(parseCommand('mbzz 铠甲'), {
    command: 'mbzz',
    content: '铠甲'
  });
});

test('桥接未配置时数据库命令稳定降级', async () => {
  const result = await executeCommand('mbtv', '', {});
  assert.equal(result.status, 'ok');
  assert.match(result.data.message, /数据库桥接服务暂不可用/);

  const calendar = await executeMessage('测试日历', {
    groupId: 'group-a',
    userId: 'user-a'
  });
  assert.match(calendar.data.message, /依赖.*数据库/);
});

test('QA 按群隔离并限制写权限', async () => {
  const denied = await executeMessage('关键词|回答', {
    groupId: 'group-a',
    userId: 'normal-user'
  });
  assert.equal(denied.data.message, '此功能仅限管理员使用');

  const created = await executeMessage('关键词|回答', {
    groupId: 'group-a',
    groupName: 'A群',
    userId: 'admin-user',
    userName: '管理员'
  });
  assert.equal(created.data.message, '关键词已添加');

  const found = await executeMessage('关键词', {
    groupId: 'group-a',
    userId: 'normal-user'
  });
  assert.equal(found.data.message, '回答');

  const isolated = await executeMessage('关键词', {
    groupId: 'group-b',
    userId: 'normal-user'
  });
  assert.equal(isolated.data, null);
});

test('QA 同群并发写不会损坏 JSON', async () => {
  await Promise.all(
    Array.from({ length: 10 }, (_, index) =>
      executeMessage(`并发${index}|回答${index}`, {
        groupId: 'concurrent-group',
        userId: 'admin-user'
      })
    )
  );

  const file = path.join(process.env.QA_STORE_PATH, 'concurrent-group.json');
  const store = JSON.parse(await fs.readFile(file, 'utf8'));
  assert.equal(Object.keys(store.entries).length, 10);
});

test('QA 删除与计算器 fallback', async () => {
  await executeMessage('待删除|内容', {
    groupId: 'delete-group',
    userId: 'admin-user'
  });
  const removed = await executeMessage('待删除|', {
    groupId: 'delete-group',
    userId: 'admin-user'
  });
  assert.equal(removed.data.message, '关键词已删除');

  const calculation = await executeMessage('1+2', {
    groupId: 'delete-group',
    userId: 'normal-user'
  });
  assert.equal(calculation.data.message, '1+2=3');
});

test('普通消息直接进入本地分发而不是通用命令', async () => {
  const result = await executeInput('今日专家', {
    groupId: 'message-group',
    userId: 'normal-user'
  });
  assert.match(result.data.message, /专家地下城/);
});

test('未知普通消息静默处理', async () => {
  const result = await executeInput('没有配置过的普通聊天内容', {
    groupId: 'message-group',
    userId: 'normal-user'
  });
  assert.equal(result.status, 'ok');
  assert.equal(result.data, null);
});
