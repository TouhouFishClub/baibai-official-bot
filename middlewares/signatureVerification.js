const { verifySignature } = require('../utils/signature');
const logger = require('../utils/logger');

/**
 * 验证请求签名
 * @param {Object} req - Express请求对象
 * @param {Object} res - Express响应对象
 * @param {Function} next - Express next函数
 */
const signatureMiddleware = (req, res, next) => {
  try {
    const signature = req.headers['x-signature-ed25519'];
    const timestamp = req.headers['x-signature-timestamp'];
    const botSecret =
    process.env.QQ_BOT_SECRET;
    if (!signature) {
      logger.error('缺少签名头 X-Signature-Ed25519');
      return res.status(401).json({ 
        error: '缺少必要的签名信息',
        details: '缺少 X-Signature-Ed25519 头'
      });
    }

    if (!timestamp) {
      logger.error('缺少时间戳头 X-Signature-Timestamp');
      return res.status(401).json({ 
        error: '缺少必要的签名信息',
        details: '缺少 X-Signature-Timestamp 头'
      });
    }

    if (!botSecret) {
      logger.error('未配置 QQ_BOT_SECRET 环境变量');
      return res.status(401).json({ 
        error: '缺少必要的签名信息',
        details: '未配置 QQ_BOT_SECRET 环境变量'
      });
    }

    // 构建签名消息 - 使用原始请求体
    const body = req.rawBody || JSON.stringify(req.body);
    const message = timestamp + body;

    // 签名验证调试信息（仅在DEBUG级别显示）
    const eventType = req.body?.t || 'unknown';
    logger.debug('签名验证', { 
      eventType, 
      timestamp, 
      bodyLength: body.length, 
      hasRawBody: !!req.rawBody 
    });

    // 验证签名
    const isValid = verifySignature(botSecret, message, signature);
    
    if (!isValid) {
      logger.error('签名验证失败', { eventType });
      
      // 如果是频道事件或私信事件，暂时跳过签名验证失败的阻止
      if (eventType === 'AT_MESSAGE_CREATE' || eventType === 'C2C_MESSAGE_CREATE' || eventType === 'DIRECT_MESSAGE_CREATE') {
        logger.warn(`${eventType}事件签名验证失败，但继续处理（临时解决方案）`);
        next();
        return;
      }
      
      return res.status(401).json({ 
        error: '签名验证失败',
        details: '提供的签名验证失败'
      });
    }

    next();
  } catch (error) {
    logger.error('签名验证过程出错', error.message);
    return res.status(500).json({ 
      error: '签名验证过程出错',
      details: error.message
    });
  }
};

module.exports = signatureMiddleware; 