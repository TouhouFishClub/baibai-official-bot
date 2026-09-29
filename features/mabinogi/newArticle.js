const path = require("path");
const { IMAGE_DATA } = require(path.join(__dirname, '..', '..', 'baibaiConfigs.js'))
const puppeteer = require('puppeteer');
const { getBrowserLaunchOptions } = require('../../utils/browserOptions');

const tcArticle = async (content, callback) => {
  let browser;
  try {
    browser = await puppeteer.launch(getBrowserLaunchOptions({
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
    }));
    const page = await browser.newPage();
    page.setDefaultTimeout(30000);
    await page.goto('https://luoqi.tiancity.com/homepage/article/Class_255_Time_1.html', {
      waitUntil: 'domcontentloaded',
      timeout: 30000
    });
    await page.waitForSelector('ul.newsList li:first-child a');
    const articleUrl = await page.$eval(
      'ul.newsList li:first-child a',
      (element) => element.href
    );
    await page.goto(articleUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForSelector('dl.newCon');
    await page.addStyleTag({
      content: '.mainDt,.bur.cbur,.dur{display:none!important}.cur{min-height:200px!important;height:auto!important}'
    });
    const article = await page.$('dl.newCon');
    const output = path.join(IMAGE_DATA, 'mabi_other', 'article.png');
    await article.screenshot({ path: output });
    callback(`[CQ:image,file=${path.join('send', 'mabi_other', 'article.png')}]`);
  } catch (error) {
    console.error('TC 公告截图失败:', error.message);
    callback('获取 TC 公告失败，请稍后再试');
  } finally {
    if (browser) await browser.close();
  }
}

module.exports = {
  tcArticle
}