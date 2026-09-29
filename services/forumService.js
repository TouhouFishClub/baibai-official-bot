/**
 * 论坛服务
 * 负责处理QQ频道论坛相关功能，如发帖等
 */

const axios = require('axios');

// QQ机器人API基础URL
// 重要发现：频道API和群聊API使用不同的域名！
// 群聊API: https://api.sgroup.qq.com  (用于群聊消息)
// 频道API: https://api.sgroup.qq.com  (用于频道相关功能) 
// 但很可能频道论坛API需要使用QQ频道专用的API域名
// 尝试使用频道专用的API域名
const QQ_CHANNEL_API_ROOT = 'https://api.sgroup.qq.com';

/**
 * 获取访问令牌
 * @returns {Promise<string>} 访问令牌
 */
async function getAccessToken() {
  try {
    const appId = process.env.QQ_BOT_APP_ID;
    const appSecret = process.env.QQ_BOT_SECRET;
    
    if (!appId || !appSecret) {
      throw new Error('未配置QQ_BOT_APP_ID或QQ_BOT_SECRET环境变量');
    }
    
    // 获取访问令牌
    const tokenResponse = await axios.post(
      'https://bots.qq.com/app/getAppAccessToken',
      {
        appId: appId,
        clientSecret: appSecret
      },
      {
        headers: {
          'Content-Type': 'application/json'
        }
      }
    );
    
    if (!tokenResponse.data || !tokenResponse.data.access_token) {
      throw new Error('获取访问令牌失败: ' + JSON.stringify(tokenResponse.data));
    }
    
    console.log('成功获取访问令牌，有效期:', tokenResponse.data.expires_in, '秒');
    return tokenResponse.data.access_token;
  } catch (error) {
    console.error('获取访问令牌错误:', error.message);
    if (error.response) {
      console.error('QQ token API 状态码:', error.response.status);
    }
    throw error;
  }
}

/**
 * 发表帖子到频道论坛
 * @param {string} channelId - 频道ID
 * @param {string} title - 帖子标题
 * @param {string} content - 帖子内容
 * @param {number} format - 帖子文本格式 (1:普通文本, 2:HTML, 3:Markdown, 4:JSON)
 * @returns {Promise<object>} 发帖结果，包含task_id和create_time
 */
async function publishThread(channelId, title, content, format = 2) {
  try {
    if (!channelId) {
      throw new Error('缺少频道ID参数');
    }
    
    if (!title || !content) {
      throw new Error('帖子标题和内容不能为空');
    }
    
    // 获取访问令牌
    const accessToken = await getAccessToken();
    
    // 构建请求数据
    const requestData = {
      title,
      content,
      format
    };
    
    const apiUrl = `${QQ_CHANNEL_API_ROOT}/channels/${channelId}/threads`;
    console.log(`准备发表频道文章，标题 ${title.length} 字符，正文 ${content.length} 字符`);
    
    // 发送发帖请求
    const response = await axios.put(
      apiUrl,
      requestData,
      {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `QQBot ${accessToken}`
        }
      }
    );
    
    console.log('发帖请求已成功提交');
    return response.data;
    
  } catch (error) {
    console.error('发帖失败:', error.message);
    if (error.response) {
      console.error('状态码:', error.response.status);
    }
    throw error;
  }
}

/**
 * 发表示例帖子（使用文档中的示例内容）
 * @param {string} channelId - 频道ID
 * @returns {Promise<object>} 发帖结果
 */
async function publishExampleThread(channelId) {
  const title = "title";
  const content = `<html lang="en-US"><body><a href="https://bot.q.qq.com/wiki" title="QQ机器人文档Title">QQ机器人文档</a>
<ul><li>主动消息：发送消息时，未填msg_id字段的消息。</li><li>被动消息：发送消息时，填充了msg_id字段的消息。</li></ul></body></html>`;
  const format = 2; // HTML格式
  
  return publishThread(channelId, title, content, format);
}

/**
 * 发表Markdown格式的帖子
 * @param {string} channelId - 频道ID
 * @param {string} title - 帖子标题
 * @param {string} content - Markdown内容
 * @returns {Promise<object>} 发帖结果
 */
async function publishMarkdownThread(channelId, title, content) {
  return publishThread(channelId, title, content, 3); // Markdown格式
}

/**
 * 发表普通文本格式的帖子
 * @param {string} channelId - 频道ID
 * @param {string} title - 帖子标题
 * @param {string} content - 文本内容
 * @returns {Promise<object>} 发帖结果
 */
async function publishTextThread(channelId, title, content) {
  return publishThread(channelId, title, content, 1); // 普通文本格式
}

/**
 * 获取机器人所在的频道服务器列表
 * @returns {Promise<object>} 频道服务器列表
 */
async function getGuildsList() {
  try {
    const accessToken = await getAccessToken();
    
    console.log('尝试获取机器人所在的频道服务器列表');
    
    const response = await axios.get(
      `${QQ_CHANNEL_API_ROOT}/users/@me/guilds`,
      {
        headers: {
          'Authorization': `QQBot ${accessToken}`
        }
      }
    );
    
    console.log('频道服务器列表获取成功');
    return response.data;
    
  } catch (error) {
    console.error('获取频道服务器列表失败:', error.message);
    if (error.response) {
      console.error('状态码:', error.response.status);
    }
    throw error;
  }
}

/**
 * 获取指定频道服务器下的子频道列表
 * @param {string} guildId - 频道服务器ID
 * @returns {Promise<object>} 子频道列表
 */
async function getChannelsList(guildId) {
  try {
    const accessToken = await getAccessToken();
    
    console.log(`尝试获取频道服务器 ${guildId} 下的子频道列表`);
    
    const response = await axios.get(
      `${QQ_CHANNEL_API_ROOT}/guilds/${guildId}/channels`,
      {
        headers: {
          'Authorization': `QQBot ${accessToken}`
        }
      }
    );
    
    console.log('子频道列表获取成功');
    return response.data;
    
  } catch (error) {
    console.error('获取子频道列表失败:', error.message);
    if (error.response) {
      console.error('状态码:', error.response.status);
    }
    throw error;
  }
}

/**
 * 获取频道信息 - 用于调试
 * @param {string} channelId - 频道ID
 * @returns {Promise<object>} 频道信息
 */
async function getChannelInfo(channelId) {
  try {
    const accessToken = await getAccessToken();
    
    console.log(`尝试获取频道 ${channelId} 的信息`);
    
    const response = await axios.get(
      `${QQ_CHANNEL_API_ROOT}/channels/${channelId}`,
      {
        headers: {
          'Authorization': `QQBot ${accessToken}`
        }
      }
    );
    
    console.log('频道信息获取成功');
    return response.data;
    
  } catch (error) {
    console.error('获取频道信息失败:', error.message);
    if (error.response) {
      console.error('状态码:', error.response.status);
    }
    throw error;
  }
}

module.exports = {
  publishThread,
  publishExampleThread,
  publishMarkdownThread,
  publishTextThread,
  getChannelInfo,
  getGuildsList,
  getChannelsList,
  getAccessToken
};
