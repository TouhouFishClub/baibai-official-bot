const test = require('node:test');
const assert = require('node:assert/strict');
const {
  QQ_API_ROOT,
  validateTypedMessage
} = require('../services/messageService');

test('QQ OpenAPI 默认使用现行官方域名', () => {
  assert.equal(QQ_API_ROOT, 'https://api.bot.qq.com');
});

test('群聊和单聊消息体按 msg_type 校验', () => {
  assert.doesNotThrow(() => validateTypedMessage({
    msg_type: 0,
    content: '文本'
  }));
  assert.doesNotThrow(() => validateTypedMessage({
    msg_type: 2,
    markdown: { content: '# 标题' }
  }));
  assert.doesNotThrow(() => validateTypedMessage({
    msg_type: 7,
    media: { file_info: 'file-info' }
  }));

  assert.throws(
    () => validateTypedMessage({ msg_type: 0, content: '' }),
    /文本消息内容不能为空/
  );
  assert.throws(
    () => validateTypedMessage({ msg_type: 7 }),
    /media\.file_info/
  );
});
