/**
 * 消息服务
 * 负责发送各类消息到QQ平台
 */

const dns = require('dns');
const fs = require('fs');
const path = require('path');
const https = require('https');
const axios = require('axios');
const logger = require('../utils/logger');

if (typeof dns.setDefaultResultOrder === 'function') {
  dns.setDefaultResultOrder('ipv4first');
}

// 默认沿用已验证可通的旧域名；新文档域名可通过环境变量覆盖。
const QQ_API_ROOT = String(process.env.QQ_API_ROOT || 'https://api.sgroup.qq.com').replace(/\/+$/, '');
const QQ_TOKEN_URL = String(
  process.env.QQ_TOKEN_URL || 'https://bots.qq.com/app/getAppAccessToken'
);
const configuredTimeout = Number(process.env.QQ_API_TIMEOUT_MS);
const QQ_API_TIMEOUT_MS = Number.isFinite(configuredTimeout) && configuredTimeout > 0
  ? configuredTimeout
  : 15000;
const DNS_TIMEOUT_MS = Math.min(5000, QQ_API_TIMEOUT_MS);
let cachedAccessToken = null;
let accessTokenExpiresAt = 0;
let accessTokenRequest = null;

function forceLog(line) {
  logger.info(line);
  try {
    fs.writeSync(1, `${line}\n`);
  } catch (_) {
    // PM2 管道上 writeSync 失败时仍保留 logger 输出。
  }
}

function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const error = new Error(`${label} 超时（${ms}ms）`);
      error.code = 'ETIMEDOUT';
      forceLog(`[QQ] ${error.message}`);
      reject(error);
    }, ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function lookupIpv4(hostname) {
  return new Promise((resolve, reject) => {
    dns.lookup(hostname, { family: 4 }, (error, address) => {
      if (error) reject(error);
      else resolve(address);
    });
  });
}

function qqRequestConfig(headers = {}) {
  return {
    timeout: QQ_API_TIMEOUT_MS,
    family: 4,
    headers
  };
}

async function qqRequest(method, url, data, headers = {}) {
  const parsed = new URL(url);
  logger.debug('QQ 请求开始', {
    method,
    host: parsed.hostname,
    path: parsed.pathname
  });

  const lookupPromise = lookupIpv4(parsed.hostname);
  lookupPromise.catch(() => undefined);
  const address = await withTimeout(
    lookupPromise,
    DNS_TIMEOUT_MS,
    `DNS ${parsed.hostname}`
  );
  logger.debug('QQ DNS 完成', { host: parsed.hostname, address });

  const requestUrl = `${parsed.protocol}//${address}${parsed.pathname}${parsed.search}`;
  const agent = new https.Agent({
    keepAlive: false,
    servername: parsed.hostname,
    lookup: (_host, _options, callback) => callback(null, address, 4)
  });
  const axiosConfig = {
    method,
    url: requestUrl,
    headers: {
      Host: parsed.hostname,
      ...headers
    },
    timeout: QQ_API_TIMEOUT_MS,
    family: 4,
    httpsAgent: agent
  };
  if (method !== 'GET' && method !== 'HEAD') {
    axiosConfig.data = data;
  }
  if (Buffer.isBuffer(data)) {
    axiosConfig.maxBodyLength = Infinity;
    axiosConfig.maxContentLength = Infinity;
    axiosConfig.transformRequest = [(body) => body];
  }
  if (isFormDataPayload(data)) {
    axiosConfig.maxBodyLength = Infinity;
    axiosConfig.maxContentLength = Infinity;
    delete axiosConfig.headers['Content-Type'];
    delete axiosConfig.headers['content-type'];
    if (typeof data.getHeaders === 'function') {
      Object.assign(axiosConfig.headers, data.getHeaders());
    }
  }
  if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
    axiosConfig.signal = AbortSignal.timeout(QQ_API_TIMEOUT_MS);
  }

  const requestPromise = axios(axiosConfig);
  requestPromise.catch(() => undefined);
  return withTimeout(
    requestPromise,
    QQ_API_TIMEOUT_MS,
    `${method} ${parsed.hostname}${parsed.pathname}`
  );
}

function logRequestError(message, error) {
  if (!error?.alreadyLogged) {
    logger.error(message, error);
  }
  if (error && typeof error === 'object') {
    error.alreadyLogged = true;
  }
}

function isFormDataPayload(data) {
  return (typeof FormData !== 'undefined' && data instanceof FormData)
    || (Boolean(data) && typeof data.append === 'function' && typeof data.getHeaders === 'function');
}

