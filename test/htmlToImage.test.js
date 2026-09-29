const test = require('node:test');
const assert = require('node:assert/strict');
const { getBrowserLaunchOptions } = require('../utils/browserOptions');
const { htmlToImage, loadPuppeteer } = require('../utils/htmlToImage');

test('浏览器启动参数会合并额外 args 且保留沙箱关闭', () => {
  const options = getBrowserLaunchOptions({
    args: ['--single-process'],
    timeout: 1234
  });

  assert.equal(options.headless, true);
  assert.equal(options.timeout, 1234);
  assert.ok(options.args.includes('--no-sandbox'));
  assert.ok(options.args.includes('--single-process'));
});

test('htmlToImage 封装在加载时不会同步 require puppeteer', () => {
  assert.equal(typeof htmlToImage, 'function');
  assert.equal(typeof loadPuppeteer, 'function');
});
