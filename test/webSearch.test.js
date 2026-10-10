const test = require('node:test');
const assert = require('node:assert/strict');

const savedEnv = {};
for (const key of [
  'WEB_SEARCH_PROVIDER',
  'WEB_SEARCH_TIMEOUT_MS',
  'WEB_SEARCH_MAX_RESULTS',
  'TAVILY_API_KEY',
  'TAVILY_BASE_URL',
  'TAVILY_SEARCH_DEPTH',
  'TAVILY_TOPIC',
  'TAVILY_MAX_RESULTS',
  'TAVILY_CHUNKS_PER_SOURCE',
  'TAVILY_INCLUDE_ANSWER',
  'TAVILY_TIME_RANGE',
  'TAVILY_COUNTRY',
  'TAVILY_LANGUAGE',
  'TAVILY_INCLUDE_DOMAINS',
  'TAVILY_EXCLUDE_DOMAINS',
  'TAVILY_TIMEOUT_MS',
  'LOG_LEVEL'
]) {
  savedEnv[key] = process.env[key];
}

const { buildSearchBody } = require('../services/webSearch/tavily/client');
const { readTavilyConfig } = require('../services/webSearch/tavily/config');
const { isWebSearchEnabled, searchWeb } = require('../services/webSearch');

function useTavilyEnv() {
  process.env.WEB_SEARCH_PROVIDER = 'tavily';
  process.env.TAVILY_API_KEY = 'tvly-test';
  process.env.TAVILY_BASE_URL = 'https://api.tavily.com';
  process.env.TAVILY_SEARCH_DEPTH = 'basic';
  process.env.TAVILY_TOPIC = 'general';
  process.env.TAVILY_MAX_RESULTS = '5';
  process.env.TAVILY_CHUNKS_PER_SOURCE = '3';
  process.env.TAVILY_INCLUDE_ANSWER = 'false';
  process.env.TAVILY_TIME_RANGE = 'week';
  process.env.TAVILY_COUNTRY = 'china';
  process.env.TAVILY_LANGUAGE = 'zh-cn';
  process.env.TAVILY_INCLUDE_DOMAINS = 'luoqi.tiancity.com, example.com';
  process.env.TAVILY_EXCLUDE_DOMAINS = 'spam.example';
  process.env.TAVILY_TIMEOUT_MS = '8000';
}

test.after(() => {
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

test('网络搜索按提供商查询且失败不抛错', async (t) => {
await t.test('Tavily 请求遵循搜索接口字段', () => {
  useTavilyEnv();
  const body = buildSearchBody('洛奇 活动', { topic: 'news' }, readTavilyConfig());
  assert.equal(body.query, '洛奇 活动');
  assert.equal(body.search_depth, 'basic');
  assert.equal(body.topic, 'news');
  assert.equal(body.max_results, 5);
  assert.equal(body.chunks_per_source, 3);
  assert.equal(body.include_answer, false);
  assert.equal(body.include_usage, true);
  assert.equal(body.time_range, 'week');
  assert.equal(body.country, undefined);
  assert.equal(body.language, 'zh-cn');
  assert.deepEqual(body.include_domains, ['luoqi.tiancity.com', 'example.com']);
  assert.deepEqual(body.exclude_domains, ['spam.example']);
  assert.equal(isWebSearchEnabled(), true);

  process.env.WEB_SEARCH_MAX_RESULTS = '5';
  process.env.TAVILY_MAX_RESULTS = '10';
  assert.equal(readTavilyConfig().maxResults, 10);
  delete process.env.TAVILY_MAX_RESULTS;
  assert.equal(readTavilyConfig().maxResults, 5);
  process.env.TAVILY_MAX_RESULTS = '20';
  assert.equal(readTavilyConfig().maxResults, 20);
  process.env.TAVILY_MAX_RESULTS = '99';
  assert.equal(readTavilyConfig().maxResults, 20);
});

await t.test('info 只记搜索概要，debug 才记详情', async () => {
  useTavilyEnv();
  process.env.WEB_SEARCH_PROVIDER = 'tavily,unknown';
  const lines = [];
  const original = console.log;
  console.log = (...args) => lines.push(args.join(' '));
  const response = {
    status: 200,
    data: {
      query: '洛奇 活动',
      answer: '',
      usage: { credits: 1 },
      results: [
        { title: '活动', url: 'https://luoqi.tiancity.com/a', content: '维护公告' },
        { title: '忽略', url: 'https://example.com/b', content: '第二条' }
      ]
    }
  };
  let calls = 0;
  const post = async (url, body, config) => {
    calls += 1;
    assert.equal(url, 'https://api.tavily.com/search');
    assert.equal(config.headers.Authorization, 'Bearer tvly-test');
    assert.equal(body.query, '洛奇 活动');
    return response;
  };

  try {
    process.env.LOG_LEVEL = 'info';
    const outcome = await searchWeb('洛奇 活动', { topic: 'general' }, { post });
    assert.equal(calls, 1);
    assert.equal(outcome.ok, true);
    assert.equal(outcome.count, 2);
    assert.match(outcome.modelContent, /https:\/\/luoqi.tiancity.com\/a/);
    assert.match(outcome.modelContent, /提供商无法识别/);
    const infoLog = lines.join('\n');
    assert.match(infoLog, /\[web_search\]通过tavily搜索了2篇文章/);
    assert.match(infoLog, /\[web_search\]通过unknown搜索了0篇文章：提供商无法识别/);
    assert.equal(infoLog.includes('洛奇 活动'), false);
    assert.equal(infoLog.includes('luoqi.tiancity.com'), false);
    assert.equal(infoLog.includes('tvly-test'), false);

    lines.length = 0;
    process.env.LOG_LEVEL = 'debug';
    await searchWeb('洛奇 活动', { topic: 'general' }, { post });
    const debugLog = lines.join('\n');
    assert.match(debugLog, /\[web_search\]详情/);
    assert.match(debugLog, /洛奇 活动/);
    assert.match(debugLog, /https:\/\/luoqi\.tiancity\.com\/a/);
    assert.equal(debugLog.includes('tvly-test'), false);
  } finally {
    console.log = original;
  }
});

await t.test('Tavily 欠费或失败时不抛错并记 0 篇', async () => {
  useTavilyEnv();
  process.env.LOG_LEVEL = 'info';
  const lines = [];
  const original = console.log;
  console.log = (...args) => lines.push(args.join(' '));
  try {
    const error = new Error('plan limit');
    error.response = { status: 432, data: { detail: { error: 'plan limit' } } };
    const outcome = await searchWeb('洛奇 维护', {}, {
      async post() {
        throw error;
      }
    });
    assert.equal(outcome.ok, false);
    assert.equal(outcome.count, 0);
    assert.match(outcome.modelContent, /额度不足或欠费/);

    let called = false;
    delete process.env.TAVILY_API_KEY;
    const skipped = await searchWeb('洛奇 维护', {}, {
      async post() {
        called = true;
        throw new Error('不应该请求');
      }
    });
    assert.equal(called, false);
    assert.equal(skipped.ok, false);
    assert.equal(skipped.count, 0);
  } finally {
    console.log = original;
  }
  const log = lines.join('\n');
  assert.match(log, /\[web_search\]通过tavily搜索了0篇文章：额度不足或欠费/);
  assert.match(log, /\[web_search\]通过tavily搜索了0篇文章：未配置/);
  assert.equal(log.includes('洛奇 维护'), false);
});
});
