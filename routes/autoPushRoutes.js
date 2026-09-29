/**
 * 自动推送路由 - 多配置版本
 * 处理多个推送配置的管理和控制
 */

const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middlewares/authMiddleware');
const {
  saveConfig,
  getAllConfigs,
  getConfig,
  deleteConfig,
  startConfigPush,
  stopConfigPush,
  stopAllPush,
  executeConfigCheck,
  clearConfigRecords,
  getSystemStatus,
  
  // 兼容旧接口
  setPushConfig,
  getPushConfig,
  startAutoPush,
  stopAutoPush,
  getPushStatus,
  manualPushCheck,
  clearPushedRecords
} = require('../services/autoPushService');

const {
  getLatestPosts,
  getTodayLatestPosts,
  fetchPostDetail
} = require('../services/crawlerService');

router.use(authenticateToken);

/**
 * 获取所有配置
 * GET /auto-push/configs
 */
router.get('/configs', async (req, res) => {
  try {
    const configs = getAllConfigs();
    const systemStatus = getSystemStatus();
    
    res.json({
      success: true,
      message: '获取配置列表成功',
      data: {
        configs: configs,
        summary: {
          total: systemStatus.totalConfigs,
          running: systemStatus.runningConfigs
        }
      }
    });
    
  } catch (error) {
    console.error('获取配置列表失败:', error.message);
    res.status(500).json({
      success: false,
      error: error.message,
      message: '获取配置列表失败'
    });
  }
});

/**
 * 获取单个配置
 * GET /auto-push/configs/:id
 */
router.get('/configs/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const config = getConfig(id);
    
    if (!config) {
      return res.status(404).json({
        success: false,
        error: '配置不存在',
        message: '指定的配置ID不存在'
      });
    }
    
    res.json({
      success: true,
      message: '获取配置成功',
      data: config
    });
    
  } catch (error) {
    console.error('获取配置失败:', error.message);
    res.status(500).json({
      success: false,
      error: error.message,
      message: '获取配置失败'
    });
  }
});

/**
 * 保存配置（新增或更新）
 * POST /auto-push/configs
 * Body: { id?, name, channelId, sourceUrl, sourceName, titlePrefix, format, checkInterval }
 */
router.post('/configs', async (req, res) => {
  try {
    const configData = req.body;
    
    // 验证必需字段
    if (!configData.name) {
      return res.status(400).json({
        success: false,
        error: '缺少配置名称',
        message: '请提供配置名称'
      });
    }
    
    if (!configData.channelId) {
      return res.status(400).json({
        success: false,
        error: '缺少频道ID',
        message: '请提供要推送的频道ID'
      });
    }
    
    if (!configData.sourceUrl) {
      return res.status(400).json({
        success: false,
        error: '缺少源URL',
        message: '请提供要抓取的源URL'
      });
    }
    
    // 验证URL格式
    try {
      new URL(configData.sourceUrl);
    } catch (e) {
      return res.status(400).json({
        success: false,
        error: 'URL格式无效',
        message: '请提供有效的源URL'
      });
    }
    
    const savedConfig = await saveConfig(configData);
    
    res.json({
      success: true,
      message: savedConfig.id && req.body.id ? '配置更新成功' : '配置创建成功',
      data: savedConfig
    });
    
  } catch (error) {
    console.error('保存配置失败:', error.message);
    res.status(500).json({
      success: false,
      error: error.message,
      message: '保存配置失败'
    });
  }
});

/**
 * 删除配置
 * DELETE /auto-push/configs/:id
 */
router.delete('/configs/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const deleted = await deleteConfig(id);
    
    if (!deleted) {
      return res.status(404).json({
        success: false,
        error: '配置不存在',
        message: '指定的配置ID不存在'
      });
    }
    
    res.json({
      success: true,
      message: '配置删除成功'
    });
    
  } catch (error) {
    console.error('删除配置失败:', error.message);
    res.status(500).json({
      success: false,
      error: error.message,
      message: '删除配置失败'
    });
  }
});

/**
 * 启动指定配置的推送
 * POST /auto-push/configs/:id/start
 */
router.post('/configs/:id/start', async (req, res) => {
  try {
    const { id } = req.params;
    startConfigPush(id);
    
    res.json({
      success: true,
      message: '推送已启动',
      data: getConfig(id)
    });
    
  } catch (error) {
    console.error('启动推送失败:', error.message);
    res.status(500).json({
      success: false,
      error: error.message,
      message: '启动推送失败'
    });
  }
});

