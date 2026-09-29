/**
 * 消息服务
 * 负责发送各类消息到QQ平台
 */

const axios = require('axios');
const qs = require('querystring');
const logger = require('../utils/logger');

// QQ机器人API基础URL
const QQ_API_ROOT = 'https://api.sgroup.qq.com';

/**
 * 获取访问令牌
 * @returns {Promise<string>} 访问令牌
 */
async function getAccessToken() {
  try {
    const appId = process.env.QQ_BOT_APP_ID;
    const appSecret = process.env.QQ_BOT_SECRET;
    
    if (!appId || !appSecret) {
      throw new Error('未配置QQ_BOT_APP_ID或QQ_BOT_SECRET环境变量');
    }
    
    // 获取访问令牌 - 使用正确的API地址
    const tokenResponse = await axios.post(
      'https://bots.qq.com/app/getAppAccessToken',
      {
        appId: appId,
        clientSecret: appSecret
      },
      {
        headers: {
          'Content-Type': 'application/json'
        }
      }
    );
    
    if (!tokenResponse.data || !tokenResponse.data.access_token) {
      throw new Error('获取访问令牌失败: ' + JSON.stringify(tokenResponse.data));
    }
    
    logger.debug(`获取访问令牌成功，有效期: ${tokenResponse.data.expires_in}秒`);
    return tokenResponse.data.access_token;
  } catch (error) {
    logger.error('获取访问令牌失败', error.message);
    if (error.response) {
      logger.debug('QQ token API 请求失败', { status: error.response.status });
    }
    throw error;
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
    
    if (!message || !message.content) {
      throw new Error('消息内容不能为空');
    }
    
    // 确保msg_type有效
    if (message.msg_type === undefined) {
      message.msg_type = 0; // 默认为文本消息
    }
    
    // 富媒体消息类型需要特殊处理
    if (message.msg_type === 7 && message.content.trim() === '') {
      message.content = ' '; // 富媒体消息content需要有值
    }
    
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
        }
      }
    );
    
    logger.info('群聊消息发送成功');
    return response.data;
    
  } catch (error) {
    logger.error('发送群聊消息失败', error.message);
    if (error.response) {
      logger.debug('QQ API 请求失败', { status: error.response.status });
    }
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
async function sendTextToGroup(groupOpenid, content, eventId = null, msgId = null) {
  return sendGroupMessage(
    groupOpenid,
    {
      content,
      msg_type: 0 // 文本消息
    },
    eventId,
    msgId
  );
}

/**
 * 发送Markdown消息到群聊
 * @param {string} groupOpenid - 群聊的openid
 * @param {string} content - 占位内容
 * @param {object} markdown - Markdown对象
 * @param {string} [eventId] - 前置事件ID (可选)
 * @param {string} [msgId] - 前置消息ID (可选)
 * @returns {Promise<object>} 发送结果
 */
async function sendMarkdownToGroup(groupOpenid, content, markdown, eventId = null, msgId = null) {
  return sendGroupMessage(
    groupOpenid,
    {
      content,
      msg_type: 2, // Markdown消息
      markdown
    },
    eventId,
    msgId
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
async function sendMediaToGroup(groupOpenid, media, eventId = null, msgId = null) {
  if (!media || !media.file_info) {
    throw new Error('富媒体消息必须包含file_info字段');
  }
  
  return sendGroupMessage(
    groupOpenid,
    {
      content: ' ', // 富媒体消息需要内容，即使是空的
      msg_type: 7, // 富媒体消息
      media: {
        file_info: media.file_info
      }
    },
    eventId,
    msgId
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
        }
      }
    );
    
    logger.info('频道消息发送成功');
    return response.data;
    
  } catch (error) {
    logger.error('发送频道消息失败', error.message);
    if (error.response) {
      logger.debug('QQ API 请求失败', { status: error.response.status });
    }
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
    
    if (!message || !message.content) {
      throw new Error('消息内容不能为空');
    }
    
    // 确保msg_type有效
    if (message.msg_type === undefined) {
      message.msg_type = 0; // 默认为文本消息
    }
    
    // 富媒体消息类型需要特殊处理
    if (message.msg_type === 7 && message.content.trim() === '') {
      message.content = ' '; // 富媒体消息content需要有值
    }
    
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
        }
      }
    );
    
    logger.info('QQ单聊消息发送成功');
    return response.data;
    
  } catch (error) {
    logger.error('发送QQ单聊消息失败', error.message);
    if (error.response) {
      logger.debug('QQ API 请求失败', { status: error.response.status });
    }
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
async function sendTextToC2C(userOpenid, content, eventId = null, msgId = null) {
  return sendC2CMessage(
    userOpenid,
    {
      content,
      msg_type: 0 // 文本消息
    },
    eventId,
    msgId
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
        }
      }
    );
    
    logger.info('频道私信消息发送成功');
    return response.data;
    
  } catch (error) {
    logger.error('发送频道私信消息失败', error.message);
    if (error.response) {
      logger.debug('QQ API 请求失败', { status: error.response.status });
    }
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
  getAccessToken
}; 