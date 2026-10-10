/**
 * 网络搜索入口。WEB_SEARCH_PROVIDER 用逗号分隔多家，并行查询。
 * 某一家失败、超时或欠费时不影响其他家，也不向外抛错。
 */

const logger = require('../../utils/logger');
const tavily = require('./tavily/client');

const PROVIDERS = {
  tavily
};

function providerNames() {
  return [...new Set(
    String(process.env.WEB_SEARCH_PROVIDER || '')
      .split(/[,，\s]+/)
      .map((name) => name.trim().toLowerCase())
      .filter(Boolean)
  )];
}

function isWebSearchEnabled() {
  return providerNames().some((name) => PROVIDERS[name]?.isConfigured());
}

function describeSearchError(error) {
  const status = error?.response?.status || error?.status;
  if (status === 402 || status === 432 || status === 433) return '额度不足或欠费';
  if (status === 429) return '请求过于频繁';
  if (status === 401) return '密钥无效';
  if (error?.code === 'SEARCH_TIMEOUT' || error?.code === 'ECONNABORTED') return '查询超时';
  if (error?.code === 'SEARCH_NOT_CONFIGURED') return '未配置';
  return '查询失败';
}

function withTimeout(promise, ms) {
  let settled = false;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      const error = new Error('查询超时');
      error.code = 'SEARCH_TIMEOUT';
      reject(error);
    }, ms);
    promise.then((value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    }, (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });
  });
}

function formatResults(provider, query, outcome) {
  const lines = outcome.results.map((item, index) => {
    return `${index + 1}. ${item.title || '无标题'}\n${item.url}\n${item.content}`;
  });
  const answer = outcome.answer ? `搜索摘要：${outcome.answer}\n` : '';
  return [
    answer,
    `使用 ${provider} 查询「${query}」，得到 ${outcome.results.length} 条。`,
    lines.join('\n\n')
  ].filter(Boolean).join('\n');
}

function failureResult(provider, query, reason) {
  const name = provider || '未选择';
  return {
    ok: false,
    provider: name,
    query,
    count: 0,
    results: [],
    modelContent: `网络搜索失败（${name}）：${reason}。请继续根据已有知识回答，并说明这次没能查到网页。`
  };
}

function logSummary(provider, count, reason) {
  const line = `[web_search]通过${provider}搜索了${count}篇文章`;
  if (reason) logger.warn(`${line}：${reason}`);
  else logger.info(line);
}

function logDetail(provider, query, extra) {
  logger.debug('[web_search]详情', {
    provider,
    query,
    ...extra
  });
}

async function searchOne(name, queryText, options, dependencies) {
  const provider = PROVIDERS[name];
  if (!provider || !provider.isConfigured()) {
    const reason = provider ? '未配置' : '提供商无法识别';
    logSummary(name, 0, reason);
    logDetail(name, queryText, { count: 0, reason });
    return failureResult(name, queryText, reason);
  }

  try {
    const timeoutMs = (provider.getTimeoutMs?.() || 15000) + 1000;
    const outcome = await withTimeout(
      provider.search(queryText, options, dependencies.post),
      timeoutMs
    );
    const count = outcome.results.length;
    logSummary(name, count);
    logDetail(name, queryText, {
      count,
      credits: outcome.credits,
      results: outcome.results.map((item) => [item.title, item.url, item.content].filter(Boolean).join(' '))
    });
    return {
      ok: true,
      provider: name,
      query: queryText,
      count,
      results: outcome.results,
      modelContent: formatResults(name, queryText, outcome)
    };
  } catch (error) {
    const reason = describeSearchError(error);
    logSummary(name, 0, reason);
    logDetail(name, queryText, {
      count: 0,
      reason,
      status: error?.response?.status || error?.status
    });
    return failureResult(name, queryText, reason);
  }
}

async function searchWeb(query, options = {}, dependencies = {}) {
  const queryText = String(query || '').trim().slice(0, 400);
  const names = providerNames();

  if (!queryText || !names.length) {
    const reason = queryText ? '未配置' : '缺少搜索词';
    logSummary(names[0] || '未选择', 0, reason);
    logDetail(names[0] || '未选择', queryText, { count: 0, reason });
    return failureResult(names.join(',') || '未选择', queryText, reason);
  }

  const parts = await Promise.all(
    names.map((name) => searchOne(name, queryText, options, dependencies))
  );
  const count = parts.reduce((sum, part) => sum + part.count, 0);
  return {
    ok: parts.some((part) => part.ok),
    provider: parts.map((part) => part.provider).join(','),
    query: queryText,
    count,
    results: parts.flatMap((part) => part.results || []),
    modelContent: parts.map((part) => part.modelContent).filter(Boolean).join('\n\n')
  };
}

module.exports = {
  PROVIDERS,
  describeSearchError,
  isWebSearchEnabled,
  providerNames,
  searchWeb
};