/**
 * 停止指定配置的推送
 * POST /auto-push/configs/:id/stop
 */
router.post('/configs/:id/stop', async (req, res) => {
  try {
    const { id } = req.params;
    stopConfigPush(id);
    
    res.json({
      success: true,
      message: '推送已停止',
      data: getConfig(id)
    });
    
  } catch (error) {
    console.error('停止推送失败:', error.message);
    res.status(500).json({
      success: false,
      error: error.message,
      message: '停止推送失败'
    });
  }
});

/**
 * 手动检查指定配置
 * POST /auto-push/configs/:id/check
 */
router.post('/configs/:id/check', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await executeConfigCheck(id);
    
    res.json({
      success: result.success,
      message: result.success ? '手动检查完成' : '手动检查失败',
      data: result
    });
    
  } catch (error) {
    console.error('手动检查失败:', error.message);
    res.status(500).json({
      success: false,
      error: error.message,
      message: '手动检查失败'
    });
  }
});

/**
 * 清除指定配置的推送记录
 * POST /auto-push/configs/:id/clear-records
 */
router.post('/configs/:id/clear-records', async (req, res) => {
  try {
    const { id } = req.params;
    await clearConfigRecords(id);
    
    res.json({
      success: true,
      message: '推送记录已清除'
    });
    
  } catch (error) {
    console.error('清除记录失败:', error.message);
    res.status(500).json({
      success: false,
      error: error.message,
      message: '清除记录失败'
    });
  }
});

/**
 * 停止所有推送
 * POST /auto-push/stop-all
 */
router.post('/stop-all', async (req, res) => {
  try {
    stopAllPush();
    
    res.json({
      success: true,
      message: '所有推送已停止'
    });
    
  } catch (error) {
    console.error('停止所有推送失败:', error.message);
    res.status(500).json({
      success: false,
      error: error.message,
      message: '停止所有推送失败'
    });
  }
});

/**
 * 获取系统状态
 * GET /auto-push/system-status
 */
router.get('/system-status', async (req, res) => {
  try {
    const status = getSystemStatus();
    
    res.json({
      success: true,
      message: '获取系统状态成功',
      data: status
    });
    
  } catch (error) {
    console.error('获取系统状态失败:', error.message);
    res.status(500).json({
      success: false,
      error: error.message,
      message: '获取系统状态失败'
    });
  }
});

// ==================== 兼容旧接口 ====================

/**
 * 获取推送状态（兼容旧接口）
 * GET /auto-push/status
 */
router.get('/status', async (req, res) => {
  try {
    const status = getPushStatus();
    
    res.json({
      success: true,
      message: '获取推送状态成功',
      data: status
    });
    
  } catch (error) {
    console.error('获取推送状态失败:', error.message);
    res.status(500).json({
      success: false,
      error: error.message,
      message: '获取推送状态失败'
    });
  }
});

/**
 * 配置自动推送（兼容旧接口）
 * POST /auto-push/config
 */
router.post('/config', async (req, res) => {
  try {
    const { channelId, checkInterval, format, titlePrefix, sourceUrl, sourceName } = req.body;
    
    if (!channelId) {
      return res.status(400).json({
        success: false,
        error: '缺少频道ID',
        message: '请提供要推送的频道ID'
      });
    }
    
    // 验证URL格式
    if (sourceUrl) {
      try {
        new URL(sourceUrl);
      } catch (e) {
        return res.status(400).json({
          success: false,
          error: 'URL格式无效',
          message: '请提供有效的源URL'
        });
      }
    }
    
    const config = {
      channelId,
      checkInterval: checkInterval || 10 * 60 * 1000,
      format: format || 3,
      titlePrefix: titlePrefix || '[洛奇资讯]',
      sourceUrl: sourceUrl || 'https://luoqi.tiancity.com/homepage/article/Class_232_Time_1.html',
      sourceName: sourceName || '洛奇官网'
    };
    
    await setPushConfig(config);
    
    res.json({
      success: true,
      message: '推送配置更新成功',
      data: getPushConfig()
    });
    
  } catch (error) {
    console.error('配置推送失败:', error.message);
    res.status(500).json({
      success: false,
      error: error.message,
      message: '推送配置失败'
    });
  }
});

/**
 * 获取推送配置（兼容旧接口）
 * GET /auto-push/config
 */
