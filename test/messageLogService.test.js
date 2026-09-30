const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createMessageLogService,
  buildMessageDoc,
  SELF_USER_ID,
  SELF_USER_NAME,
  SEND_EVENT_TYPE,
  resolveChannelType
} = require('../services/messageLogService');

function createMemoryCollection() {
  const docs = [];
  return {
    docs,
    async insertOne(doc) {
      if (doc.messageId && docs.some((item) => item.messageId === doc.messageId)) {
        const error = new Error('duplicate');
        error.code = 11000;
        throw error;
      }
      docs.push({ ...doc });
      return { insertedId: docs.length };
    }
  };
}

function createService({ collection, configured = true, now } = {}) {
  const lines = [];
  return {
    lines,
    service: createMessageLogService({
      isConfigured: () => configured,
      getCollection: async () => collection,
      now: now || (() => new Date('2026-09-30T03:00:00+08:00')),
      logger: {
        warn() {},
        message(payload) {
          lines.push(['in', payload]);
        },
        reply(payload) {
          lines.push(['out', payload]);
        }
      }
    })
  };
}

test('入库 type 使用官方英文，不存中文', () => {
  assert.equal(resolveChannelType('群'), 'group');
  assert.equal(resolveChannelType('私聊'), 'c2c');
  assert.equal(resolveChannelType('频道'), 'channel');
  assert.equal(resolveChannelType('频道私信'), 'dm');
  assert.equal(resolveChannelType('GROUP'), 'group');
  assert.equal(resolveChannelType('c2c'), 'c2c');
  assert.equal(resolveChannelType('未知'), null);
});

test('消息文档包含通道、事件、会话、用户、正文、isSelf 和时间', () => {
  const doc = buildMessageDoc({
    type: '群',
    eventType: 'GROUP_MESSAGE_CREATE',
    groupId: 'group-openid',
    groupName: '测试群',
    userId: 'member-openid',
    userName: '芙兰',
    content: 'mbtv 亚特',
    messageId: 'msg-1',
    timestamp: '2026-09-30T03:00:00+08:00',
    isSelf: false
  });

  assert.equal(doc.type, 'group');
  assert.equal(doc.eventType, 'GROUP_MESSAGE_CREATE');
  assert.equal(doc.sessionName, '测试群');
  assert.equal(doc.sessionId, 'group-openid');
  assert.equal(doc.userName, '芙兰');
  assert.equal(doc.userId, 'member-openid');
  assert.equal(doc.content, 'mbtv 亚特');
  assert.equal(doc.isSelf, false);
  assert.equal(doc.isBot, false);
  assert.equal(doc.messageId, 'msg-1');
  assert.equal(doc.ts, Date.parse('2026-09-30T03:00:00+08:00'));
  assert.equal(doc.time.getTime(), doc.ts);
});

test('私聊没有会话 id 时不写入占位符；发出的消息记为百百且 eventType 为 SEND_MESSAGE', () => {
  const incoming = buildMessageDoc({
    type: '私聊',
    eventType: 'C2C_MESSAGE_CREATE',
    groupId: '-',
    userId: 'user-openid',
    userName: '芙兰朵露',
    content: '1+1',
    messageId: 'c2c-1'
  });
  const otherBot = buildMessageDoc({
    type: '群',
    eventType: 'GROUP_MESSAGE_CREATE',
    groupId: 'g1',
    userId: 'other-bot',
    userName: '别的机器人',
    content: 'hi',
    isBot: true
  });
  const outgoing = buildMessageDoc({
    type: '私聊',
    groupId: '-',
    userId: 'user-openid',
    userName: '芙兰朵露',
    content: '2',
    isSelf: true
  }, () => new Date('2026-09-30T03:01:00+08:00'));

  assert.equal(incoming.type, 'c2c');
  assert.equal(incoming.sessionId, null);
  assert.equal(incoming.isSelf, false);
  assert.equal(incoming.isBot, false);
  assert.equal(otherBot.type, 'group');
  assert.equal(otherBot.isSelf, false);
  assert.equal(otherBot.isBot, true);
  assert.equal(otherBot.userId, 'other-bot');
  assert.equal(outgoing.type, 'c2c');
  assert.equal(outgoing.isSelf, true);
  assert.equal(outgoing.isBot, true);
  assert.equal(outgoing.eventType, SEND_EVENT_TYPE);
  assert.equal(outgoing.userId, SELF_USER_ID);
  assert.equal(outgoing.userName, SELF_USER_NAME);
  assert.equal(outgoing.messageId, undefined);
});

