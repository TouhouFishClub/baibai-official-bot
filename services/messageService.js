/**
 * 消息服务
 * 负责发送各类消息到QQ平台
 */

const axios = require('axios');
const logger = require('../utils/logger');

// QQ 官方 OpenAPI；允许通过环境变量覆盖以便联调。
const QQ_API_ROOT = String(process.env.QQ_API_ROOT || 'https://api.bot.qq.com').replace(/\/+$/, '');
const QQ_TOKEN_URL = String(
  process.env.QQ_TOKEN_URL || `${QQ_API_ROOT}/app/getAppAccessToken`
);
const configuredTimeout = Number(process.env.QQ_API_TIMEOUT_MS);
const QQ_API_TIMEOUT_MS = Number.isFinite(configuredTimeout) && configuredTimeout > 0
  ? configuredTimeout
  : 15000;
let cachedAccessToken = null;
let accessTokenExpiresAt = 0;
let accessTokenRequest = null;

function logRequestError(message, error) {
  if (!error?.alreadyLogged) {
    logger.error(message, error);
  }
  if (error && typeof error === 'object') {
    error.alreadyLogged = true;
  }
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
    
    // 获取访问令牌 - 使用正确的API地址
    const tokenResponse = await axios.post(
      QQ_TOKEN_URL,
      {
        appId: appId,
        clientSecret: appSecret
      },
      {
        headers: {
          'Content-Type': 'application/json'
        },
        timeout: QQ_API_TIMEOUT_MS
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
    
    // 发送消息请求
    const response = await axios.post(
      `${QQ_API_ROOT}/v2/groups/${groupOpenid}/messages`,
      requestData,
      {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `QQBot ${accessToken}`
        },
        timeout: QQ_API_TIMEOUT_MS
      }
    );
    
    logger.info('群聊消息发送成功');
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
    
    // 构建请求数据
    const requestData = { ...messageData };
    
    // 添加被动消息字段
    if (eventId) requestData.event_id = eventId;
    if (msgId) requestData.msg_id = msgId;
    
    logger.debug('发送频道消息', { channelId, contentLength: requestData.content?.length || 0 });
    
    // 发送消息请求 - 根据官方文档，频道消息也使用QQBot认证格式
    const response = await axios.post(
      `${QQ_API_ROOT}/channels/${channelId}/messages`,
      requestData,
      {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `QQBot ${accessToken}`
        },
        timeout: QQ_API_TIMEOUT_MS
      }
    );
    
    logger.info('频道消息发送成功');
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
 * @param {string} channelId - 频道ID
 * @param {string} imageUrl - 图片URL
 * @param {string} [content] - 可选的文本内容
 * @param {string} [eventId] - 前置事件ID (可选)
 * @param {string} [msgId] - 前置消息ID (可选)
 * @returns {Promise<object>} 发送结果
 */
async function sendImageToChannel(channelId, imageUrl, content = '', eventId = null, msgId = null) {
  const messageData = {
    image: imageUrl // 频道API使用image字段直接传URL
  };
  
  // 如果有文本内容，添加到消息中
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
    const response = await axios.post(
      `${QQ_API_ROOT}/v2/users/${userOpenid}/messages`,
      requestData,
      {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `QQBot ${accessToken}`
        },
        timeout: QQ_API_TIMEOUT_MS
      }
    );
    
    logger.info('QQ单聊消息发送成功');
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
    
    // 构建请求数据
    const requestData = { ...messageData };
    
    // 添加被动消息字段
    if (eventId) requestData.event_id = eventId;
    if (msgId) requestData.msg_id = msgId;
    
    logger.debug('发送频道私信消息', { guildId, contentLength: requestData.content?.length || 0 });
    
    // 发送消息请求 - 根据官方文档使用/dms/{guild_id}/messages
    const response = await axios.post(
      `${QQ_API_ROOT}/dms/${guildId}/messages`,
      requestData,
      {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `QQBot ${accessToken}`
        },
        timeout: QQ_API_TIMEOUT_MS
      }
    );
    
    logger.info('频道私信消息发送成功');
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
  getAccessToken,
  QQ_API_ROOT,
  QQ_API_TIMEOUT_MS,
  validateTypedMessage
}; 