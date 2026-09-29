const test = require('node:test');
const assert = require('node:assert/strict');
const {
  QQ_API_ROOT,
  qqRequestConfig,
  withTimeout,
  validateTypedMessage
} = require('../services/messageService');

test('QQ OpenAPI 默认使用已验证可通的域名', () => {
  assert.equal(QQ_API_ROOT, 'https://api.sgroup.qq.com');
});

test('QQ 请求强制使用 IPv4', () => {
  const config = qqRequestConfig({ 'Content-Type': 'application/json' });
  assert.equal(config.family, 4);
  assert.equal(config.timeout, 15000);
});

test('QQ 请求超时会强制失败并输出日志', async () => {
  await assert.rejects(
    () => withTimeout(new Promise(() => {}), 20, '测试请求'),
    /测试请求 超时/
  );
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
