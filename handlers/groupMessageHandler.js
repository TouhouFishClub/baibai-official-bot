/**
 * 群消息处理器
 * 处理群中@机器人的消息，以及群全量消息 GROUP_MESSAGE_CREATE
 */

const axios = require('axios');
const fs = require('fs');
const path = require('path');
const {
  sendTextToGroup,
  sendMediaToGroup,
  getAccessToken,
  QQ_API_ROOT,
  QQ_API_TIMEOUT_MS
} = require('../services/messageService');
const { processBase64Image, getImageInfo } = require('../utils/imageProcessor');
const { executeInput } = require('../services/localCommandService');
const logger = require('../utils/logger');

const recentGroupMessageIds = new Map();
const GROUP_MESSAGE_DEDUP_MS = 60 * 1000;

function resolveGroupOpenid(eventData = {}) {
  return eventData.group_openid || eventData.group_id || null;
}

function rememberGroupMessage(messageId) {
  if (!messageId) {
    return false;
  }

  const now = Date.now();
  for (const [id, seenAt] of recentGroupMessageIds) {
    if (now - seenAt > GROUP_MESSAGE_DEDUP_MS) {
      recentGroupMessageIds.delete(id);
    }
  }

  if (recentGroupMessageIds.has(messageId)) {
    return true;
  }

  recentGroupMessageIds.set(messageId, now);
  return false;
}

/**
 * 处理群@消息和群全量消息
 */
async function handleGroupAtMessage(eventData, eventType = null) {
  try {
    logger.debug('处理群消息', {
      eventType,
      groupId: resolveGroupOpenid(eventData),
      contentLength: String(eventData.content || '').length
    });

    // 获取消息内容和相关信息
    const { content, author, id: messageId } = eventData;
    const replyGroupOpenid = resolveGroupOpenid(eventData);

    if (rememberGroupMessage(messageId)) {
      logger.debug('群消息已处理，跳过重复事件', { eventType, messageId });
      return;
    }
    
    // 消息内容预处理（去除前后空格）
    const trimmedContent = (content || '').trim();
    if (!trimmedContent) {
      logger.debug('群消息无文本内容，忽略处理', { eventType, messageId });
      return;
    }
    
    logger.debug('群消息准备本地处理', {
      hasGroupOpenid: Boolean(eventData.group_openid),
      usingGroupIdFallback: !eventData.group_openid && Boolean(eventData.group_id),
      replyGroupOpenidPresent: Boolean(replyGroupOpenid)
    });

    const startedAt = Date.now();
    const result = await processLocalMessage(trimmedContent, author.id, replyGroupOpenid);
    logger.debug('群消息本地处理完成', {
      durationMs: Date.now() - startedAt,
      status: result?.status,
      hasData: Boolean(result?.data),
      responseType: result?.data?.type
    });

    if (result && result.status === "ok" && result.data) {
      await sendReplyToGroup(result.data, replyGroupOpenid, messageId);
    }
  } catch (error) {
    logger.error('处理群聊@消息失败', error);
  }
}

/**
 * 发送回复到群聊
 * @param {object} responseData - API响应数据
 * @param {string} groupOpenid - 群聊openid
 * @param {string} messageId - 用户消息ID
 */
