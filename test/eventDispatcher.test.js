const test = require('node:test');
const assert = require('node:assert/strict');
const { dispatchEvent } = require('../events/eventDispatcher');
const { resolveGroupOpenid } = require('../handlers/groupMessageHandler');
const { EVENT_TYPE } = require('../utils/constants');

function createHandlers(calls) {
  return {
    handleChannelAtMessage: async (...args) => calls.push(['channel', ...args]),
    handleGroupAtMessage: async (...args) => calls.push(['group', ...args]),
    handleC2CMessage: async (...args) => calls.push(['c2c', ...args]),
    handleDirectMessage: async (...args) => calls.push(['direct', ...args])
  };
}

test('四类消息事件分发到对应 handler', async () => {
  const calls = [];
  const handlers = createHandlers(calls);
  const event = { id: 'message-id' };

  await dispatchEvent(EVENT_TYPE.AT_MESSAGE_CREATE, event, handlers);
  await dispatchEvent(EVENT_TYPE.GROUP_AT_MESSAGE_CREATE, event, handlers);
  await dispatchEvent(EVENT_TYPE.C2C_MESSAGE_CREATE, event, handlers);
  await dispatchEvent(EVENT_TYPE.DIRECT_MESSAGE_CREATE, event, handlers);

  assert.deepEqual(calls.map(([name]) => name), ['channel', 'group', 'c2c', 'direct']);
  assert.equal(calls[0][2], EVENT_TYPE.AT_MESSAGE_CREATE);
  assert.equal(calls[1][2], EVENT_TYPE.GROUP_AT_MESSAGE_CREATE);
});

test('频道和群全量消息沿用各自 handler', async () => {
  const calls = [];
  const handlers = createHandlers(calls);

  await dispatchEvent(EVENT_TYPE.MESSAGE_CREATE, {}, handlers);
  await dispatchEvent(EVENT_TYPE.GROUP_MESSAGE_CREATE, {}, handlers);

  assert.deepEqual(calls.map(([name]) => name), ['channel', 'group']);
});

test('群回复标识兼容 group_openid 和 group_id', () => {
  assert.equal(
    resolveGroupOpenid({ group_openid: 'openid', group_id: 'legacy-id' }),
    'openid'
  );
  assert.equal(resolveGroupOpenid({ group_id: 'legacy-id' }), 'legacy-id');
  assert.equal(resolveGroupOpenid({}), null);
});
