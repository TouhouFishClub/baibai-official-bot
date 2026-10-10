/**
 * Tavily Search。
 * POST {baseURL}/search ，Authorization: Bearer <TAVILY_API_KEY>
 */

const axios = require('axios');
const { TOPICS, isTavilyConfigured, readTavilyConfig } = require('./config');

function defaultPost(url, body, config) {
  return axios.post(url, body, config);
}

function buildSearchBody(query, options, config) {
  const topic = TOPICS.has(String(options.topic || '').trim().toLowerCase())
    ? String(options.topic).trim().toLowerCase()
    : config.topic;
  const body = {
    query,
    search_depth: config.searchDepth,
    topic,
    max_results: config.maxResults,
    include_answer: config.includeAnswer,
    include_usage: true
  };
  if (config.searchDepth !== 'ultra-fast') {
    body.chunks_per_source = config.chunksPerSource;
  }
  if (config.timeRange) body.time_range = config.timeRange;
  if (config.country && topic === 'general') body.country = config.country;
  if (config.language) body.language = config.language;
  if (config.includeDomains.length) body.include_domains = config.includeDomains;
  if (config.excludeDomains.length) body.exclude_domains = config.excludeDomains;
  return body;
}

function mapResults(data, limit) {
  const results = Array.isArray(data?.results) ? data.results : [];
  return results.slice(0, limit).map((item) => ({
    title: String(item?.title || '').trim(),
    url: String(item?.url || '').trim(),
    content: String(item?.content || '').replace(/\s+/g, ' ').trim().slice(0, 800)
  })).filter((item) => item.title || item.url || item.content);
}

async function search(query, options = {}, post = defaultPost) {
  const config = readTavilyConfig();
  if (!isTavilyConfigured(config)) {
    const error = new Error('未配置 Tavily');
    error.code = 'SEARCH_NOT_CONFIGURED';
    throw error;
  }

  const body = buildSearchBody(query, options, config);
  const response = await post(
    `${config.baseURL}/search`,
    body,
    {
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json'
      },
      timeout: config.timeoutMs
    }
  );
  const status = response?.status || 200;
  if (status >= 400) {
    const error = new Error(`Tavily HTTP ${status}`);
    error.response = { status, data: response?.data };
    throw error;
  }

  const data = response?.data || {};
  return {
    query: String(data.query || query),
    answer: typeof data.answer === 'string' ? data.answer.trim() : '',
    results: mapResults(data, config.maxResults),
    credits: data.usage?.credits
  };
}

module.exports = {
  name: 'tavily',
  buildSearchBody,
  getTimeoutMs() {
    return readTavilyConfig().timeoutMs;
  },
  isConfigured: isTavilyConfigured,
  search
};
