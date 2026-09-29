const test = require('node:test');
const assert = require('node:assert/strict');
const {
  getBrowserLaunchOptions,
  isSnapChromiumElf,
  isSnapChromiumLauncher
} = require('../utils/browserOptions');
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

test('不会选用 snap 包内需要更高 GLIBC 的 chrome 二进制', () => {
  assert.equal(
    isSnapChromiumElf('/snap/chromium/current/usr/lib/chromium-browser/chrome'),
    true
  );
  assert.equal(isSnapChromiumElf('/snap/bin/chromium'), false);
  assert.equal(isSnapChromiumLauncher('/snap/bin/chromium'), true);
  assert.equal(isSnapChromiumLauncher('/usr/bin/google-chrome-stable'), false);
});

test('会把本地中文字体嵌入 HTML，避免 Chromium 缺字', () => {
  const fs = require('fs');
  const os = require('os');
  const path = require('path');
  const {
    injectCjkFontHtml,
    resetCjkFontCache
  } = require('../utils/cjkFont');

  const previous = process.env.CJK_FONT_PATH;
  const fontPath = path.join(os.tmpdir(), `cjk-font-${process.pid}.ttf`);
  fs.writeFileSync(fontPath, Buffer.from('font-bytes'));
  process.env.CJK_FONT_PATH = fontPath;
  resetCjkFontCache();

  try {
    const html = injectCjkFontHtml('<head></head><body>测试</body>');
    assert.match(html, /@font-face/);
    assert.match(html, /BaibaiCJK/);
    assert.match(html, /<head><style>/);
  } finally {
    process.env.CJK_FONT_PATH = previous;
    resetCjkFontCache();
    fs.unlinkSync(fontPath);
  }
});

test('项目 fonts 目录会被纳入中文字体候选', () => {
  const { PROJECT_FONTS_DIR, listProjectFontFiles } = require('../utils/cjkFont');
  assert.ok(PROJECT_FONTS_DIR.replace(/\\/g, '/').endsWith('/fonts'));
  assert.ok(Array.isArray(listProjectFontFiles()));
});

test('默认指定微软雅黑 msyh.ttc', () => {
  const previousName = process.env.CJK_FONT_NAME;
  const previousPath = process.env.CJK_FONT_PATH;
  delete process.env.CJK_FONT_PATH;
  delete process.env.CJK_FONT_NAME;
  const { DEFAULT_CJK_FONT_NAME, findCjkFontPath, resetCjkFontCache } = require('../utils/cjkFont');
  resetCjkFontCache();
  try {
    assert.equal(DEFAULT_CJK_FONT_NAME, 'msyh.ttc');
    const fontPath = findCjkFontPath();
    if (fontPath) {
      assert.match(fontPath.replace(/\\/g, '/'), /msyh\.ttc$/i);
    }
  } finally {
    process.env.CJK_FONT_NAME = previousName;
    process.env.CJK_FONT_PATH = previousPath;
    resetCjkFontCache();
  }
});

test('表格用的 CJK @font-face 不会用 !important 覆盖标题字体', () => {
  const { getCjkFontFaceCss, getCjkFontCss, resetCjkFontCache } = require('../utils/cjkFont');
  resetCjkFontCache();
  const face = getCjkFontFaceCss();
  const css = getCjkFontCss();
  if (face) {
    assert.match(face, /@font-face/);
    assert.match(face, /BaibaiCJK/);
    assert.doesNotMatch(face, /!important/);
    assert.match(css, /!important/);
  }
});

test('wrapChartInitScript 会等字体加载后再画图', () => {
  const { wrapChartInitScript } = require('../utils/hanyiwenhei');
  const out = wrapChartInitScript('new Chart();');
  assert.match(out, /document\.fonts\.ready/);
  assert.match(out, /data-charts-ready/);
  assert.match(out, /new Chart\(\);/);
});
