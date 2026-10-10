/**
 * 打开搜索结果中的原网页，抽出正文交给模型整理。
 * 打不开时返回说明，不向外抛错。
 */

const axios = require('axios');
const cheerio = require('cheerio');
const iconv = require('iconv-lite');
const logger = require('../../../utils/logger');

const PRIVATE_HOSTS = new Set(['localhost', '0.0.0.0', '::1']);

function readPositiveInt(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : fallback;
}

function pageTimeoutMs() {
  return readPositiveInt(process.env.WEB_SEARCH_PAGE_TIMEOUT_MS, readPositiveInt(process.env.WEB_SEARCH_TIMEOUT_MS, 15000));
}

function pageMaxChars() {
  return Math.min(20000, readPositiveInt(process.env.WEB_SEARCH_PAGE_MAX_CHARS, 6000));
}

function pageMaxUrls() {
  return Math.min(5, readPositiveInt(process.env.WEB_SEARCH_PAGE_MAX_URLS, 3));
}

function isPrivateIp(hostname) {
  const host = String(hostname || '').toLowerCase().replace(/^\[|\]$/g, '');
  if (PRIVATE_HOSTS.has(host) || host.endsWith('.local') || host.endsWith('.internal')) return true;
  if (host === '::1' || host.startsWith('fe80:') || host.startsWith('fc') || host.startsWith('fd')) return true;

  const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!ipv4) return false;
  const parts = ipv4.slice(1).map(Number);
  if (parts.some((part) => part > 255)) return true;
  const [a, b] = parts;
  return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

function canonicalUrl(value) {
  const url = new URL(String(value || '').trim());
  if (!['http:', 'https:'].includes(url.protocol) || isPrivateIp(url.hostname)) {
    const error = new Error('不支持的网页地址');
    error.code = 'PAGE_URL_REJECTED';
    throw error;
  }
  url.hash = '';
  url.hostname = url.hostname.toLowerCase();
  if ((url.protocol === 'https:' && url.port === '443') || (url.protocol === 'http:' && url.port === '80')) {
    url.port = '';
  }
  url.pathname = url.pathname.replace(/\/+$/, '') || '/';
  return url.toString();
}

function extractPageText(html, maxChars = pageMaxChars()) {
  const $ = cheerio.load(String(html || ''));
  $('script,style,noscript,iframe,svg,canvas').remove();
  const title = $('title').first().text().replace(/\s+/g, ' ').trim();
  const source = $('article').text().trim() || $('main').text().trim() || $('body').text().trim();
  const text = source
    .replace(/\r/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim()
    .slice(0, maxChars);
  return { title, text };
}

function decodeHtml(buffer, headers) {
  const contentType = String(headers?.['content-type'] || '');
  const fromHeader = /charset=([^;]+)/i.exec(contentType)?.[1]?.trim().replace(/["']/g, '');
  const head = Buffer.from(buffer).slice(0, 2048).toString('latin1');
  const fromMeta = /charset=["']?([\w-]+)/i.exec(head)?.[1];
  const charset = [fromHeader, fromMeta].find((item) => item && iconv.encodingExists(item)) || 'utf-8';
  return iconv.decode(Buffer.from(buffer), charset);
}

function defaultGet(url, config) {
  return axios.get(url, config);
}

function logPageDetail(url, ok, extra) {
  logger.debug('[web_page]详情', { url, ok, ...extra });
}

async function readOne(target, get) {
  let url;
  try {
    url = canonicalUrl(target);
  } catch (error) {
    logPageDetail(String(target || ''), false, { reason: '地址无效' });
    return { ok: false, url: String(target || ''), reason: '地址无效' };
  }

  try {
    const response = await get(url, {
      timeout: pageTimeoutMs(),
      maxRedirects: 2,
      maxContentLength: 1_500_000,
      responseType: 'arraybuffer',
      headers: {
        Accept: 'text/html,application/xhtml+xml',
        'User-Agent': 'Mozilla/5.0 (compatible; BaibaiBot/2.0)'
      }
    });
    const status = response?.status || 200;
    if (status >= 400) {
      const error = new Error(`HTTP ${status}`);
      error.status = status;
      throw error;
    }
    const html = decodeHtml(response.data, response.headers);
    const page = extractPageText(html);
    if (!page.text) {
      logPageDetail(url, false, { reason: '没有正文', title: page.title });
      return { ok: false, url, title: page.title, reason: '没有正文' };
    }
    logPageDetail(url, true, { title: page.title, chars: page.text.length, content: page.text.slice(0, 500) });
    return { ok: true, url, title: page.title, text: page.text };
  } catch (error) {
    const reason = error?.code === 'ECONNABORTED' || error?.code === 'PAGE_TIMEOUT' ? '超时' : '打不开';
    logPageDetail(url, false, { reason, status: error?.response?.status || error?.status });
    return { ok: false, url, reason };
  }
}

async function readPages(urls, dependencies = {}) {
  const list = [...new Set((Array.isArray(urls) ? urls : [urls]).map((item) => String(item || '').trim()).filter(Boolean))]
    .slice(0, pageMaxUrls());
  if (!list.length) {
    logger.warn('[web_page]读取了0篇原文：缺少地址');
    return {
      ok: false,
      count: 0,
      modelContent: '没有可打开的网页。请根据已有搜索摘要整理回答，并说明没能查看原文。'
    };
  }

  const get = dependencies.get || defaultGet;
  const pages = [];
  for (const url of list) {
    pages.push(await readOne(url, get));
  }
  const opened = pages.filter((page) => page.ok);
  const failed = pages.length - opened.length;
  if (opened.length) logger.info(`[web_page]读取了${opened.length}篇原文`);
  if (failed) logger.warn(`[web_page]有${failed}篇原文没有打开`);
  const sections = pages.map((page, index) => {
    if (!page.ok) return `原文 ${index + 1} 未能打开：${page.url}\n原因：${page.reason}`;
    return `原文 ${index + 1}：${page.title || '无标题'}\n${page.url}\n${page.text}`;
  });
  return {
    ok: opened.length > 0,
    count: opened.length,
    modelContent: [
      sections.join('\n\n'),
      '请根据以上原文和之前的搜索摘要整理最终回答，附上链接。不要把正文原样发给用户。打不开的页面用已有摘要补充，并说明没能打开原文。'
    ].join('\n\n')
  };
}

module.exports = {
  canonicalUrl,
  extractPageText,
  isPrivateIp,
  pageMaxUrls,
  readPages
};
