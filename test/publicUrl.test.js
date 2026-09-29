const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { joinPublicUrl } = require('../utils/publicUrl');
const {
  computeFileHashes,
  parseUploadTarget,
  resolvePartOffset,
  isRetryableUploadError
} = require('../services/richMediaUpload');

test('公网图片地址会去掉重复斜杠并保留反代前缀', () => {
  const previous = process.env.SERVER_HOST;
  process.env.SERVER_HOST = 'https://example.com/bot/';
  assert.equal(
    joinPublicUrl('/temp_images/a.png'),
    'https://example.com/bot/temp_images/a.png'
  );
  process.env.SERVER_HOST = previous;
});

test('富媒体上传路径能解析群聊和单聊分片接口', () => {
  assert.deepEqual(
    parseUploadTarget('/v2/groups/abc/files'),
    {
      scene: 'group',
      targetId: 'abc',
      preparePath: '/v2/groups/abc/upload_prepare',
      finishPath: '/v2/groups/abc/upload_part_finish',
      completePath: '/v2/groups/abc/files'
    }
  );
  assert.equal(
    parseUploadTarget('/v2/users/xyz/files').preparePath,
    '/v2/users/xyz/upload_prepare'
  );
});

test('分片偏移同时兼容 0 起和 1 起的 part.index', () => {
  assert.equal(resolvePartOffset(0, 0, 1024), 0);
  assert.equal(resolvePartOffset(1, 0, 1024), 1024);
  assert.equal(resolvePartOffset(1, 1, 1024), 0);
  assert.equal(resolvePartOffset(2, 1, 1024), 1024);
});

test('文件校验值包含全文 MD5/SHA1 和前 10MB MD5', () => {
  const buffer = Buffer.from('hello-image');
  const hashes = computeFileHashes(buffer);
  assert.equal(hashes.md5, crypto.createHash('md5').update(buffer).digest('hex'));
  assert.equal(hashes.sha1, crypto.createHash('sha1').update(buffer).digest('hex'));
  assert.equal(hashes.md5_10m, hashes.md5);
});

test('QQ 拉图失败会回退到 URL 上传', () => {
  assert.equal(isRetryableUploadError({
    response: { data: { err_code: 40093007, message: '富媒体文件下载失败' } }
  }), true);
  assert.equal(isRetryableUploadError({
    response: { data: { code: 401 } }
  }), false);
});