async function sendReplyToGroup(responseData, groupOpenid, messageId) {
  try {
    logger.debug('准备发送群聊回复', {
      responseType: responseData?.type,
      groupOpenidPresent: Boolean(groupOpenid),
      messageIdPresent: Boolean(messageId)
    });

    if (responseData.type === "image" && responseData.base64 && responseData.path) {
      // 处理图片消息
      // 创建临时图片目录
      const tempImageDir = path.join(__dirname, '../public/temp_images');
      if (!fs.existsSync(tempImageDir)) {
        fs.mkdirSync(tempImageDir, { recursive: true });
      }
      
      // 获取文件名并处理中文字符
      const originalFileName = path.basename(responseData.path);
      const fileName = originalFileName;
      const imagePath = path.join(tempImageDir, fileName);
      
      // 使用图片处理器处理base64图片（包含压缩）
      const processSuccess = await processBase64Image(responseData.base64, imagePath);
      
      if (!processSuccess) {
        logger.error('图片处理失败，跳过发送');
        return;
      }
      
      // 显示图片信息
      const imageInfo = await getImageInfo(imagePath);
      if (imageInfo) {
        logger.info(`图片处理完成: ${imageInfo.width}x${imageInfo.height}, ${imageInfo.format}, ${imageInfo.sizeMB}MB`);
      }
      
      // 获取绝对URL路径并进行URL编码
      const serverHost = process.env.SERVER_HOST || 'http://localhost:3000';
      const encodedFileName = encodeURIComponent(fileName);
      const imageUrl = `${serverHost}/temp_images/${encodedFileName}`;
      
      // 调用QQ API上传图片，获取file_info
      const fileInfo = await uploadFileForGroup(groupOpenid, imageUrl, 1); // 1表示图片类型
      
      // 群聊 msg_type=7 时仅 media 字段生效，文本需作为下一条回复发送。
      if (responseData.message) {
        await sendMediaToGroup(groupOpenid, { file_info: fileInfo }, null, messageId, 1);
        await sendTextToGroup(groupOpenid, responseData.message, null, messageId, 2);
      } else {
        // 只有图片，没有文本
        await sendMediaToGroup(groupOpenid, { file_info: fileInfo }, null, messageId);
      }
      
    } else if (responseData.type === "text" && responseData.message) {
      // 处理文本消息
      await sendTextToGroup(groupOpenid, responseData.message, null, messageId);
    }
  } catch (error) {
    if (!error.alreadyLogged) {
      logger.error('发送群聊回复失败', error);
    }
  }
}

/**
 * 上传文件获取file_info
 * @param {string} groupOpenid - 群聊的openid
 * @param {string} url - 文件URL
 * @param {number} fileType - 文件类型（1:图片, 2:视频, 3:语音, 4:文件）
 * @returns {Promise<string>} file_info
 */
async function uploadFileForGroup(groupOpenid, url, fileType) {
  try {
    const axios = require('axios');
    
    // 获取访问令牌
    const accessToken = await getAccessToken();
    
    // 构建上传文件请求
    const response = await axios.post(
      `${QQ_API_ROOT}/v2/groups/${groupOpenid}/files`,
      {
        file_type: fileType,
        url: url,
        srv_send_msg: false // 不直接发送，仅获取file_info
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `QQBot ${accessToken}`
        },
        timeout: QQ_API_TIMEOUT_MS
      }
    );
    
    if (!response.data || !response.data.file_info) {
      throw new Error('上传文件失败，未获取到file_info');
    }
    
    logger.info('文件上传成功');
    return response.data.file_info;
    
  } catch (error) {
    if (!error?.alreadyLogged) {
      logger.error('上传文件失败', error);
    }
    if (error && typeof error === 'object') error.alreadyLogged = true;
    throw error;
  }
}

/**
 * 获取映射后的群组ID
 * 从groups.json中读取配置，如果groupId匹配且enabled为true，则返回配置的group_id
 * @param {string} groupId - 原始群组ID
 * @returns {string} 映射后的群组ID
 */
function getMappedGroupId(groupId) {
  try {
    const groupsConfigPath = path.join(__dirname, '../config/groups.json');
    
    // 检查配置文件是否存在
    if (!fs.existsSync(groupsConfigPath)) {
      logger.debug('groups.json配置文件不存在，使用原始groupId');
      return groupId;
    }
    
    // 读取配置文件
    const groupsConfig = JSON.parse(fs.readFileSync(groupsConfigPath, 'utf-8'));
    
    // 检查是否有匹配的配置
    if (groupsConfig[groupId] && groupsConfig[groupId].enabled === true) {
      const mappedId = groupsConfig[groupId].group_id;
      if (mappedId) {
        return mappedId;
      }
    }
    
    // 没有匹配或未启用，返回原始ID
    return groupId;
  } catch (error) {
    logger.error('读取群组配置失败', error.message);
    return groupId;
  }
}

/**
 * 处理本地消息
 * @param {string} input - 用户输入
 * @param {string} userId - 用户ID
 * @param {string} groupId - 群组ID
 */
async function processLocalMessage(input, userId, groupId) {
  const mappedGroupId = getMappedGroupId(groupId);
  return executeInput(input, {
    userId,
    userName: `QQ-${userId}`,
    groupId: mappedGroupId || groupId || 'global',
    groupName: `QQ群-${mappedGroupId || groupId || 'global'}`,
    sourceGroupId: groupId
  });
}

module.exports = {
  handleGroupAtMessage,
  resolveGroupOpenid
};