function mimeForImage(filePath) {
  const ext = path.extname(String(filePath || '')).toLowerCase();
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.gif') return 'image/gif';
  if (ext === '.webp') return 'image/webp';
  return 'image/png';
}

function createChannelImageForm({ filePath, content = '', eventId = null, msgId = null } = {}) {
  if (!filePath || !fs.existsSync(filePath)) {
    throw new Error('缺少本地图片文件');
  }

  const buffer = fs.readFileSync(filePath);
  const fileName = path.basename(filePath);
  const form = new FormData();
  const type = mimeForImage(filePath);
  if (typeof File === 'function') {
    form.append('file_image', new File([buffer], fileName, { type }));
  } else {
    form.append('file_image', new Blob([buffer], { type }), fileName);
  }
  if (content && String(content).trim()) {
    form.append('content', String(content));
  }
  if (eventId) form.append('event_id', String(eventId));
  if (msgId) form.append('msg_id', String(msgId));
  return form;
}

function prepareGuildMessage(messageData, eventId, msgId) {
  if (isFormDataPayload(messageData)) {
    if (eventId && !messageData.has('event_id')) {
      messageData.append('event_id', String(eventId));
    }
    if (msgId && !messageData.has('msg_id')) {
      messageData.append('msg_id', String(msgId));
    }
    return { data: messageData, json: false };
  }

  const requestData = { ...messageData };
  if (eventId) requestData.event_id = eventId;
  if (msgId) requestData.msg_id = msgId;
  return { data: requestData, json: true };
}

function validateTypedMessage(message) {
  if (!message || typeof message !== 'object') {
    throw new Error('消息内容不能为空');
  }
  if (message.msg_type === undefined) {
    message.msg_type = 0;
  }
  if (message.msg_type === 0 && !String(message.content || '').trim()) {
    throw new Error('文本消息内容不能为空');
  }
  if (message.msg_type === 2 && !message.markdown) {
    throw new Error('Markdown消息必须包含markdown字段');
  }
  if (message.msg_type === 7 && !message.media?.file_info) {
    throw new Error('富媒体消息必须包含media.file_info字段');
  }
}

/**
 * 获取访问令牌
 * @returns {Promise<string>} 访问令牌
 */
async function getAccessToken() {
  if (cachedAccessToken && Date.now() < accessTokenExpiresAt) {
    return cachedAccessToken;
  }
  if (accessTokenRequest) {
    return accessTokenRequest;
  }

  accessTokenRequest = (async () => {
    const appId = process.env.QQ_BOT_APP_ID;
    const appSecret = process.env.QQ_BOT_SECRET;
    
    if (!appId || !appSecret) {
      throw new Error('未配置QQ_BOT_APP_ID或QQ_BOT_SECRET环境变量');
    }
    
    logger.debug('开始获取访问令牌', { url: QQ_TOKEN_URL });
    const tokenResponse = await qqRequest(
      'POST',
      QQ_TOKEN_URL,
      {
        appId: appId,
        clientSecret: appSecret
      },
      {
        'Content-Type': 'application/json'
      }
    );
    
    if (!tokenResponse.data || !tokenResponse.data.access_token) {
      throw new Error('获取访问令牌失败: ' + JSON.stringify(tokenResponse.data));
    }
    
    const expiresIn = Number(tokenResponse.data.expires_in) || 0;
    cachedAccessToken = tokenResponse.data.access_token;
    accessTokenExpiresAt = Date.now() + Math.max(1, expiresIn - 60) * 1000;
    logger.debug(`获取访问令牌成功，有效期: ${expiresIn}秒`);
    return cachedAccessToken;
  })();

  try {
    return await accessTokenRequest;
  } catch (error) {
    logRequestError('获取访问令牌失败', error);
    throw error;
  } finally {
    accessTokenRequest = null;
  }
}

/**
 * 发送群聊消息
 * @param {string} groupOpenid - 群聊的openid
 * @param {object} message - 消息内容
 * @param {string} [eventId] - 前置收到的事件ID (可选)
 * @param {string} [msgId] - 前置收到的用户消息ID (可选)
 * @param {number} [msgSeq=1] - 回复消息的序号 (可选)
 * @returns {Promise<object>} 发送结果
 */