router.get('/config', async (req, res) => {
  try {
    const config = getPushConfig();
    
    res.json({
      success: true,
      message: '配置获取成功',
      data: config
    });
    
  } catch (error) {
    console.error('获取配置失败:', error.message);
    res.status(500).json({
      success: false,
      error: error.message,
      message: '获取推送配置失败'
    });
  }
});

/**
 * 启动自动推送（兼容旧接口）
 * POST /auto-push/start
 */
router.post('/start', async (req, res) => {
  try {
    const result = startAutoPush();
    
    if (result === false) {
      return res.status(400).json({
        success: false,
        error: '没有可启动的配置',
        message: '请先创建推送配置'
      });
    }
    
    res.json({
      success: true,
      message: '自动推送已启动'
    });
    
  } catch (error) {
    console.error('启动推送失败:', error.message);
    res.status(500).json({
      success: false,
      error: error.message,
      message: '启动推送失败'
    });
  }
});

/**
 * 停止自动推送（兼容旧接口）
 * POST /auto-push/stop
 */
router.post('/stop', async (req, res) => {
  try {
    stopAutoPush();
    
    res.json({
      success: true,
      message: '自动推送已停止'
    });
    
  } catch (error) {
    console.error('停止推送失败:', error.message);
    res.status(500).json({
      success: false,
      error: error.message,
      message: '停止推送失败'
    });
  }
});

/**
 * 手动推送检查（兼容旧接口）
 * POST /auto-push/manual-check
 */
router.post('/manual-check', async (req, res) => {
  try {
    const result = await manualPushCheck();
    
    res.json({
      success: result.success,
      message: result.success ? '手动推送检查完成' : '手动推送检查失败',
      data: result
    });
    
  } catch (error) {
    console.error('手动推送检查失败:', error.message);
    res.status(500).json({
      success: false,
      error: error.message,
      message: '手动推送检查失败'
    });
  }
});

/**
 * 测试抓取最新帖子（兼容旧接口）
 * GET /auto-push/test-crawl?url=xxx&limit=5
 */
router.get('/test-crawl', async (req, res) => {
  try {
    const { limit = 5, url } = req.query;
    const config = getPushConfig();
    
    // 使用查询参数中的URL，或配置中的URL，或默认URL
    const testUrl = url || config.sourceUrl;
    
    console.log(`测试抓取网站帖子: ${testUrl}`);
    
    // 获取今日帖子和最新帖子
    const [todayPosts, latestPosts] = await Promise.all([
      getTodayLatestPosts(testUrl),
      getLatestPosts(testUrl, parseInt(limit))
    ]);
    
    res.json({
      success: true,
      message: '抓取测试完成',
      data: {
        sourceUrl: testUrl,
        todayPosts: todayPosts,
        latestPosts: latestPosts,
        summary: {
          todayCount: todayPosts.length,
          latestCount: latestPosts.length
        }
      }
    });
    
  } catch (error) {
    console.error('测试抓取失败:', error.message);
    res.status(500).json({
      success: false,
      error: error.message,
      message: '抓取测试失败'
    });
  }
});

/**
 * 测试详情抓取（兼容旧接口）
 * GET /auto-push/test-detail?url=xxx
 */
router.get('/test-detail', async (req, res) => {
  try {
    const { url } = req.query;
    
    if (!url) {
      return res.status(400).json({
        success: false,
        error: '缺少URL参数',
        message: '请提供要测试的详情页URL'
      });
    }
    
    console.log(`测试详情抓取: ${url}`);
    
    const detail = await fetchPostDetail(url);
    
    res.json({
      success: true,
      message: '详情抓取测试完成',
      data: {
        url: url,
        title: detail.title,
        textPreview: detail.textContent ? detail.textContent.substring(0, 200) + '...' : '',
        htmlLength: detail.htmlContent ? detail.htmlContent.length : 0,
        hasContent: !!detail.htmlContent
      }
    });
    
  } catch (error) {
    console.error('测试详情抓取失败:', error.message);
    res.status(500).json({
      success: false,
      error: error.message,
      message: '详情抓取测试失败'
    });
  }
});

/**
 * 清除推送记录（兼容旧接口）
 * POST /auto-push/clear-records
 */
router.post('/clear-records', async (req, res) => {
  try {
    await clearPushedRecords();
    
    res.json({
      success: true,
      message: '推送记录已清除'
    });
    
  } catch (error) {
    console.error('清除推送记录失败:', error.message);
    res.status(500).json({
      success: false,
      error: error.message,
      message: '清除推送记录失败'
    });
  }
});

module.exports = router;
