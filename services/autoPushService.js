/**
 * 自动推送服务 - 多配置版本
 * 负责定时检查并推送网站的最新帖子到指定频道
 */

const fs = require('fs').promises;
const path = require('path');
const logger = require('../utils/logger');

const { 
  getLatestPosts, 
  getTodayLatestPosts, 
  formatPostToMarkdown, 
  formatPostToHTML,
  generatePostId,
  fetchPostDetail
} = require('./crawlerService');

const { 
  publishThread,
  getChannelsList 
} = require('./forumService');

// 数据文件路径
const DATA_DIR = path.resolve(process.env.PUSH_DATA_DIR || path.join(__dirname, '../data'));
const CONFIGS_FILE = path.join(DATA_DIR, 'push_configs.json');
const RECORDS_FILE = path.join(DATA_DIR, 'pushed_records.json');

// 存储已推送的帖子ID（按配置ID分组）
let pushedPostIds = new Map(); // configId -> Set<postId>

// 多配置支持
let pushConfigs = []; // 存储多个推送配置
let activeTasks = new Map(); // 存储活跃的定时任务 <configId, intervalId>

// 默认配置模板
const defaultConfig = {
  id: null,
  name: '',
  enabled: false,
  channelId: null,
  checkInterval: 10 * 60 * 1000, // 10分钟检查一次
  sourceUrl: 'https://luoqi.tiancity.com/homepage/article/Class_232_Time_1.html',
  format: 3, // 默认使用Markdown格式
  titlePrefix: '[洛奇资讯]',
  sourceName: '洛奇官网'
};

/**
 * 确保数据目录存在
 */
async function ensureDataDir() {
  try {
    await fs.access(DATA_DIR);
  } catch {
    await fs.mkdir(DATA_DIR, { recursive: true });
    console.log('创建数据目录:', DATA_DIR);
  }
}

/**
 * 保存配置到文件
 */
async function saveConfigsToFile() {
  try {
    await ensureDataDir();
    const configsData = pushConfigs.map(config => ({
      ...config,
      // 不保存enabled状态，重启后默认为false
      enabled: false
    }));
    await fs.writeFile(CONFIGS_FILE, JSON.stringify(configsData, null, 2));
    console.log('配置已保存到文件');
  } catch (error) {
    console.error('保存配置到文件失败:', error.message);
  }
}

/**
 * 从文件加载配置
 */
async function loadConfigsFromFile() {
  try {
    await ensureDataDir();
    const data = await fs.readFile(CONFIGS_FILE, 'utf8');
    const configs = JSON.parse(data);
    pushConfigs = configs;
    console.log(`从文件加载了 ${configs.length} 个配置`);
    
    // 为每个配置初始化推送记录
    configs.forEach(config => {
      if (!pushedPostIds.has(config.id)) {
        pushedPostIds.set(config.id, new Set());
      }
    });
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.error('加载配置文件失败:', error.message);
    } else {
      console.log('配置文件不存在，使用默认配置');
    }
  }
}

/**
 * 保存推送记录到文件
 */
async function saveRecordsToFile() {
  try {
    await ensureDataDir();
    const recordsData = {};
    for (const [configId, postIds] of pushedPostIds.entries()) {
      recordsData[configId] = Array.from(postIds);
    }
    await fs.writeFile(RECORDS_FILE, JSON.stringify(recordsData, null, 2));
    console.log('推送记录已保存到文件');
  } catch (error) {
    console.error('保存推送记录到文件失败:', error.message);
  }
}

/**
 * 从文件加载推送记录
 */
async function loadRecordsFromFile() {
  try {
    await ensureDataDir();
    const data = await fs.readFile(RECORDS_FILE, 'utf8');
    const records = JSON.parse(data);
    
    for (const [configId, postIds] of Object.entries(records)) {
      pushedPostIds.set(configId, new Set(postIds));
    }
    console.log(`从文件加载了 ${Object.keys(records).length} 个配置的推送记录`);
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.error('加载推送记录文件失败:', error.message);
    } else {
      console.log('推送记录文件不存在，使用空记录');
    }
  }
}

/**
 * 初始化服务 - 加载配置和记录
 */
async function initializeService() {
  logger.service('初始化自动推送服务...');
  await loadConfigsFromFile();
  await loadRecordsFromFile();
  logger.service('自动推送服务初始化完成');
}