async function sendGroupMessage(groupOpenid, message, eventId = null, msgId = null, msgSeq = 1) {
  try {
    if (!groupOpenid) {
      throw new Error('缺少群聊openid参数');
    }
    
    validateTypedMessage(message);

    const accessToken = await getAccessToken();
    const requestData = { ...message };
    if (eventId) requestData.event_id = eventId;
    if (msgId) {
      requestData.msg_id = msgId;
      requestData.msg_seq = msgSeq;
    }

    const requestUrl = `${QQ_API_ROOT}/v2/groups/${groupOpenid}/messages`;
    logger.debug('开始发送群聊消息', {
      url: requestUrl,
      msgType: requestData.msg_type,
      hasMsgId: Boolean(requestData.msg_id),
      msgSeq: requestData.msg_seq
    });
    const response = await qqRequest(
      'POST',
      requestUrl,
      requestData,
      {
        'Content-Type': 'application/json',
        'Authorization': `QQBot ${accessToken}`
      }
    );
    
    logger.debug('群聊消息发送成功');
    return response.data;
    
  } catch (error) {
    logRequestError('发送群聊消息失败', error);
    throw error;
  }
}

/**
 * 发送文本消息到群聊
 * @param {string} groupOpenid - 群聊的openid
 * @param {string} content - 文本内容
 * @param {string} [eventId] - 前置事件ID (可选)
 * @param {string} [msgId] - 前置消息ID (可选)
 * @returns {Promise<object>} 发送结果
 */
async function sendTextToGroup(groupOpenid, content, eventId = null, msgId = null, msgSeq = 1) {
  return sendGroupMessage(
    groupOpenid,
    {
      content,
      msg_type: 0 // 文本消息
    },
    eventId,
    msgId,
    msgSeq
  );
}

/**
 * 发送Markdown消息到群聊
 * @param {string} groupOpenid - 群聊的openid
 * @param {object} markdown - Markdown对象
 * @param {string} [eventId] - 前置事件ID (可选)
 * @param {string} [msgId] - 前置消息ID (可选)
 * @returns {Promise<object>} 发送结果
 */
async function sendMarkdownToGroup(
  groupOpenid,
  markdown,
  eventId = null,
  msgId = null,
  msgSeq = 1
) {
  return sendGroupMessage(
    groupOpenid,
    {
      msg_type: 2, // Markdown消息
      markdown
    },
    eventId,
    msgId,
    msgSeq
  );
}

/**
 * 发送富媒体消息到群聊
 * @param {string} groupOpenid - 群聊的openid
 * @param {object} media - 富媒体对象，包含file_info字段
 * @param {string} [eventId] - 前置事件ID (可选)
 * @param {string} [msgId] - 前置消息ID (可选)
 * @returns {Promise<object>} 发送结果
 */
async function sendMediaToGroup(groupOpenid, media, eventId = null, msgId = null, msgSeq = 1) {
  if (!media || !media.file_info) {
    throw new Error('富媒体消息必须包含file_info字段');
  }
  
  return sendGroupMessage(
    groupOpenid,
    {
      msg_type: 7, // 富媒体消息
      media: {
        file_info: media.file_info
      }
    },
    eventId,
    msgId,
    msgSeq
  );
}

/**
 * 发送频道消息
 * @param {string} channelId - 频道ID
 * @param {object} messageData - 消息数据
 * @param {string} [eventId] - 前置收到的事件ID (可选)
 * @param {string} [msgId] - 前置收到的用户消息ID (可选)
 * @returns {Promise<object>} 发送结果
 */
async function sendChannelMessage(channelId, messageData, eventId = null, msgId = null) {
  try {
    if (!channelId) {
      throw new Error('缺少频道ID参数');
    }
    
    // 获取动态AccessToken - 根据官方文档要求
    const accessToken = await getAccessToken();
    const { data: requestData, json } = prepareGuildMessage(messageData, eventId, msgId);
    const contentLength = json
      ? (requestData.content?.length || 0)
      : String(requestData.get?.('content') || '').length;

    logger.debug('发送频道消息', { channelId, contentLength, multipart: !json });

    const headers = {
      Authorization: `QQBot ${accessToken}`
    };
    if (json) {
      headers['Content-Type'] = 'application/json';
    }

    // 发送消息请求 - 根据官方文档，频道消息也使用QQBot认证格式
    const response = await qqRequest(
      'POST',
      `${QQ_API_ROOT}/channels/${channelId}/messages`,
      requestData,
      headers
    );
    
    logger.debug('频道消息发送成功');
    return response.data;
    
  } catch (error) {
    logRequestError('发送频道消息失败', error);
    throw error;
  }
}

