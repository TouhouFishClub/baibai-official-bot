const dotenvResult = require('dotenv').config();
if (dotenvResult.parsed?.LOG_LEVEL) {
  process.env.LOG_LEVEL = dotenvResult.parsed.LOG_LEVEL;
}
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const path = require('path');
const config = require('./config');

// 引入中间件
const verifySignature = require('../middlewares/signatureVerification');
const probeGuard = require('../middlewares/probeGuard');
const rateLimit = require('../middlewares/rateLimit');

// 引入路由
const webhookController = require('../controllers/webhookController');
const forumRoutes = require('../routes/forumRoutes');
const autoPushRoutes = require('../routes/autoPushRoutes');
const adminAuthRoutes = require('../routes/adminAuthRoutes');

// 引入自动推送服务
const autoPushService = require('../services/autoPushService');
const { connectMongoIfConfigured, getMongoConfig } = require('../services/mongo');
const logger = require('../utils/logger');

// 初始化Express应用
const app = express();
const PORT = process.env.PORT || config.server.port;

// 反代（Nginx 等）后面需要信任一层，才能拿到真实 IP 做限流
app.set('trust proxy', 1);

// 中间件
if (config.security.enableCors) {
  const corsOptions = {
    origin: config.security.allowedOrigins,
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization', 'x-signature-ed25519', 'x-signature-timestamp']
  };
  app.use(cors(corsOptions));
}

// 为 Webhook 保存签名验证所需的原始请求体。
// 由 body-parser 负责捕获空请求体和无效 JSON，避免解析异常导致进程退出。
app.use('/qq/webhook', bodyParser.json({
  verify: (req, res, buffer) => {
    req.rawBody = buffer.toString('utf8');
  }
}));

// 拦截扫描探针（在解析 body / 写日志之前直接 404）
app.use(probeGuard);
app.use(rateLimit);

// 其他路由使用标准的body parser
app.use((req, res, next) => {
  if (req.path === '/qq/webhook') {
    return next(); // webhook路由已经处理过了
  }
  bodyParser.json()(req, res, next);
});
app.use(bodyParser.urlencoded({ extended: true }));

// 静态文件服务：不暴露点文件（.env 等）
app.use(express.static(path.join(__dirname, '../public'), {
  dotfiles: 'ignore',
  index: false
}));

// 简单的请求日志中间件
app.use((req, res, next) => {
  logger.api(req.method, req.url);
  next();
});

// QQ Webhook 路由 - 使用签名验证中间件
app.post('/qq/webhook', verifySignature, webhookController.handleWebhook);
app.get('/qq/webhook', (req, res) => {
  res.status(405).json({ error: 'Webhook 仅支持 POST 请求' });
});

// 论坛发帖路由
app.use('/put', forumRoutes);

// 自动推送路由
app.use('/auto-push', autoPushRoutes);

// 管理员认证路由
app.use('/admin', adminAuthRoutes);

// 管理页面路由
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/admin.html'));
});

// 基础路由
app.get('/', (req, res) => {
  res.json({
    message: 'service ok',
    version: '2.0.0'
  });
});

// 404处理
app.use((req, res) => {
  res.status(404).json({ error: '未找到请求的资源' });
});

// 错误处理中间件
app.use((err, req, res, next) => {
  const status = err.status === 400 ? 400 : 500;
  logger.error(status === 400 ? '请求体解析失败' : '服务器错误', err);
  res.status(status).json({
    error: status === 400 ? '请求体不是有效的 JSON' : '服务器内部错误',
    message: config.server.environment === 'development' ? err.message : '请联系管理员'
  });
});

function validateProductionConfig() {
  if (config.server.environment !== 'production') return;
  const required = [
    'QQ_BOT_APP_ID',
    'QQ_BOT_SECRET',
    'JWT_SECRET',
    'ADMIN_USERNAME',
    'ADMIN_PASSWORD',
    'SERVER_HOST',
    'CORS_ORIGINS'
  ];
  const missing = required.filter((key) => !process.env[key]);
  if (missing.length) {
    throw new Error(`生产环境缺少必填配置: ${missing.join(', ')}`);
  }
}

async function startServer(port = PORT) {
  validateProductionConfig();
  const server = app.listen(port, async () => {
  const listeningPort = server.address().port;
  logger.service(`服务器运行在 http://localhost:${listeningPort}`);
  logger.service(`环境: ${config.server.environment}`);
  logger.service(`日志级别: ${process.env.LOG_LEVEL || 'info'}`);
  logger.service(`机器人名称: ${process.env.QQ_BOT_NAME}`);
  logger.service(`QQ Webhook 路径: http://localhost:${listeningPort}/qq/webhook`);

  if (!process.env.JWT_SECRET) {
    logger.warn('未配置 JWT_SECRET，管理端认证不可用');
  }
  if (!process.env.ADMIN_PASSWORD) {
    logger.warn('未配置 ADMIN_PASSWORD，管理端登录不可用');
  }

  try {
    const mongoReady = await connectMongoIfConfigured();
    if (mongoReady) {
      logger.service(`MongoDB 已连接: ${getMongoConfig().database}`);
    } else {
      logger.warn('未配置 MONGODB_URI，群资料不会入库');
    }
  } catch (error) {
    logger.warn('MongoDB 连接失败，群资料缓存不可用', error.message);
  }

  // 初始化自动推送服务
  try {
    await autoPushService.initializeService();
  } catch (error) {
    logger.error('自动推送服务初始化失败', error.message);
  }
});
  return server;
}

if (require.main === module) {
  startServer().catch((error) => {
    logger.error('服务启动失败', error.message);
    process.exitCode = 1;
  });
}

module.exports = { app, startServer, validateProductionConfig };