test('收到和发出的消息都会写入集合', async () => {
  const collection = createMemoryCollection();
  const { service, lines } = createService({ collection });

  await service.logIncoming({
    type: '频道',
    eventType: 'AT_MESSAGE_CREATE',
    groupId: 'guild-1',
    groupName: '技术交流',
    userId: 'user-1',
    userName: '频道昵称',
    content: '/meu 释魂',
    messageId: 'guild-msg-1'
  });
  await service.logOutgoing({
    type: '频道',
    groupId: 'guild-1',
    groupName: '技术交流',
    userId: 'user-1',
    userName: '频道昵称',
    content: '查询结果'
  });
  await service.persist({
    type: '频道私信',
    eventType: 'DIRECT_MESSAGE_CREATE',
    groupId: 'guild-dm',
    userId: 'user-2',
    content: '你好',
    messageId: 'dm-1'
  });

  assert.equal(lines[0][0], 'in');
  assert.equal(lines[1][0], 'out');
  assert.equal(collection.docs.length, 3);
  assert.equal(collection.docs[0].type, 'channel');
  assert.equal(collection.docs[0].isSelf, false);
  assert.equal(collection.docs[0].isBot, false);
  assert.equal(collection.docs[1].eventType, SEND_EVENT_TYPE);
  assert.equal(collection.docs[1].isSelf, true);
  assert.equal(collection.docs[1].isBot, true);
  assert.equal(collection.docs[1].userId, SELF_USER_ID);
  assert.equal(collection.docs[1].userName, SELF_USER_NAME);
  assert.equal(collection.docs[2].type, 'dm');
});

test('收到的消息即使带 isSelf 也不会标成自己，只按 isBot 标记其它机器人', async () => {
  const collection = createMemoryCollection();
  const { service } = createService({ collection });

  await service.logIncoming({
    type: '群',
    eventType: 'GROUP_MESSAGE_CREATE',
    groupId: 'g1',
    userId: 'other-bot',
    userName: '别的机器人',
    content: '公告',
    messageId: 'bot-msg-1',
    isSelf: true,
    isBot: true
  });

  assert.equal(collection.docs[0].isSelf, false);
  assert.equal(collection.docs[0].isBot, true);
  assert.equal(collection.docs[0].userId, 'other-bot');
  assert.equal(collection.docs[0].userName, '别的机器人');
});

test('相同 messageId 不重复入库', async () => {
  const collection = createMemoryCollection();
  const { service } = createService({ collection });

  await service.persist({
    type: '群',
    eventType: 'GROUP_AT_MESSAGE_CREATE',
    groupId: 'g1',
    userId: 'u1',
    content: 'hi',
    messageId: 'dup-1'
  });
  await service.persist({
    type: '群',
    eventType: 'GROUP_MESSAGE_CREATE',
    groupId: 'g1',
    userId: 'u1',
    content: 'hi',
    messageId: 'dup-1'
  });

  assert.equal(collection.docs.length, 1);
});

test('未配置数据库时仍打日志，不写入', async () => {
  const collection = createMemoryCollection();
  const { service, lines } = createService({ collection, configured: false });

  await service.logIncoming({
    type: '群',
    eventType: 'GROUP_MESSAGE_CREATE',
    groupId: 'g1',
    userId: 'u1',
    content: 'hi',
    messageId: 'g-1'
  });
  const saved = await service.persist({
    type: '群',
    content: 'hi'
  });

  assert.equal(lines.length, 1);
  assert.equal(saved, null);
  assert.equal(collection.docs.length, 0);
});