/**
 * 生成唯一配置ID
 */
function generateConfigId() {
  return Date.now().toString(36) + Math.random().toString(36).substr(2);
}

/**
 * 添加或更新推送配置
 * @param {Object} config - 推送配置
 * @returns {Object} 保存后的配置
 */
async function saveConfig(config) {
  if (!config.id) {
    // 新配置
    config.id = generateConfigId();
    config = { ...defaultConfig, ...config };
    pushConfigs.push(config);
    
    // 初始化该配置的推送记录
    pushedPostIds.set(config.id, new Set());
  } else {
    // 更新现有配置
    const index = pushConfigs.findIndex(c => c.id === config.id);
    if (index >= 0) {
      pushConfigs[index] = { ...pushConfigs[index], ...config };
      config = pushConfigs[index];
    } else {
      throw new Error('配置不存在');
    }
  }
  
  // 保存到文件
  await saveConfigsToFile();
  
  logger.info(`配置已保存: ${config.name}`);
  return config;
}

/**
 * 获取所有推送配置
 * @returns {Array} 所有推送配置
 */
function getAllConfigs() {
  return pushConfigs.map(config => {
    const isRunning = activeTasks.has(config.id);
    return {
      ...config,
      status: isRunning ? 'running' : 'stopped',
      running: isRunning, // 兼容前端
      pushedCount: pushedPostIds.get(config.id)?.size || 0
    };
  });
}

/**
 * 获取单个配置
 * @param {string} configId - 配置ID
 * @returns {Object} 配置对象
 */
function getConfig(configId) {
  const config = pushConfigs.find(c => c.id === configId);
  if (config) {
    const isRunning = activeTasks.has(configId);
    return {
      ...config,
      status: isRunning ? 'running' : 'stopped',
      running: isRunning, // 兼容前端
      pushedCount: pushedPostIds.get(configId)?.size || 0
    };
  }
  return null;
}

/**
 * 删除配置
 * @param {string} configId - 配置ID
 */
async function deleteConfig(configId) {
  // 先停止该配置的推送
  stopConfigPush(configId);
  
  // 清理推送记录
  pushedPostIds.delete(configId);
  
  // 删除配置
  const index = pushConfigs.findIndex(c => c.id === configId);
  if (index >= 0) {
    const deletedConfig = pushConfigs.splice(index, 1)[0];
    
    // 保存到文件
    await saveConfigsToFile();
    
    console.log(`配置已删除: ${deletedConfig.name} (${configId})`);
    return true;
  }
  return false;
}

/**
 * 检查帖子是否已推送
 * @param {string} configId - 配置ID
 * @param {string} postId - 帖子ID
 * @returns {boolean} 是否已推送
 */
function isPostPushed(configId, postId) {
  const configPushedIds = pushedPostIds.get(configId);
  return configPushedIds ? configPushedIds.has(postId) : false;
}

/**
 * 标记帖子为已推送
 * @param {string} configId - 配置ID
 * @param {string} postId - 帖子ID
 */
async function markPostAsPushed(configId, postId) {
  if (!pushedPostIds.has(configId)) {
    pushedPostIds.set(configId, new Set());
  }
  pushedPostIds.get(configId).add(postId);
  
  // 保存到文件
  await saveRecordsToFile();
}

/**
 * 清除配置的推送记录
 * @param {string} configId - 配置ID
 */
async function clearConfigRecords(configId) {
  if (pushedPostIds.has(configId)) {
    pushedPostIds.get(configId).clear();
    
    // 保存到文件
    await saveRecordsToFile();
    
    console.log(`已清除配置 ${configId} 的推送记录`);
  }
}

/**
 * 清理过期的推送记录（保留最近7天的记录）
 * @param {string} configId - 配置ID
 */
async function cleanExpiredRecords(configId) {
  try {
    const configPushedIds = pushedPostIds.get(configId);
    if (!configPushedIds) return;
    
    // 获取7天前的日期
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const sevenDaysAgoStr = sevenDaysAgo.toISOString().split('T')[0];
    
    // 清理过期记录（这里可以根据需要实现更复杂的清理逻辑）
    // 暂时保留所有记录，因为帖子ID是基于内容的哈希值
    
    console.log(`配置 ${configId} 的推送记录清理完成`);
  } catch (error) {
    console.error(`清理配置 ${configId} 的推送记录失败:`, error.message);
  }
}

