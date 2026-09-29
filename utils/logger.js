/**
 * 统一日志工具
 * 提供不同级别的日志输出，支持时间戳和简化模式
 */

// 日志级别
const LOG_LEVELS = {
  ERROR: 0,
  WARN: 1,
  INFO: 2,
  DEBUG: 3
};

// 当前日志级别（从环境变量读取，默认为INFO）
const currentLogLevel = LOG_LEVELS[process.env.LOG_LEVEL?.toUpperCase()] ?? LOG_LEVELS.INFO;

/**
 * 格式化时间戳
 */
function getTimestamp() {
  return new Date().toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  });
}

/**
 * 输出日志
 * @param {string} level - 日志级别
 * @param {string} message - 日志消息
 * @param {any} data - 可选的数据对象
 */
function log(level, message, data = null) {
  const levelValue = LOG_LEVELS[level.toUpperCase()];
  if (levelValue > currentLogLevel) {
    return; // 跳过低优先级日志
  }

  const timestamp = getTimestamp();
  const prefix = `[${timestamp}] ${level.toUpperCase()}:`;
  
  if (data) {
    console.log(prefix, message, data);
  } else {
    console.log(prefix, message);
  }
}

/**
 * 错误日志
 */
function error(message, data = null) {
  log('ERROR', message, data);
}

/**
 * 警告日志
 */
function warn(message, data = null) {
  log('WARN', message, data);
}

/**
 * 信息日志
 */
function info(message, data = null) {
  log('INFO', message, data);
}

/**
 * 调试日志
 */
function debug(message, data = null) {
  log('DEBUG', message, data);
}

/**
 * 服务启动日志
 */
function service(message, data = null) {
  const timestamp = getTimestamp();
  console.log(`[${timestamp}] 服务: ${message}`, data || '');
}

/**
 * API请求日志（简化版）
 */
function api(method, endpoint, status = null) {
  const timestamp = getTimestamp();
  if (status) {
    console.log(`[${timestamp}] API: ${method} ${endpoint} -> ${status}`);
  } else {
    console.log(`[${timestamp}] API: ${method} ${endpoint}`);
  }
}

/**
 * 推送日志（简化版）
 */
function push(configName, action, result = null) {
  const timestamp = getTimestamp();
  if (result) {
    console.log(`[${timestamp}] 推送: ${configName} - ${action} -> ${result}`);
  } else {
    console.log(`[${timestamp}] 推送: ${configName} - ${action}`);
  }
}

/**
 * 命令处理日志
 */
function command(cmd, content, result = null) {
  const timestamp = getTimestamp();
  const contentLength = String(content || '').length;
  if (result) {
    console.log(`[${timestamp}] 命令: /${cmd} (${contentLength}字符) -> ${result}`);
  } else {
    console.log(`[${timestamp}] 命令: /${cmd} (${contentLength}字符)`);
  }
}

/**
 * 消息日志（用于频道和私信）
 */
function message(type, user, content) {
  const timestamp = getTimestamp();
  console.log(`[${timestamp}] [${type}][${user}] 收到消息 (${String(content || '').length}字符)`);
}

/**
 * 回复日志（用于频道和私信）
 */
function reply(type, content) {
  const timestamp = getTimestamp();
  console.log(`[${timestamp}] [${type}][发送] 回复 (${String(content || '').length}字符)`);
}

module.exports = {
  error,
  warn,
  info,
  debug,
  service,
  api,
  push,
  command,
  message,
  reply,
  LOG_LEVELS,
  currentLogLevel
};

