const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');

const temporaryRoot = path.join(os.tmpdir(), `baibai-adapters-${process.pid}`);
process.env.IMAGE_DATA_DIR = path.join(temporaryRoot, 'images');

const { normalizeModuleResult } = require('../utils/cqResultAdapter');
const {
  formatPlainLink,
  rewriteHtmlLinks,
  toPathOnly
} = require('../services/crawlerService');

test.after(async () => {
  await fsp.rm(temporaryRoot, { recursive: true, force: true });
});

test('CQ 图片转换为标准结果', () => {
  const imageDirectory = path.join(process.env.IMAGE_DATA_DIR, 'mabi');
  fs.mkdirSync(imageDirectory, { recursive: true });
  fs.writeFileSync(path.join(imageDirectory, 'sample.png'), Buffer.from('test-image'));

  const result = normalizeModuleResult('说明文字[CQ:image,file=send/mabi/sample.png]');
  assert.equal(result.type, 'image');
  assert.equal(result.path, 'mabi/sample.png');
  assert.equal(result.message, '说明文字');
  assert.equal(result.base64, Buffer.from('test-image').toString('base64'));
});

test('CQ 图片路径不能越过生成目录', () => {
  const result = normalizeModuleResult('[CQ:image,file=send/../../outside.png]');
  assert.equal(result.type, 'text');
  assert.match(result.message, /图片生成失败/);
});

test('文章链接只保留路径且过滤 javascript 链接', () => {
  assert.equal(
    toPathOnly('https://example.invalid/path?a=1'),
    '/path?a=1'
  );
  assert.equal(
    formatPlainLink('公告', 'https://example.invalid/news/1'),
    '公告[/news/1]'
  );
  assert.equal(
    rewriteHtmlLinks('<a href="javascript:alert(1)">文字</a>'),
    '文字'
  );
});