/**
 * 发送文本消息到频道
 * @param {string} channelId - 频道ID
 * @param {string} content - 文本内容
 * @param {string} [eventId] - 前置事件ID (可选)
 * @param {string} [msgId] - 前置消息ID (可选)
 * @returns {Promise<object>} 发送结果
 */
async function sendTextToChannel(channelId, content, eventId = null, msgId = null) {
  return sendChannelMessage(
    channelId,
    {
      content // 频道API直接使用content字段，不需要msg_type
    },
    eventId,
    msgId
  );
}

/**
 * 发送Markdown消息到频道
 * @param {string} channelId - 频道ID
 * @param {object} markdown - Markdown对象
 * @param {string} [eventId] - 前置事件ID (可选)
 * @param {string} [msgId] - 前置消息ID (可选)
 * @returns {Promise<object>} 发送结果
 */
async function sendMarkdownToChannel(channelId, markdown, eventId = null, msgId = null) {
  return sendChannelMessage(
    channelId,
    {
      markdown // 频道API直接使用markdown字段
    },
    eventId,
    msgId
  );
}

/**
 * 发送图片消息到频道
 * 优先 multipart file_image 本地上传；QQ 拉公网 image URL 常返回 304017。
 * @param {string} channelId - 频道ID
 * @param {string} [imageUrl] - 图片URL（无本地文件时的回退）
 * @param {string} [content] - 可选的文本内容
 * @param {string} [eventId] - 前置事件ID (可选)
 * @param {string} [msgId] - 前置消息ID (可选)
 * @param {string} [filePath] - 本地图片路径
 * @returns {Promise<object>} 发送结果
 */
async function sendImageToChannel(channelId, imageUrl, content = '', eventId = null, msgId = null, filePath = null) {
  if (filePath) {
    logger.debug('频道使用本地 file_image 上传', { fileName: path.basename(filePath) });
    return sendChannelMessage(
      channelId,
      createChannelImageForm({ filePath, content }),
      eventId,
      msgId
    );
  }
  if (!imageUrl) {
    throw new Error('缺少图片文件或图片URL');
  }

  logger.warn('频道回退公网 image URL', { imageUrl });
  const messageData = {
    image: imageUrl
  };
  if (content && content.trim()) {
    messageData.content = content;
  }
  return sendChannelMessage(channelId, messageData, eventId, msgId);
}

/**
 * 发送富媒体消息到频道（兼容旧接口）
 * @param {string} channelId - 频道ID
 * @param {object} media - 富媒体对象，包含file_info字段
 * @param {string} [eventId] - 前置事件ID (可选)
 * @param {string} [msgId] - 前置消息ID (可选)
 * @returns {Promise<object>} 发送结果
 */
async function sendMediaToChannel(channelId, media, eventId = null, msgId = null) {
  // 对于频道，我们需要将媒体转换为图片URL
  logger.warn('sendMediaToChannel: 频道API建议使用sendImageToChannel');
  
  // 这里需要根据具体的media结构来处理
  // 暂时返回错误，建议使用新的图片发送接口
  throw new Error('频道发送富媒体请使用sendImageToChannel，传入图片URL');
}

/**
 * 发送QQ单聊消息
 * @param {string} userOpenid - 用户的openid
 * @param {object} message - 消息内容
 * @param {string} [eventId] - 前置收到的事件ID (可选)
 * @param {string} [msgId] - 前置收到的用户消息ID (可选)
 * @param {number} [msgSeq=1] - 回复消息的序号 (可选)
 * @returns {Promise<object>} 发送结果
 */
async function sendC2CMessage(userOpenid, message, eventId = null, msgId = null, msgSeq = 1) {
  try {
    if (!userOpenid) {
      throw new Error('缺少用户openid参数');
    }
    
    validateTypedMessage(message);
    
    // 获取访问令牌
    const accessToken = await getAccessToken();
    
    // 构建请求数据
    const requestData = { ...message };
    
    // 添加可选字段
    if (eventId) requestData.event_id = eventId;
    if (msgId) {
      requestData.msg_id = msgId;
      requestData.msg_seq = msgSeq;
    }
    
    // 发送消息请求 - 根据官方文档使用v2/users/{openid}/messages
    const response = await qqRequest(
      'POST',
      `${QQ_API_ROOT}/v2/users/${userOpenid}/messages`,
      requestData,
      {
        'Content-Type': 'application/json',
        'Authorization': `QQBot ${accessToken}`
      }
    );
    
    logger.debug('QQ单聊消息发送成功');
    return response.data;
    
  } catch (error) {
    logRequestError('发送QQ单聊消息失败', error);
    throw error;
  }
}

