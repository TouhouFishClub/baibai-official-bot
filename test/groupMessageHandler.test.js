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

test('未@自己的全量消息仍进入处理，且不会误删提及', () => {
  const cases = [
    { content: '1+1', mentions: [], expected: '1+1' },
    { content: '大家早上好', mentions: [], expected: '大家早上好' },
    {
      content: '<@OTHER123> 你好',
      mentions: [{ id: 'OTHER123', is_you: false, bot: true }],
      expected: '<@OTHER123> 你好'
    },
    { content: '<@all> 集合', mentions: [{ id: 'all', is_you: true }], expected: '<@all> 集合' },
    {
      content: `<@${BOT_ID}> 你好`,
      mentions: [{ id: BOT_ID, is_you: 'true' }],
      expected: `<@${BOT_ID}> 你好`
    },
    {
      content: `<@${BOT_ID}> 你好`,
      mentions: [{ id: BOT_ID, is_you: 1 }],
      expected: `<@${BOT_ID}> 你好`
    },
    {
      content: `<@${BOT_ID}> 你好`,
      mentions: [{ id: BOT_ID, bot: true }],
      expected: `<@${BOT_ID}> 你好`
    },
    {
      content: `<@${BOT_ID}> 你好`,
      mentions: [{ id: 'not-in-content', is_you: true }],
      expected: `<@${BOT_ID}> 你好`
    },
    {
      content: `<@${'x'.repeat(129)}> 你好`,
      mentions: [{ id: 'x'.repeat(129), is_you: true }],
      expected: `<@${'x'.repeat(129)}> 你好`
    }
  ];

  for (const eventData of cases) {
    const result = normalizeGroupInbound(EVENT_TYPE.GROUP_MESSAGE_CREATE, eventData);
    assert.equal(result.accept, true, eventData.content);
    assert.equal(result.content, eventData.expected, eventData.content);
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

test('未@自己的全量消息仍按 info 记录，并进入本地处理', async () => {
  const lines = [];
  const originalLog = console.log;
  const originalLevel = process.env.LOG_LEVEL;
  console.log = (...args) => lines.push(args.join(' '));
  process.env.LOG_LEVEL = 'debug';

  try {
    await handleGroupAtMessage({
      id: 'message-not-self-plain',
      content: '大家早上好',
      mentions: [],
      author: { id: 'user-1' },
      group_openid: 'group-1'
    }, EVENT_TYPE.GROUP_MESSAGE_CREATE);
  } finally {
    console.log = originalLog;
    if (originalLevel === undefined) delete process.env.LOG_LEVEL;
    else process.env.LOG_LEVEL = originalLevel;
  }

  assert.ok(lines.some((line) => (
    /INFO: \[群\]\[GROUP_MESSAGE_CREATE\]\[group-1\]\[user-1\] 大家早上好/.test(line)
  )));
  assert.ok(lines.some((line) => /DEBUG: 群消息本地处理完成/.test(line)));
  assert.equal(lines.some((line) => line.includes('仅记录不处理')), false);
});
