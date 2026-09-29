/**
 * 频道消息处理器
 * 处理频道中@机器人的消息 (AT_MESSAGE_CREATE事件)
 */

const fs = require('fs');
const path = require('path');
const { sendTextToChannel, sendImageToChannel } = require('../services/messageService');
const { processBase64Image, getImageInfo } = require('../utils/imageProcessor');
const { executeInput } = require('../services/localCommandService');
const logger = require('../utils/logger');

/**
 * 处理频道@机器人消息
 */
async function handleChannelAtMessage(eventData, eventType = null) {
  try {
    // 获取消息内容和相关信息
    // 注意：频道消息的数据结构与群聊消息不同
    const { content, author, member, channel_id, guild_id, id: messageId, attachments } = eventData;
    
    // 获取用户名称用于日志
    const userName = (member && member.nick) || author.username || '未知用户';
    
    // 检查是否有文本内容，如果没有则直接忽略
    if (!content) {
      logger.debug('收到无文本内容的消息，忽略处理');
      return;
    }
    
    // 消息内容预处理（去除@机器人标记和前后空格）
    // AT_MESSAGE_CREATE格式：<@!927784118400615010> /meu 释魂 手里剑
    // MESSAGE_CREATE格式：meu 释魂 手里剑
    let trimmedContent = content.trim();
    
    // 检查是否包含@机器人标记
    const containsAtBot = /<@!\d+>/.test(trimmedContent);
    
    // 如果是MESSAGE_CREATE事件且包含@机器人标记，则跳过处理
    // 因为这种情况下也会收到AT_MESSAGE_CREATE事件，避免重复处理
    if (eventType === 'MESSAGE_CREATE' && containsAtBot) {
      logger.debug('MESSAGE_CREATE事件包含@机器人标记，跳过处理');
      return;
    }
    
    // 移除@机器人的标记（格式：<@!机器人ID>），如果存在的话
    trimmedContent = trimmedContent.replace(/<@!\d+>\s*/g, '').trim();
    
    // 记录收到的消息
    logger.message('频道', userName, trimmedContent);
    
    const result = await processLocalMessage(trimmedContent, author, member, guild_id);
    if (result && result.status === "ok" && result.data) {
      await sendReplyToChannel(result.data, channel_id, messageId);
    }
  } catch (error) {
    logger.error('处理频道@消息失败', error.message);
  }
}

/**
 * 发送回复到频道
 * @param {object} responseData - API响应数据
 * @param {string} channelId - 频道ID
 * @param {string} messageId - 用户消息ID
 */
async function sendReplyToChannel(responseData, channelId, messageId) {
  try {
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
      
      // 获取绝对URL路径并进行URL编码
      const serverHost = process.env.SERVER_HOST || 'http://localhost:3000';
      const encodedFileName = encodeURIComponent(fileName);
      const imageUrl = `${serverHost}/temp_images/${encodedFileName}`;
      
      if (responseData.message) {
        const convertedMessage = convertCQCodeToQQFormat(responseData.message);
        // 频道接口可在同一个消息体中同时携带 content 和 image。
        await sendImageToChannel(channelId, imageUrl, convertedMessage, null, messageId);
      } else {
        // 只发送图片
        await sendImageToChannel(channelId, imageUrl, '', null, messageId);
      }
      
    } else if (responseData.type === "text" && responseData.message) {
      // 处理文本消息
      // 转换CQ码格式
      const convertedMessage = convertCQCodeToQQFormat(responseData.message);
      await sendTextToChannel(channelId, convertedMessage, null, messageId);
    }
  } catch (error) {
    logger.error('发送频道回复失败', error.message);
  }
}

// 注意：频道API不需要先上传文件获取file_info，直接使用图片URL即可

/**
 * 将CQ码格式转换为QQ机器人API格式
 * @param {string} message - 包含CQ码的消息
 * @returns {string} 转换后的消息
 */
function convertCQCodeToQQFormat(message) {
  if (!message || typeof message !== 'string') {
    return message;
  }
  
  // 将 [CQ:at,qq=用户ID] 转换为 <@!用户ID>
  // 使用 <@!user_id> 格式（带感叹号的版本）
  const atRegex = /\[CQ:at,qq=(\d+)\]/g;
  const convertedMessage = message.replace(atRegex, '<@!$1>');
  
  if (convertedMessage !== message) {
    logger.debug(`CQ码转换: "${message}" -> "${convertedMessage}"`);
  }
  
  return convertedMessage;
}

/**
 * 获取频道配置
 * @returns {object} 频道配置对象
 */
function getChannelConfig() {
  try {
    const configPath = path.join(__dirname, '../config/channel.json');
    const configData = fs.readFileSync(configPath, 'utf8');
    return JSON.parse(configData);
  } catch (error) {
    logger.error('读取频道配置文件失败', error.message);
    return {};
  }
}

/**
 * 处理本地消息
 * @param {string} input - 用户输入
 * @param {object} author - 用户信息对象
 * @param {object} member - 成员信息对象
 * @param {string} guildId - 服务器ID（频道所属的服务器）
 */
async function processLocalMessage(input, author, member, guildId) {
  const channelConfig = getChannelConfig();
  return executeInput(input, {
    userId: author.id,
    userName: author.username || (member && member.nick) || `QQ-${author.id}`,
    groupId: channelConfig.channel_exchange_group || guildId || 'global',
    groupName: channelConfig.channel_name || `频道-${guildId || 'global'}`,
    canManageQa: String(author.id) === String(channelConfig.admin_user || '')
  });
}

module.exports = {
  handleChannelAtMessage
};
