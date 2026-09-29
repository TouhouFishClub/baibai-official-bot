/**
 * 论坛相关路由
 * 处理帖子发表等功能
 */

const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middlewares/authMiddleware');
const { 
  publishExampleThread,
  publishThread,
  publishMarkdownThread,
  publishTextThread,
  getChannelInfo,
  getGuildsList,
  getChannelsList,
  getAccessToken
} = require('../services/forumService');

router.use(authenticateToken);

/**
 * API状态检查
 * GET /put/status
 */
router.get('/status', async (req, res) => {
  try {
    // 尝试获取访问令牌来检查API状态
    const token = await getAccessToken();
    
    res.json({
      success: true,
      message: 'API服务正常',
      data: {
        status: 'healthy',
        timestamp: new Date().toISOString(),
        token_status: token ? 'valid' : 'invalid'
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'API服务异常',
      error: error.message
    });
  }
});

/**
 * 获取机器人所在的频道服务器列表
 * GET /put/guilds
 */
router.get('/guilds', async (req, res) => {
  try {
    console.log('收到获取频道服务器列表请求');
    
    const guildsList = await getGuildsList();
    
    res.json({
      success: true,
      message: '成功获取频道服务器列表',
      data: guildsList
    });
    
  } catch (error) {
    console.error('获取频道服务器列表失败:', error.message);
    res.status(500).json({
      success: false,
      error: error.message,
      message: '无法获取频道服务器列表，请检查机器人权限'
    });
  }
});

/**
 * 获取指定频道服务器下的子频道列表
 * GET /put/channels?guild_id=xxx
 */
router.get('/channels', async (req, res) => {
  try {
    const { guild_id } = req.query;
    
    if (!guild_id) {
      return res.status(400).json({
        success: false,
        error: '缺少guild_id参数',
        message: '请在查询参数中提供guild_id，例如: /put/channels?guild_id=频道服务器ID'
      });
    }
    
    console.log(`收到获取子频道列表请求，频道服务器ID: ${guild_id}`);
    
    const channelsList = await getChannelsList(guild_id);
    
    res.json({
      success: true,
      message: '成功获取子频道列表',
      data: channelsList
    });
    
  } catch (error) {
    console.error('获取子频道列表失败:', error.message);
    res.status(500).json({
      success: false,
      error: error.message,
      message: '无法获取子频道列表，请检查频道服务器ID是否正确'
    });
  }
});

/**
 * 调试路由 - 获取频道信息
 * GET /put/debug?channel_id=xxx
 */
router.get('/debug', async (req, res) => {
  try {
    const { channel_id } = req.query;
    
    if (!channel_id) {
      return res.status(400).json({
        success: false,
        error: '缺少channel_id参数',
        message: '请在查询参数中提供channel_id，例如: /put/debug?channel_id=频道ID'
      });
    }
    
    console.log(`收到调试请求，频道ID: ${channel_id}`);
    
    // 尝试获取频道信息
    const channelInfo = await getChannelInfo(channel_id);
    
    res.json({
      success: true,
      message: '成功获取频道信息',
      data: channelInfo
    });
    
  } catch (error) {
    console.error('获取频道信息失败:', error.message);
    res.status(500).json({
      success: false,
      error: error.message,
      message: '无法获取频道信息，可能频道不存在或机器人无权限访问'
    });
  }
});



/**
 * 自定义发帖功能 - 支持管理页面
 * POST /put/custom
 * Body: {
 *   "channel_id": "频道ID",
 *   "title": "帖子标题", 
 *   "content": "帖子内容",
 *   "format": 1-4 (可选，默认为2-HTML)
 * }
 */
router.post('/custom', async (req, res) => {
  try {
    const { channel_id, title, content, format = 2 } = req.body;
    
    // 参数验证
    if (!channel_id || !title || !content) {
      return res.status(400).json({
        success: false,
        error: '缺少必需参数',
        message: '请提供channel_id、title和content参数'
      });
    }

    // 格式验证
    if (![1, 2, 3, 4].includes(format)) {
      return res.status(400).json({
        success: false,
        error: '格式参数无效',
        message: 'format参数必须是1-4之间的数字'
      });
    }

    // 内容长度验证
    if (title.length > 100) {
      return res.status(400).json({
        success: false,
        error: '标题过长',
        message: '标题长度不能超过100个字符'
      });
    }

    if (content.length > 20000) {
      return res.status(400).json({
        success: false,
        error: '内容过长',
        message: '内容长度不能超过20000个字符'
      });
    }
    
    console.log(`收到发帖请求 - 频道: ${channel_id}, 标题: "${title}", 格式: ${format}`);
    
    // 调用发帖服务
    const result = await publishThread(channel_id, title, content, format);
    
    res.json({
      success: true,
      message: '帖子发布成功',
      data: {
        task_id: result.task_id,
        create_time: result.create_time,
        channel_id: channel_id,
        title: title,
        format: format
      }
    });
    
  } catch (error) {
    console.error('发帖失败:', error.message);
    
    // 根据错误类型返回不同的错误信息
    let errorMessage = '发帖失败，请检查参数是否正确';
    if (error.message.includes('频道不存在')) {
      errorMessage = '指定的频道不存在或机器人无权限访问';
    } else if (error.message.includes('权限')) {
      errorMessage = '机器人在该频道没有发帖权限';
    } else if (error.message.includes('token') || error.message.includes('认证')) {
      errorMessage = '机器人认证失败，请检查配置';
    }
    
    res.status(500).json({
      success: false,
      error: error.message,
      message: errorMessage
    });
  }
});

/**
 * 发表Markdown格式帖子
 * POST /put/markdown
 * Body: {
 *   "channel_id": "频道ID",
 *   "title": "帖子标题",
 *   "content": "Markdown内容"
 * }
 */
router.post('/markdown', async (req, res) => {
  try {
    const { channel_id, title, content } = req.body;
    
    if (!channel_id || !title || !content) {
      return res.status(400).json({
        success: false,
        error: '缺少必需参数',
        message: '请提供channel_id、title和content参数'
      });
    }
    
    console.log(`收到Markdown发帖请求，频道ID: ${channel_id}, 标题: ${title}`);
    
    // 调用Markdown发帖服务
    const result = await publishMarkdownThread(channel_id, title, content);
    
    res.json({
      success: true,
      message: 'Markdown帖子发送成功',
      data: result
    });
    
  } catch (error) {
    console.error('Markdown发帖失败:', error.message);
    res.status(500).json({
      success: false,
      error: error.message,
      message: '发帖失败，请检查参数是否正确以及机器人是否有发帖权限'
    });
  }
});

/**
 * 发表纯文本格式帖子
 * POST /put/text
 * Body: {
 *   "channel_id": "频道ID",
 *   "title": "帖子标题",
 *   "content": "文本内容"
 * }
 */
router.post('/text', async (req, res) => {
  try {
    const { channel_id, title, content } = req.body;
    
    if (!channel_id || !title || !content) {
      return res.status(400).json({
        success: false,
        error: '缺少必需参数',
        message: '请提供channel_id、title和content参数'
      });
    }
    
    console.log(`收到文本发帖请求，频道ID: ${channel_id}, 标题: ${title}`);
    
    // 调用文本发帖服务
    const result = await publishTextThread(channel_id, title, content);
    
    res.json({
      success: true,
      message: '文本帖子发送成功',
      data: result
    });
    
  } catch (error) {
    console.error('文本发帖失败:', error.message);
    res.status(500).json({
      success: false,
      error: error.message,
      message: '发帖失败，请检查参数是否正确以及机器人是否有发帖权限'
    });
  }
});

module.exports = router;
