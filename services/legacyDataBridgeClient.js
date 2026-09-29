const axios = require('axios');
const {
  encryptEnvelope,
  decryptEnvelope,
  decodeSecret
} = require('../legacy-data-bridge/shared/cryptoEnvelope');

const QUERY_PATH = '/v1/query';

class BridgeUnavailableError extends Error {
  constructor(message, cause) {
    super(message);
    this.name = 'BridgeUnavailableError';
    this.cause = cause;
  }
}

function readConfig() {
  const baseURL = String(process.env.DATABASE_BRIDGE_URL || '').trim().replace(/\/+$/, '');
  const secret = String(process.env.DATABASE_BRIDGE_SECRET || '').trim();
  const timeout = Number(process.env.DATABASE_BRIDGE_TIMEOUT_MS || 10_000);
  return { baseURL, secret, timeout };
}

function isBridgeConfigured(config = readConfig()) {
  return Boolean(config.baseURL && config.secret);
}

function createClient(config = readConfig(), httpClient = axios) {
  if (!isBridgeConfigured(config)) {
    throw new BridgeUnavailableError('数据库桥接服务未配置');
  }
  try {
    const url = new URL(config.baseURL);
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('invalid protocol');
    decodeSecret(config.secret);
  } catch (error) {
    throw new BridgeUnavailableError('数据库桥接配置无效', error);
  }

  async function query(operation, params = {}, options = {}) {
    const transport = {
      secret: config.secret,
      method: 'POST',
      path: QUERY_PATH
    };
    const envelope = encryptEnvelope({ operation, params }, transport);
    let response;
    try {
      response = await httpClient.post(`${config.baseURL}${QUERY_PATH}`, envelope, {
        timeout: options.timeout || config.timeout,
        maxContentLength: 2 * 1024 * 1024,
        validateStatus: () => true,
        headers: { 'Content-Type': 'application/json' }
      });
    } catch (error) {
      throw new BridgeUnavailableError('数据库桥接服务不可达', error);
    }

    let payload;
    try {
      payload = decryptEnvelope(response.data, transport);
    } catch (error) {
      throw new BridgeUnavailableError('数据库桥接响应无效', error);
    }
    if (payload.requestNonce !== envelope.nonce) {
      throw new BridgeUnavailableError('数据库桥接响应与请求不匹配');
    }
    if (response.status !== 200 || !payload.ok) {
      throw new BridgeUnavailableError(payload.error || '数据库桥接查询失败');
    }
    return payload.data;
  }

  return {
    query,
    television: (kind, params) => query(`television.${kind}`, params),
    televisionStats: (kind, params) => query(`television.${kind}`, params, { timeout: 60_000 }),
    optionsetWhere: (params) => query('optionset.where', params),
    optionsetSearch: (params) => query('optionset.search', params),
    mblogs: (params) => query('mblogs.query', params),
    smuggler: () => query('smuggler.latest', {})
  };
}

function getBridgeClient() {
  return createClient();
}

module.exports = {
  BridgeUnavailableError,
  createClient,
  getBridgeClient,
  isBridgeConfigured,
  readConfig
};