/**
 * 发送文本消息到QQ单聊
 * @param {string} userOpenid - 用户的openid
 * @param {string} content - 文本内容
 * @param {string} [eventId] - 前置事件ID (可选)
 * @param {string} [msgId] - 前置消息ID (可选)
 * @returns {Promise<object>} 发送结果
 */
async function sendTextToC2C(userOpenid, content, eventId = null, msgId = null, msgSeq = 1) {
  return sendC2CMessage(
    userOpenid,
    {
      content,
      msg_type: 0 // 文本消息
    },
    eventId,
    msgId,
    msgSeq
  );
}

/**
 * 发送频道私信消息
 * @param {string} guildId - 频道服务器ID
 * @param {object} messageData - 消息数据
 * @param {string} [eventId] - 前置收到的事件ID (可选)
 * @param {string} [msgId] - 前置收到的用户消息ID (可选)
 * @returns {Promise<object>} 发送结果
 */
async function sendDirectMessage(guildId, messageData, eventId = null, msgId = null) {
  try {
    if (!guildId) {
      throw new Error('缺少频道服务器ID参数');
    }
    
    // 获取动态AccessToken
    const accessToken = await getAccessToken();
    const { data: requestData, json } = prepareGuildMessage(messageData, eventId, msgId);
    const contentLength = json
      ? (requestData.content?.length || 0)
      : String(requestData.get?.('content') || '').length;

    logger.debug('发送频道私信消息', { guildId, contentLength, multipart: !json });

    const headers = {
      Authorization: `QQBot ${accessToken}`
    };
    if (json) {
      headers['Content-Type'] = 'application/json';
    }

    // 发送消息请求 - 根据官方文档使用/dms/{guild_id}/messages
    const response = await qqRequest(
      'POST',
      `${QQ_API_ROOT}/dms/${guildId}/messages`,
      requestData,
      headers
    );
    
    logger.debug('频道私信消息发送成功');
    return response.data;
    
  } catch (error) {
    logRequestError('发送频道私信消息失败', error);
    throw error;
  }
}

/**
 * 发送文本消息到频道私信
 * @param {string} guildId - 频道服务器ID
 * @param {string} content - 文本内容
 * @param {string} [eventId] - 前置事件ID (可选)
 * @param {string} [msgId] - 前置消息ID (可选)
 * @returns {Promise<object>} 发送结果
 */
async function sendTextToDirectMessage(guildId, content, eventId = null, msgId = null) {
  return sendDirectMessage(
    guildId,
    {
      content // 频道私信API直接使用content字段，类似频道消息
    },
    eventId,
    msgId
  );
}

/**
 * 发送图片消息到频道私信
 * 优先 multipart file_image 本地上传，避免 QQ 拉公网 URL 失败。
 */
async function sendImageToDirectMessage(guildId, imageUrl, content = '', eventId = null, msgId = null, filePath = null) {
  if (filePath) {
    logger.debug('频道私信使用本地 file_image 上传', { fileName: path.basename(filePath) });
    return sendDirectMessage(
      guildId,
      createChannelImageForm({ filePath, content }),
      eventId,
      msgId
    );
  }
  if (!imageUrl) {
    throw new Error('缺少图片文件或图片URL');
  }

  logger.warn('频道私信回退公网 image URL', { imageUrl });
  const messageData = {
    image: imageUrl
  };
  if (content && content.trim()) {
    messageData.content = content;
  }
  return sendDirectMessage(guildId, messageData, eventId, msgId);
}

module.exports = {
  sendGroupMessage,
  sendTextToGroup,
  sendMarkdownToGroup,
  sendMediaToGroup,
  sendChannelMessage,
  sendTextToChannel,
  sendMarkdownToChannel,
  sendImageToChannel,
  sendMediaToChannel,
  sendC2CMessage,
  sendTextToC2C,
  sendDirectMessage,
  sendTextToDirectMessage,
  sendImageToDirectMessage,
  createChannelImageForm,
  isFormDataPayload,
  prepareGuildMessage,
  getAccessToken,
  QQ_API_ROOT,
  QQ_API_TIMEOUT_MS,
  qqRequest,
  qqRequestConfig,
  withTimeout,
  validateTypedMessage
}; 