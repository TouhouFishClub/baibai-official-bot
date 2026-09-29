/**
 * 事件分发处理器
 * 根据不同的事件类型分发到对应的处理器
 */

const { handleGroupAtMessage } = require('../handlers/groupMessageHandler');
const { handleChannelAtMessage } = require('../handlers/channelMessageHandler');
const { handleC2CMessage, handleDirectMessage } = require('../handlers/directMessageHandler');
const { observeGroupOpenid } = require('../services/groupInfoService');
const { observeGuild } = require('../services/guildInfoService');
const { OP_CODE, EVENT_TYPE } = require('../utils/constants');
const logger = require('../utils/logger');

const defaultHandlers = {
  handleGroupAtMessage,
  handleChannelAtMessage,
  handleC2CMessage,
  handleDirectMessage
};

async function dispatchEvent(eventType, eventData, handlers = defaultHandlers) {
  switch (eventType) {
    case EVENT_TYPE.AT_MESSAGE_CREATE:
    case EVENT_TYPE.MESSAGE_CREATE:
      return handlers.handleChannelAtMessage(eventData, eventType);
    case EVENT_TYPE.GROUP_AT_MESSAGE_CREATE:
    case EVENT_TYPE.GROUP_MESSAGE_CREATE:
      return handlers.handleGroupAtMessage(eventData, eventType);
    case EVENT_TYPE.C2C_MESSAGE_CREATE:
      return handlers.handleC2CMessage(eventData);
    case EVENT_TYPE.DIRECT_MESSAGE_CREATE:
      return handlers.handleDirectMessage(eventData);
    default:
      logger.warn(`未处理的事件类型: ${eventType}`);
      return undefined;
  }
}

/**
 * 处理分发事件
 */
async function handleDispatchEvent(payload, res) {
  try {
    if (!payload.t || !payload.d) {
      return res.status(400).json({ error: '无效的事件格式' });
    }
    
    const eventType = payload.t;
    const eventData = payload.d;
    
    logger.debug(`收到事件: ${eventType}`, {
      groupId: eventData.group_openid || eventData.group_id,
      channelId: eventData.channel_id,
      userId: eventData.author?.id
    });

    observeGroupOpenid(eventData);
    observeGuild(eventData);
    
    // 先发送回调确认，避免超时导致的重复推送
    // 返回HTTP回调确认，必须是op: 12的格式
    res.json({
      op: OP_CODE.HTTP_CALLBACK_ACK
    });
    
    // 然后异步处理事件
    try {
      await dispatchEvent(eventType, eventData);
    } catch (processingError) {
      // 事件处理过程中的错误不影响已发送的回调确认
      logger.error('事件处理过程中发生错误', processingError.message);
    }
  } catch (error) {
    logger.error('事件处理错误', error.message);
    // 确保在错误情况下也返回正确的回调确认格式
    return res.status(200).json({
      op: OP_CODE.HTTP_CALLBACK_ACK
    });
  }
}

module.exports = {
  handleDispatchEvent,
  dispatchEvent
}; 