/**
 * Webhook控制器
 * 处理QQ机器人的事件订阅与通知
 */

const { handleValidation } = require('../handlers/validationHandler');
const { handleDispatchEvent } = require('../events/eventDispatcher');
const { OP_CODE } = require('../utils/constants');
const logger = require('../utils/logger');

/**
 * 处理来自QQ机器人平台的Webhook请求
 */
exports.handleWebhook = async (req, res) => {
  try {
    const payload = req.body;
    const botAppId = req.headers['x-bot-appid'];
    
    logger.debug('收到QQ Webhook请求', { op: payload.op, type: payload.t, botAppId });
    
    if (!payload) {
      return res.status(400).json({ error: '无效的请求负载' });
    }
    
    // 根据不同的opcode处理不同类型的事件
    switch (payload.op) {
      case OP_CODE.CALLBACK_VALIDATION:
        // 处理回调地址验证
        await handleValidation(payload, res);
        break;
        
      case OP_CODE.DISPATCH:
        // 处理事件推送
        await handleDispatchEvent(payload, res);
        break;
        
      default:
        logger.warn(`未处理的OpCode: ${payload.op}`);
        // 对于其他未处理的op code，返回HTTP回调确认
        res.json({ 
          op: OP_CODE.HTTP_CALLBACK_ACK 
        });
    }
    
  } catch (error) {
    logger.error('Webhook处理错误', error.message);
    // 确保在错误情况下也返回正确的回调确认格式
    res.status(200).json({
      op: OP_CODE.HTTP_CALLBACK_ACK
    });
  }
};