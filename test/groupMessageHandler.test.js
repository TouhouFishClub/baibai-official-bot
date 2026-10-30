const test = require('node:test');
const assert = require('node:assert/strict');
const { EVENT_TYPE } = require('../utils/constants');
const {
  handleGroupAtMessage,
  normalizeGroupInbound
} = require('../handlers/groupMessageHandler');

const BOT_ID = '5790D0C99DF61805781F384B0A32DB9D';

test('全量消息@自己时去掉机器人提及，保留其余正文', () => {
  const result = normalizeGroupInbound(EVENT_TYPE.GROUP_MESSAGE_CREATE, {
    content: `<@${BOT_ID}> 111111111111111`,
    mentions: [{ id: BOT_ID, member_openid: BOT_ID, is_you: true }]
  });

  assert.equal(result.accept, true);
  assert.equal(result.content, '111111111111111');
});

test('全量消息只删除@自己的标记，其他人的提及留在正文里', () => {
  const result = normalizeGroupInbound(EVENT_TYPE.GROUP_MESSAGE_CREATE, {
    content: `<@${BOT_ID}> <@OTHER123> /mbi 释魂`,
    mentions: [
      { member_openid: BOT_ID, is_you: true },
      { id: 'OTHER123', is_you: false }
    ]
  });

  assert.equal(result.accept, true);
  assert.equal(result.content, '<@OTHER123> /mbi 释魂');
});

test('全量消息支持 <@!id> 写法', () => {
  const result = normalizeGroupInbound(EVENT_TYPE.GROUP_MESSAGE_CREATE, {
    content: `<@!${BOT_ID}> /meu 释魂`,
    mentions: [{ user_openid: BOT_ID, is_you: true }]
  });

  assert.equal(result.accept, true);
  assert.equal(result.content, '/meu 释魂');
});

test('未@自己、@其他人、@全体和不可靠标记都不接收', () => {
  const cases = [
    { content: '大家早上好', mentions: [] },
    { content: '<@OTHER123> 你好', mentions: [{ id: 'OTHER123', is_you: false, bot: true }] },
    { content: '<@all> 集合', mentions: [{ id: 'all', is_you: true }] },
    { content: `<@${BOT_ID}> 你好`, mentions: [{ id: BOT_ID, is_you: 'true' }] },
    { content: `<@${BOT_ID}> 你好`, mentions: [{ id: BOT_ID, is_you: 1 }] },
    { content: `<@${BOT_ID}> 你好`, mentions: [{ id: BOT_ID, bot: true }] },
    { content: `<@${BOT_ID}> 你好`, mentions: [{ id: 'not-in-content', is_you: true }] },
    { content: `<@${'x'.repeat(129)}> 你好`, mentions: [{ id: 'x'.repeat(129), is_you: true }] }
  ];

  for (const eventData of cases) {
    const result = normalizeGroupInbound(EVENT_TYPE.GROUP_MESSAGE_CREATE, eventData);
    assert.equal(result.accept, false, eventData.content);
  }
});

test('未开全量时的@事件沿用平台已去掉前缀的正文', () => {
  const result = normalizeGroupInbound(EVENT_TYPE.GROUP_AT_MESSAGE_CREATE, {
    content: ' 111111111111111 ',
    mentions: [{ id: 'OTHER123', is_you: false }]
  });

  assert.equal(result.accept, true);
  assert.equal(result.content, '111111111111111');
});

test('未@自己的全量消息在进入本地处理前返回', async () => {
  await handleGroupAtMessage({
    id: 'message-not-self',
    content: '<@OTHER123> 你好',
    mentions: [{ id: 'OTHER123', is_you: false }],
    author: { id: 'user-1' },
    group_openid: 'group-1'
  }, EVENT_TYPE.GROUP_MESSAGE_CREATE);
});
