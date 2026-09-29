/**
 * 爬虫服务
 * 负责从洛奇官网抓取最新帖子信息
 */

const axios = require('axios');
const cheerio = require('cheerio');

function decodeHtml(value) {
  return String(value || '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&#160;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * 去掉协议和域名，只留路径。
 * https://luoqi.tiancity.com/homepage/event/2026/0909romantic/
 * → /homepage/event/2026/0909romantic/
 * @param {string} raw
 * @returns {string}
 */
function toPathOnly(raw) {
  const value = decodeHtml(raw).trim();
  if (!value || value === '#' || /^javascript:/i.test(value)) return '';

  let candidate = value;
  if (candidate.startsWith('//')) candidate = `https:${candidate}`;
  if (!/^https?:\/\//i.test(candidate)) return value;

  let parsed;
  try {
    parsed = new URL(candidate);
  } catch (error) {
    return value;
  }

  const path = parsed.pathname || '/';
  const query = formatSearchWithoutDomains(parsed);
  return `${path}${query}${parsed.hash}`;
}

function formatSearchWithoutDomains(parsed) {
  if (!parsed.search) return '';

  const parts = [];
  for (const [key, val] of parsed.searchParams) {
    const looksLikeUrl = /^https?:\/\//i.test(val) || val.startsWith('//');
    parts.push(`${key}=${looksLikeUrl ? toPathOnly(val) : val}`);
  }
  return parts.length ? `?${parts.join('&')}` : '';
}

/**
 * <a href="https://host/path">asdf</a> → asdf[/path]
 * 可见文字本身就是网址时，只保留路径。
 * @param {string} label
 * @param {string} url
 * @returns {string}
 */
function formatPlainLink(label, url) {
  const path = toPathOnly(url);
  const text = String(label || '').replace(/\s+/g, ' ').trim();
  if (!path) return text;

  const textIsUrl = /^https?:\/\//i.test(text) || text.startsWith('//');
  if (!text || text === path || (textIsUrl && toPathOnly(text) === path)) return path;
  return `${text}[${path}]`;
}

/**
 * 把 HTML 里的超链接改成普通文字，网址只保留路径，避免被识别成水贴。
 * @param {string} html
 * @returns {string}
 */
function rewriteHtmlLinks(html) {
  if (!html || !/<a\b/i.test(html)) return html || '';

  return html.replace(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi, (match, attrs, inner) => {
    const hrefMatch = attrs.match(/\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>]+))/i);
    const href = ((hrefMatch && (hrefMatch[1] || hrefMatch[2] || hrefMatch[3])) || '').trim();

    if (!href || href === '#' || /^javascript:/i.test(href)) {
      return inner;
    }

    const path = toPathOnly(href);
    if (/<img\b/i.test(inner)) {
      return path ? `<span>${inner}[${escapeHtml(path)}]</span>` : `<span>${inner}</span>`;
    }

    const text = decodeHtml(inner.replace(/<[^>]+>/g, ''));
    return `<span>${escapeHtml(formatPlainLink(text, href))}</span>`;
  });
}

/**
 * 抓取洛奇官网的帖子列表
 * @param {string} url - 洛奇官网列表页URL
 * @returns {Promise<Array>} 帖子列表
 */
