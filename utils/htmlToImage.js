const fs = require('fs');
const path = require('path');
const { getBrowserLaunchOptions } = require('./browserOptions');
const { injectCjkFontHtml } = require('./cjkFont');
const logger = require('./logger');

let puppeteerPromise;

async function loadPuppeteer() {
  if (!puppeteerPromise) {
    puppeteerPromise = import('puppeteer').then((mod) => mod.default || mod);
  }
  return puppeteerPromise;
}

async function htmlToImage({
  html,
  output,
  puppeteerArgs,
  selector = 'body',
  skipCjkInject = false,
  settleMs = 0,
  waitForReady = false
} = {}) {
  if (!html) {
    throw new Error('htmlToImage 需要 html');
  }
  if (!output) {
    throw new Error('htmlToImage 需要 output');
  }

  fs.mkdirSync(path.dirname(output), { recursive: true });

  const puppeteer = await loadPuppeteer();
  const launchOptions = {
    ...getBrowserLaunchOptions(),
    ...puppeteerArgs
  };
  logger.debug('启动浏览器', {
    executablePath: launchOptions.executablePath || 'puppeteer默认'
  });
  const browser = await puppeteer.launch(launchOptions);

  try {
    const page = await browser.newPage();
    const pageHtml = skipCjkInject ? html : injectCjkFontHtml(html);
    await page.setContent(pageHtml, { waitUntil: 'load' });
    await page.evaluate(async () => {
      if (document.fonts && document.fonts.ready) {
        await document.fonts.ready;
      }
    });
    if (waitForReady) {
      await page.waitForFunction(
        () => document.documentElement.getAttribute('data-charts-ready') === '1',
        { timeout: 20000 }
      );
    }
    if (settleMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, settleMs));
    }

    const size = await page.evaluate((targetSelector) => {
      const target = document.querySelector(targetSelector) || document.body;
      const rect = target.getBoundingClientRect();
      return {
        width: Math.max(Math.ceil(rect.width || target.scrollWidth || 1), 1),
        height: Math.max(Math.ceil(rect.height || target.scrollHeight || 1), 1)
      };
    }, selector);

    await page.setViewport({
      width: size.width,
      height: size.height,
      deviceScaleFactor: 1
    });

    const element = await page.$(selector);
    if (!element) {
      throw new Error(`找不到截图选择器 ${selector}`);
    }

    await element.screenshot({ path: output, type: 'png' });
  } finally {
    await browser.close();
  }
}

module.exports = {
  loadPuppeteer,
  htmlToImage
};
