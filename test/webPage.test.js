const test = require('node:test');
const assert = require('node:assert/strict');

const { canonicalUrl, extractPageText, readPages } = require('../services/webSearch/page/reader');

test('原网页正文去掉脚本，并忽略内网地址', async () => {
  const page = extractPageText(`
    <html><head><title>维护公告</title></head>
    <body><script>secret()</script><article>今晚维护到凌晨</article></body></html>
  `);
  assert.equal(page.title, '维护公告');
  assert.match(page.text, /今晚维护到凌晨/);
  assert.equal(page.text.includes('secret'), false);

  let called = false;
  const blocked = await readPages(['http://127.0.0.1/admin'], {
    async get() {
      called = true;
      throw new Error('不应该请求');
    }
  });
  assert.equal(called, false);
  assert.equal(blocked.ok, false);
  assert.match(blocked.modelContent, /地址无效/);
  assert.equal(canonicalUrl('https://Example.com/a/'), 'https://example.com/a');
});

test('打开原网页失败时不抛错', async () => {
  const savedLevel = process.env.LOG_LEVEL;
  process.env.LOG_LEVEL = 'info';
  const lines = [];
  const original = console.log;
  console.log = (...args) => lines.push(args.join(' '));
  try {
    const outcome = await readPages(['https://luoqi.tiancity.com/a'], {
      async get() {
        const error = new Error('timeout');
        error.code = 'ECONNABORTED';
        throw error;
      }
    });
    assert.equal(outcome.ok, false);
    assert.equal(outcome.count, 0);
    assert.match(outcome.modelContent, /超时/);
    assert.match(outcome.modelContent, /整理最终回答/);
  } finally {
    console.log = original;
    if (savedLevel === undefined) delete process.env.LOG_LEVEL;
    else process.env.LOG_LEVEL = savedLevel;
  }
  assert.match(lines.join('\n'), /\[web_page\]有1篇原文没有打开/);
  assert.equal(lines.join('\n').includes('luoqi.tiancity.com'), false);
});