/**
 * 获取推送统计信息
 * @param {string} configId - 配置ID
 * @returns {Object} 统计信息
 */
function getPushStatistics(configId) {
  const configPushedIds = pushedPostIds.get(configId);
  if (!configPushedIds) {
    return { totalPushed: 0, lastPushed: null };
  }
  
  return {
    totalPushed: configPushedIds.size,
    lastPushed: configPushedIds.size > 0 ? '最近推送时间需要从日志获取' : null
  };
}

/**
 * 推送单个帖子
 * @param {Object} config - 推送配置
 * @param {Object} post - 帖子对象
 * @returns {Promise<Object>} 推送结果
 */
async function pushSinglePost(config, post) {
  try {
    // 获取帖子详情内容
    let detail = null;
    try {
      if (post.url && post.url.includes('luoqi.tiancity.com')) {
        console.log(`获取帖子详情: ${post.title}`);
        detail = await fetchPostDetail(post.url);
      }
    } catch (error) {
      console.warn(`获取详情失败，使用基本信息: ${error.message}`);
    }
    
    // 格式化帖子内容
    const title = `${config.titlePrefix} ${post.title}`;
    let content;
    
    if (config.format === 3) {
      content = formatPostToMarkdown(post, config.sourceName, detail);
    } else {
      content = formatPostToHTML(post, config.sourceName, detail);
    }
    
    logger.push(config.name, `推送帖子: ${title}`);
    
    // 调用发帖API
    const result = await publishThread(config.channelId, title, content, config.format);
    
    // 检查推送结果：如果有 task_id 说明推送成功
    if (result && result.task_id) {
      // 标记为已推送
      await markPostAsPushed(config.id, post.id);
      console.log(`帖子推送成功: ${title} (task_id: ${result.task_id})`);
      return { success: true, post: post, title: title, taskId: result.task_id };
    } else {
      console.error(`帖子推送失败: ${result ? JSON.stringify(result) : '未知错误'}`);
      return { success: false, error: result ? JSON.stringify(result) : '未知错误' };
    }
    
  } catch (error) {
    console.error(`推送帖子时发生错误: ${error.message}`);
    return { success: false, error: error.message };
  }
}

/**
 * 执行配置的推送检查
 * @param {string} configId - 配置ID
 * @returns {Promise<Object>} 检查结果
 */
async function executeConfigCheck(configId) {
  const config = getConfig(configId);
  if (!config || !config.enabled) {
    return { success: false, error: '配置不存在或未启用' };
  }
  
  try {
    console.log(`开始检查配置: ${config.name}`);
    
    // 获取最新帖子（限制数量，避免处理过多帖子）
    const latestPosts = await getLatestPosts(config.sourceUrl, 5);
    
    let pushedCount = 0;
    let skippedCount = 0;
    let outdatedCount = 0;
    let duplicateCount = 0;
    const results = [];
    
    // 获取今天的日期
    const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD格式
    
    for (const post of latestPosts) {
      // 检查是否已推送（这是最重要的检查）
      if (isPostPushed(config.id, post.id)) {
        console.log(`帖子 "${post.title}" (ID: ${post.id}) 已推送过，跳过`);
        skippedCount++;
        results.push({ success: false, reason: 'already_pushed', post: post });
        continue;
      }
      
      // 检查文章日期，只推送今天的文章
      if (post.date !== today) {
        console.log(`帖子 "${post.title}" 发布日期为 ${post.date}，不是今天的文章，跳过`);
        outdatedCount++;
        results.push({ success: false, reason: 'outdated', post: post, date: post.date });
        continue;
      }
      
      // 额外检查：检查标题是否与已推送的帖子重复（防止标题相同但ID不同的情况）
      const configPushedIds = pushedPostIds.get(config.id);
      if (configPushedIds) {
        const hasDuplicateTitle = Array.from(configPushedIds).some(pushedId => {
          // 这里可以添加更复杂的重复检查逻辑
          return false; // 暂时禁用，主要依赖ID检查
        });
        
        if (hasDuplicateTitle) {
          console.log(`帖子 "${post.title}" 标题重复，跳过`);
          duplicateCount++;
          results.push({ success: false, reason: 'duplicate_title', post: post });
          continue;
        }
      }
      
      console.log(`准备推送新帖子: "${post.title}" (ID: ${post.id})`);
      
      const result = await pushSinglePost(config, post);
      results.push(result);
      if (result.success) {
        pushedCount++;
        console.log(`帖子推送成功: "${post.title}"`);
      }
    }
    
    console.log(`配置 ${config.name} 检查完成:`);
    console.log(`- 总帖子数: ${latestPosts.length}`);
    console.log(`- 推送成功: ${pushedCount}`);
    console.log(`- 跳过已推送: ${skippedCount}`);
    console.log(`- 跳过过期: ${outdatedCount}`);
    console.log(`- 跳过重复: ${duplicateCount}`);
    
    return {
      success: true,
      configName: config.name,
      totalPostsCount: latestPosts.length,
      pushedCount: pushedCount,
      skippedCount: skippedCount,
      outdatedCount: outdatedCount,
      duplicateCount: duplicateCount,
      results: results
    };
    
  } catch (error) {
    console.error(`配置 ${config.name} 检查失败:`, error.message);
    return { success: false, error: error.message };
  }
}

