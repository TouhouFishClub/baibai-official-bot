/**
 * 群消息处理器
 * 处理群中@机器人的消息。
 * 未开全量时事件是 GROUP_AT_MESSAGE_CREATE，content 已去掉@机器人前缀。
 * 开启全量后同一条@会变成 GROUP_MESSAGE_CREATE，content 保留 <@member_openid>，
 * 是否@到自己看 mentions[].is_you。全量消息都记入 info 日志，但只处理@自己的消息。
 */

const fs = require('fs');
const path = require('path');
const {
  sendTextToGroup,
  sendMediaToGroup
} = require('../services/messageService');
const { processBase64Image } = require('../utils/imageProcessor');
const { executeInput } = require('../services/localCommandService');
const { rememberGroupOpenid, getStoredGroupName, getLogLabels } = require('../services/groupInfoService');
const { uploadRichMedia } = require('../services/richMediaUpload');
const { joinPublicUrl } = require('../utils/publicUrl');
const logger = require('../utils/logger');
const { logIncoming, logOutgoing } = require('../services/messageLogService');
const { EVENT_TYPE } = require('../utils/constants');

const SELF_MENTION_ID_KEYS = ['id', 'member_openid', 'openid', 'user_openid'];
const MENTION_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

function mentionIds(mention) {
  if (!mention || typeof mention !== 'object') return [];
  const ids = [];
  for (const key of SELF_MENTION_ID_KEYS) {
    const value = mention[key];
    if (typeof value !== 'string' || value === 'all' || !MENTION_ID_PATTERN.test(value)) continue;
    if (!ids.includes(value)) ids.push(value);
  }
  return ids;
}

function findSelfMentionTokens(content, mentions) {
  if (typeof content !== 'string' || !Array.isArray(mentions)) return [];
  const tokens = [];
  for (const mention of mentions) {
    if (!mention || mention.is_you !== true) continue;
    for (const id of mentionIds(mention)) {
      for (const token of [`<@${id}>`, `<@!${id}>`]) {
        if (content.includes(token) && !tokens.includes(token)) tokens.push(token);
      }
    }
  }
  return tokens;
}

/**
 * 全量群消息只收下明确@到本机器人、且正文里有对应 <@id> 的消息，并去掉这段前缀。
 * GROUP_AT_MESSAGE_CREATE 的正文已由平台去掉@机器人，原样使用。
 */
function normalizeGroupInbound(eventType, eventData = {}) {
  const content = eventData.content || '';
  if (eventType === EVENT_TYPE.GROUP_MESSAGE_CREATE) {
    const tokens = findSelfMentionTokens(content, eventData.mentions);
    if (tokens.length === 0) {
      return { accept: false, content: String(content).trim() };
    }
    let text = String(content);
    for (const token of tokens) text = text.split(token).join('');
    return { accept: true, content: text.trim() };
  }
  return { accept: true, content: String(content).trim() };
}

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
 * 处理群@消息。全量消息都写入 info 日志；命令只处理 mentions[].is_you 命中的消息。
 */
async function handleGroupAtMessage(eventData, eventType = null) {
  try {
    const normalized = normalizeGroupInbound(eventType, eventData);
    const rawContent = String(eventData.content || '').trim();

    logger.debug('处理群消息', {
      eventType,
      groupId: resolveGroupOpenid(eventData),
      contentLength: rawContent.length,
      accept: normalized.accept
    });

    // 获取消息内容和相关信息
    const { author, id: messageId } = eventData;
    const replyGroupOpenid = resolveGroupOpenid(eventData);

    if (rememberGroupMessage(messageId)) {
      logger.debug('群消息已处理，跳过重复事件', { eventType, messageId });
      return;
    }

    if (!rawContent) {
      logger.debug('群消息无文本内容，忽略处理', { eventType, messageId });
      return;
    }

    const userId = author?.id || author?.member_openid || author?.user_openid;
    const labels = await getLogLabels(replyGroupOpenid, userId);
    void rememberGroupOpenid(replyGroupOpenid, { author });
    logIncoming({
      type: '群',
      eventType: eventType || 'GROUP_AT_MESSAGE_CREATE',
      groupId: replyGroupOpenid,
      groupName: labels.groupName,
      userId,
      userName: labels.userName,
      content: rawContent,
      messageId,
      timestamp: eventData.timestamp,
      isBot: Boolean(author?.bot)
    });

    if (!normalized.accept) {
      const mentions = Array.isArray(eventData?.mentions) ? eventData.mentions : [];
      logger.debug('群全量消息未@机器人，仅记录不处理', {
        eventType,
        groupId: replyGroupOpenid,
        messageId,
        mentionCount: mentions.length,
        selfMarked: mentions.some((item) => item?.is_you === true)
      });
      return;
    }

    // 全量消息里的@自己前缀已去掉，与 GROUP_AT_MESSAGE_CREATE 的正文对齐
    const trimmedContent = normalized.content;
    if (!trimmedContent) {
      logger.debug('群消息去掉@后无文本内容，忽略处理', { eventType, messageId });
      return;
    }

    const startedAt = Date.now();
    const result = await processLocalMessage(trimmedContent, userId, replyGroupOpenid);
    logger.debug('群消息本地处理完成', {
      durationMs: Date.now() - startedAt,
      status: result?.status,
      hasData: Boolean(result?.data),
      responseType: result?.data?.type
    });

    if (result && result.status === "ok" && result.data) {
      await sendReplyToGroup(result.data, replyGroupOpenid, messageId, userId);
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
async function sendReplyToGroup(responseData, groupOpenid, messageId, userId = null) {
  try {
    const labels = await getLogLabels(groupOpenid, userId);
    logOutgoing({
      type: '群',
      groupId: groupOpenid,
      groupName: labels.groupName,
      userId,
      userName: labels.userName,
      content: logger.describeReplyPayload(responseData)
    });

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

      const imageUrl = joinPublicUrl(`temp_images/${encodeURIComponent(fileName)}`);
      logger.debug('群聊图片先分片上传再发送', { fileName });

      const fileInfo = await uploadFileForGroup(groupOpenid, imageUrl, 1, imagePath);
      
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
async function uploadFileForGroup(groupOpenid, url, fileType, filePath) {
  try {
    return await uploadRichMedia(`/v2/groups/${groupOpenid}/files`, {
      fileType,
      filePath,
      url
    });
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
  const storedName = await getStoredGroupName(groupId);
  return executeInput(input, {
    userId,
    userName: `QQ-${userId}`,
    groupId: mappedGroupId || groupId || 'global',
    groupName: storedName || `QQ群-${mappedGroupId || groupId || 'global'}`,
    sourceGroupId: groupId
  });
}

module.exports = {
  handleGroupAtMessage,
  normalizeGroupInbound,
  resolveGroupOpenid
};