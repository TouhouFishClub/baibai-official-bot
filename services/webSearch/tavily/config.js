/**
 * Tavily 搜索配置。
 * 文档：https://docs.tavily.com/documentation/api-reference/endpoint/search
 */

const SEARCH_DEPTHS = new Set(['advanced', 'basic', 'fast', 'ultra-fast']);
const TOPICS = new Set(['general', 'news', 'finance']);
const TIME_RANGES = new Set(['day', 'week', 'month', 'year', 'd', 'w', 'm', 'y']);

function readPositiveInt(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : fallback;
}

function clamp(number, min, max) {
  return Math.min(max, Math.max(min, number));
}

function pickEnum(value, allowed, fallback) {
  const text = String(value || '').trim().toLowerCase();
  return allowed.has(text) ? text : fallback;
}

function splitList(value, limit) {
  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, limit);
}

function parseIncludeAnswer(value) {
  const text = String(value ?? '').trim().toLowerCase();
  if (!text || text === 'false' || text === '0') return false;
  if (text === 'true' || text === '1') return true;
  if (text === 'basic' || text === 'advanced') return text;
  return false;
}

function readSharedTimeout() {
  return readPositiveInt(process.env.WEB_SEARCH_TIMEOUT_MS, 15000);
}

function readTavilyConfig() {
  const baseURL = String(process.env.TAVILY_BASE_URL || 'https://api.tavily.com').trim().replace(/\/+$/, '');
  const searchDepth = pickEnum(process.env.TAVILY_SEARCH_DEPTH, SEARCH_DEPTHS, 'basic');
  // 提供商自己的条数优先。TAVILY_MAX_RESULTS=10 且 WEB_SEARCH_MAX_RESULTS=5 时，向 Tavily 请求 10 条。
  const maxResults = clamp(
    readPositiveInt(process.env.TAVILY_MAX_RESULTS, readPositiveInt(process.env.WEB_SEARCH_MAX_RESULTS, 5)),
    1,
    20
  );
  return {
    apiKey: String(process.env.TAVILY_API_KEY || '').trim(),
    baseURL,
    searchDepth,
    topic: pickEnum(process.env.TAVILY_TOPIC, TOPICS, 'general'),
    maxResults,
    chunksPerSource: clamp(readPositiveInt(process.env.TAVILY_CHUNKS_PER_SOURCE, 3), 1, 3),
    includeAnswer: parseIncludeAnswer(process.env.TAVILY_INCLUDE_ANSWER),
    timeRange: pickEnum(process.env.TAVILY_TIME_RANGE, TIME_RANGES, ''),
    country: String(process.env.TAVILY_COUNTRY || '').trim().toLowerCase(),
    language: String(process.env.TAVILY_LANGUAGE || '').trim(),
    includeDomains: splitList(process.env.TAVILY_INCLUDE_DOMAINS, 300),
    excludeDomains: splitList(process.env.TAVILY_EXCLUDE_DOMAINS, 150),
    timeoutMs: readPositiveInt(process.env.TAVILY_TIMEOUT_MS, readSharedTimeout())
  };
}

function isTavilyConfigured(config = readTavilyConfig()) {
  if (!config.apiKey || !config.baseURL) return false;
  try {
    const url = new URL(config.baseURL);
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch (_) {
    return false;
  }
}

module.exports = {
  SEARCH_DEPTHS,
  TOPICS,
  isTavilyConfigured,
  readTavilyConfig
};