/**
 * 启动配置的自动推送
 * @param {string} configId - 配置ID
 */
function startConfigPush(configId) {
  const config = getConfig(configId);
  if (!config) {
    throw new Error('配置不存在');
  }
  
  if (!config.channelId || !config.sourceUrl) {
    throw new Error('配置不完整，缺少频道ID或源URL');
  }
  
  // 停止现有定时器（如果有）
  stopConfigPush(configId);
  
  // 必须先启用，executeConfigCheck 会校验 enabled
  const configIndex = pushConfigs.findIndex(c => c.id === configId);
  if (configIndex >= 0) {
    pushConfigs[configIndex].enabled = true;
  }
  
  console.log(`启动配置 "${config.name}" 的自动推送，检查间隔: ${config.checkInterval / 1000}秒`);
  
  // 开启后立即检查并推送一次
  executeConfigCheck(configId).catch(error => {
    console.error(`配置 "${config.name}" 初始推送检查失败:`, error.message);
  });
  
  // 设置定时器
  const intervalId = setInterval(() => {
    executeConfigCheck(configId).catch(error => {
      console.error(`配置 "${config.name}" 定时推送检查失败:`, error.message);
    });
  }, config.checkInterval);
  
  activeTasks.set(configId, intervalId);
}

/**
 * 停止配置的自动推送
 * @param {string} configId - 配置ID
 */
function stopConfigPush(configId) {
  if (activeTasks.has(configId)) {
    clearInterval(activeTasks.get(configId));
    activeTasks.delete(configId);
    console.log(`配置 ${configId} 的自动推送已停止`);
  }
  
  // 更新配置状态
  const configIndex = pushConfigs.findIndex(c => c.id === configId);
  if (configIndex >= 0) {
    pushConfigs[configIndex].enabled = false;
  }
}

/**
 * 停止所有自动推送
 */
function stopAllPush() {
  for (const configId of activeTasks.keys()) {
    stopConfigPush(configId);
  }
  console.log('所有自动推送已停止');
}

/**
 * 获取系统状态
 */
function getSystemStatus() {
  return {
    totalConfigs: pushConfigs.length,
    runningConfigs: activeTasks.size,
    configs: getAllConfigs()
  };
}

module.exports = {
  // 初始化
  initializeService,
  
  // 配置管理
  saveConfig,
  getAllConfigs,
  getConfig,
  deleteConfig,
  
  // 推送控制
  startConfigPush,
  stopConfigPush,
  stopAllPush,
  executeConfigCheck,
  
  // 记录管理
  clearConfigRecords,
  cleanExpiredRecords,
  isPostPushed,
  markPostAsPushed,
  
  // 状态查询
  getSystemStatus,
  getPushStatistics,
  
  // 兼容旧接口（临时）
  setPushConfig: (config) => saveConfig({ ...config, name: config.name || 'Default' }),
  getPushConfig: () => pushConfigs[0] || defaultConfig,
  startAutoPush: () => pushConfigs.length > 0 ? startConfigPush(pushConfigs[0].id) : false,
  stopAutoPush: stopAllPush,
  getPushStatus: getSystemStatus,
  manualPushCheck: () => pushConfigs.length > 0 ? executeConfigCheck(pushConfigs[0].id) : Promise.resolve({ success: false }),
  clearPushedRecords: async () => {
    pushedPostIds.clear();
    await saveRecordsToFile();
    console.log('所有推送记录已清除');
  }
};
