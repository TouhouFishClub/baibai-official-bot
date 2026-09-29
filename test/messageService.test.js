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

test('频道图片 FormData 使用 file_image 而不是公网 URL', () => {
  const fs = require('fs');
  const os = require('os');
  const path = require('path');
  const {
    createChannelImageForm,
    isFormDataPayload,
    prepareGuildMessage
  } = require('../services/messageService');
  const filePath = path.join(os.tmpdir(), `channel-img-${process.pid}.png`);
  fs.writeFileSync(filePath, Buffer.from([0x89, 0x50, 0x4e, 0x47]));

  try {
    const form = createChannelImageForm({ filePath, content: 'hi', msgId: 'm1' });
    assert.equal(isFormDataPayload(form), true);
    assert.equal(form.has('file_image'), true);
    assert.equal(form.has('image'), false);
    assert.equal(form.get('content'), 'hi');
    assert.equal(form.get('msg_id'), 'm1');
    assert.equal(form.get('file_image').name, path.basename(filePath));

    const prepared = prepareGuildMessage(form, 'eid', 'm1');
    assert.equal(prepared.json, false);
    assert.equal(prepared.data, form);
    assert.equal(prepared.data.get('event_id'), 'eid');
    assert.equal(prepared.data.has('file_image'), true);
  } finally {
    fs.unlinkSync(filePath);
  }
});

test('频道 JSON 消息仍附加 msg_id，缺少本地图时拒绝组 FormData', () => {
  const {
    createChannelImageForm,
    prepareGuildMessage
  } = require('../services/messageService');
  const json = prepareGuildMessage({ content: 'ok' }, null, 'mid');
  assert.equal(json.json, true);
  assert.equal(json.data.msg_id, 'mid');
  assert.equal(json.data.content, 'ok');
  assert.throws(
    () => createChannelImageForm({ filePath: '' }),
    /缺少本地图片文件/
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