async function fetchLuoqiPosts(url = 'https://luoqi.tiancity.com/homepage/article/Class_232_Time_1.html') {
  try {
    console.log(`开始抓取洛奇官网帖子: ${url}`);
    
    // 设置请求头，模拟浏览器访问
    const response = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        'Accept-Encoding': 'gzip, deflate, br',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1'
      },
      timeout: 30000,
      responseType: 'arraybuffer' // 获取原始字节数据
    });
    
    // 检测并处理编码
    let htmlContent;
    const buffer = Buffer.from(response.data);
    
    // 尝试从Content-Type头获取编码
    const contentType = response.headers['content-type'];
    let encoding = 'utf8'; // 默认编码
    
    if (contentType) {
      const charsetMatch = contentType.match(/charset=([^;]+)/i);
      if (charsetMatch) {
        encoding = charsetMatch[1].toLowerCase();
        console.log(`检测到页面编码: ${encoding}`);
      }
    }
    
    // 尝试从HTML meta标签获取编码
    const htmlStart = buffer.toString('utf8', 0, Math.min(1000, buffer.length));
    const metaCharsetMatch = htmlStart.match(/<meta[^>]+charset[^>]*content[^>]*=["']?([^"'>;]+)/i) ||
                            htmlStart.match(/<meta[^>]+content[^>]*charset[^>]*=["']?([^"'>;]+)/i) ||
                            htmlStart.match(/<meta[^>]+charset[^>]*=["']?([^"'>;]+)/i);
    
    if (metaCharsetMatch) {
      const metaEncoding = metaCharsetMatch[1].toLowerCase();
      console.log(`HTML meta标签编码: ${metaEncoding}`);
      if (metaEncoding.includes('gb') || metaEncoding.includes('gbk') || metaEncoding.includes('gb2312')) {
        encoding = 'gbk';
      } else if (metaEncoding.includes('utf-8') || metaEncoding.includes('utf8')) {
        encoding = 'utf8';
      }
    }
    
    // 根据检测到的编码转换文本
    if (encoding === 'gbk' || encoding === 'gb2312') {
      // 需要安装iconv-lite来处理GBK编码
      try {
        const iconv = require('iconv-lite');
        htmlContent = iconv.decode(buffer, 'gbk');
        console.log('使用GBK编码解析页面');
      } catch (err) {
        console.warn('iconv-lite未安装，使用UTF-8解析');
        htmlContent = buffer.toString('utf8');
      }
    } else {
      htmlContent = buffer.toString('utf8');
      console.log('使用UTF-8编码解析页面');
    }
    
    const $ = cheerio.load(htmlContent);
    const posts = [];
    
    // 解析洛奇官网的帖子列表结构
    // 格式: <ul class="newsList"><li><p><strong>【游戏】</strong><span>[2025-08-20]</span><a href="...">标题</a></p></li>...
    $('.newsList li').each((index, element) => {
      const $li = $(element);
      const $p = $li.find('p');
      const $category = $p.find('strong');
      const $span = $p.find('span');
      const $link = $p.find('a');
      
      if ($link.length > 0 && $span.length > 0) {
        const title = $link.text().trim();
        const href = $link.attr('href');
        const dateText = $span.text().trim();
        const category = $category.text().trim();
        
        // 提取日期 [YYYY-MM-DD] 格式
        const dateMatch = dateText.match(/\[(\d{4}-\d{2}-\d{2})\]/);
        
        if (title && href && dateMatch) {
          const date = dateMatch[1];
          
          // 处理相对URL
          let fullUrl = href;
          if (href.startsWith('//')) {
            fullUrl = `https:${href}`;
          } else if (href.startsWith('/')) {
            fullUrl = `https://luoqi.tiancity.com${href}`;
          } else if (!href.startsWith('http')) {
            // 相对路径
            const baseUrl = new URL(url);
            fullUrl = new URL(href, baseUrl.origin).toString();
          }
          
          // 只处理洛奇官网的链接（排除17173等外链）
          if (fullUrl.includes('luoqi.tiancity.com')) {
            posts.push({
              id: generatePostId(date, title, fullUrl),
              title: title,
              date: date,
              url: fullUrl,
              category: category,
              isSticky: title.includes('置顶') || title.includes('公告')
            });
          }
        }
      }
    });
    
    // 按日期排序，最新的在前
    posts.sort((a, b) => new Date(b.date) - new Date(a.date));
    
    console.log(`成功抓取到 ${posts.length} 篇帖子`);
    console.log(`最新帖子: ${posts.slice(0, 3).map(p => `${p.title} (${p.date})`).join(', ')}`);
    
    return posts;
    
  } catch (error) {
    console.error(`抓取洛奇官网失败 (${url}):`, error.message);
    throw error;
  }
}

/**
 * 获取帖子详情内容
 * @param {string} detailUrl - 详情页URL
 * @returns {Promise<Object>} 详情内容
 */
async function fetchPostDetail(detailUrl) {
  try {
    console.log(`获取帖子详情: ${detailUrl}`);
    
    const response = await axios.get(detailUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        'Accept-Encoding': 'gzip, deflate, br',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1'
      },
      timeout: 30000,
      responseType: 'arraybuffer' // 获取原始字节数据
    });
    
    // 检测并处理编码（与列表页相同的逻辑）
    let detailHtmlContent;
    const buffer = Buffer.from(response.data);
    
    const contentType = response.headers['content-type'];
    let encoding = 'utf8';
    
    if (contentType) {
      const charsetMatch = contentType.match(/charset=([^;]+)/i);
      if (charsetMatch) {
        encoding = charsetMatch[1].toLowerCase();
      }
    }
    
    const htmlStart = buffer.toString('utf8', 0, Math.min(1000, buffer.length));
    const metaCharsetMatch = htmlStart.match(/<meta[^>]+charset[^>]*content[^>]*=["']?([^"'>;]+)/i) ||
                            htmlStart.match(/<meta[^>]+content[^>]*charset[^>]*=["']?([^"'>;]+)/i) ||
                            htmlStart.match(/<meta[^>]+charset[^>]*=["']?([^"'>;]+)/i);
    
    if (metaCharsetMatch) {
      const metaEncoding = metaCharsetMatch[1].toLowerCase();
      if (metaEncoding.includes('gb') || metaEncoding.includes('gbk') || metaEncoding.includes('gb2312')) {
        encoding = 'gbk';
      }
    }
    
    if (encoding === 'gbk' || encoding === 'gb2312') {
      try {
        const iconv = require('iconv-lite');
        detailHtmlContent = iconv.decode(buffer, 'gbk');
      } catch (err) {
        detailHtmlContent = buffer.toString('utf8');
      }
    } else {
      detailHtmlContent = buffer.toString('utf8');
    }
    
    const $ = cheerio.load(detailHtmlContent);
    
    // 获取标题：.newCon > .aur > h2
    const title = $('.newCon .aur h2').text().trim();
    
    // 获取内容：#newscontent
    const $content = $('#newscontent');
    
    // 移除分享按钮和其他无关元素
    $content.find('.clearfix').remove(); // 移除分享相关的div
    $content.find('a[id*="sina"], a[id*="qq"], a[id*="baidu"]').remove(); // 移除分享链接

    // 超链接改成普通文字，网址只保留路径
    const contentHtml = rewriteHtmlLinks($content.html());
    $content.html(contentHtml);
    
    // 获取纯文本内容（用于预览）
    const textContent = $content.text().trim();
    
    console.log(`成功获取详情，标题: ${title}`);
    
    return {
      title: title,
      htmlContent: contentHtml,
      textContent: textContent,
      url: detailUrl
    };
    
  } catch (error) {
    console.error(`获取详情失败 (${detailUrl}):`, error.message);
    throw error;
  }
}

/**
 * 生成帖子唯一ID
 * @param {string} date - 发布日期
 * @param {string} title - 标题
 * @param {string} url - 帖子URL
 * @returns {string} 唯一ID
 */
function generatePostId(date, title, url) {
  // 使用日期、标题和URL的哈希值作为唯一ID，确保更稳定
  const crypto = require('crypto');
  const content = `${date}-${title}-${url}`;
  return crypto.createHash('md5').update(content).digest('hex').substring(0, 16);
}

/**
 * 获取今日最新帖子
 * @param {string} url - 网站URL
 * @returns {Promise<Array>} 今日帖子列表
 */
async function getTodayLatestPosts(url) {
  try {
    const posts = await fetchLuoqiPosts(url);
    const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD格式
    
    // 筛选今日帖子
    const todayPosts = posts.filter(post => post.date === today);
    
    console.log(`今日共有 ${todayPosts.length} 篇新帖子`);
    return todayPosts;
    
  } catch (error) {
    console.error('获取今日帖子失败:', error.message);
    throw error;
  }
}

/**
 * 获取最新的N篇帖子（不考虑置顶）
 * @param {string} url - 网站URL
 * @param {number} limit - 限制数量，默认5篇
 * @returns {Promise<Array>} 最新帖子列表
 */
async function getLatestPosts(url, limit = 5) {
  try {
    const posts = await fetchLuoqiPosts(url);
    
    // 过滤掉置顶帖子
    const filteredPosts = posts.filter(post => !post.isSticky);
    
    // 返回最新的几篇
    const latestPosts = filteredPosts.slice(0, limit);
    
    console.log(`获取到最新 ${latestPosts.length} 篇帖子（已过滤置顶）`);
    return latestPosts;
    
  } catch (error) {
    console.error('获取最新帖子失败:', error.message);
    throw error;
  }
}

/**
 * 格式化帖子内容为Markdown格式
 * @param {Object} post - 帖子对象
 * @param {string} sourceName - 源站名称
 * @param {Object} detail - 详情内容（可选）
 * @returns {string} Markdown格式的内容
 */
function formatPostToMarkdown(post, sourceName = '洛奇官网', detail = null) {
  let content = '';

  if (detail && detail.textContent) {
    // 使用详情内容
    content += `${detail.textContent.substring(0, 500)}...

`;
  } else {
    // 使用基本信息
    content += `> 这是从${sourceName}自动抓取的最新帖子信息。

`;
  }

  content += `---

**发布日期**: ${post.date}

**来源**: ${formatPlainLink(sourceName, post.url)}

**帖子ID**: \`${post.id}\``;
  
  return content;
}

/**
 * 格式化帖子内容为HTML格式
 * @param {Object} post - 帖子对象
 * @param {string} sourceName - 源站名称
 * @param {Object} detail - 详情内容（可选）
 * @returns {string} HTML格式的内容
 */
function formatPostToHTML(post, sourceName = '洛奇官网', detail = null) {
  let content = '';

  if (detail && detail.htmlContent) {
    // 使用详情HTML内容
    content += `<div class="post-content">
${rewriteHtmlLinks(detail.htmlContent)}
</div>

`;
  } else if (detail && detail.textContent) {
    // 使用详情文本内容
    content += `<div class="post-content">
<p>${detail.textContent.substring(0, 500)}...</p>
</div>

`;
  } else {
    // 使用基本信息
    content += `<div class="post-content">
<blockquote>
<p>这是从${sourceName}自动抓取的最新帖子信息。</p>
</blockquote>
</div>

`;
  }

  content += `<hr>

<p><strong>发布日期</strong>: ${post.date}</p>

<p><strong>来源</strong>: <span>${escapeHtml(formatPlainLink(sourceName, post.url))}</span></p>

<p><strong>帖子ID</strong>: <code>${post.id}</code></p>`;
  
  return content;
}

module.exports = {
  fetchLuoqiPosts,
  fetchPostDetail,
  getTodayLatestPosts,
  getLatestPosts,
  formatPostToMarkdown,
  formatPostToHTML,
  generatePostId,
  toPathOnly,
  formatPlainLink,
  rewriteHtmlLinks
};