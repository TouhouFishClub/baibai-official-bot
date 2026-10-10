/**
 * 洛奇小助手。
 * 未命中本地命令时，用 OpenAI 兼容的 chat/completions 让模型选择内部功能。
 * 内部功能的结果直接回复。网络搜索把材料交回模型，由模型写成回答。
 */

const axios = require('axios');
const logger = require('../utils/logger');
const { normalizeModuleResult } = require('../utils/cqResultAdapter');
const { isWebSearchEnabled, searchWeb } = require('./webSearch');
const { canonicalUrl, pageMaxUrls, readPages } = require('./webSearch/page/reader');

const MODULE_TIMEOUT_MS = Number(process.env.LOCAL_COMMAND_TIMEOUT_MS || 120000);
const MAX_TOOL_CALLS = 4;
const MAX_MODEL_ROUNDS = 4;
const MAX_SEARCH_CALLS = 2;
const MAX_PAGE_READS = 3;
const SYSTEM_PROMPT = [
  '你是洛奇小助手，负责判断用户这句话要不要查询机器人里已有的洛奇功能，或要不要搜索网页。',
  '查询当前走私、配方、释放卷、装备升级、Boss 时间、火山天气、TC 公告、茹娅上班、出货、抽蛋、制造、统计图、DPS 排行、今日专家或今日运势时，调用对应内部工具，并按用户原意填写参数。',
  '内部工具的结果会直接发给用户，不要用文字假装已经查到。',
  '需要网页上的最新或外部资料、而内部工具覆盖不了时，调用 web_search。摘要会交回给你整理，不要原样发给用户。',
  '摘要不够、互相矛盾，或需要核对原文时，调用 read_webpage 打开本次搜索结果中的链接。读完后再整理成最终回答，附上链接。',
  '搜索或原网页失败、超时或欠费时，用已经拿到的材料继续整理，并说明缺了哪一部分。不要停住。',
  '用户明确要超级走私或韩服预测时，走私工具的 superQuery 为 true，否则为 false。',
  '一次可以调用多个工具。',
  '闲聊、打招呼，或与这些查询无关的话，只回复 NO_REPLY。',
  '用户在问洛奇概念、而现有工具和搜索都解决不了时，可以简短回答；没有把握就回复 NO_REPLY。'
].join('\n');

const TOOL_DEFINITIONS = [
  {
    type: 'function',
    function: {
      name: 'query_smuggler',
      description: '查询当前走私货物观测。用户要看走私、走私查询、现在走私什么时调用。',
      parameters: {
        type: 'object',
        properties: {
          superQuery: {
            type: 'boolean',
            description: '只有用户明确要超级走私或韩服预测时为 true，普通走私查询为 false'
          }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'query_recipe',
      description: '查询洛奇配方。简略查询对应 mbi，详细查询对应 mbd。',
      parameters: {
        type: 'object',
        properties: {
          keyword: {
            type: 'string',
            description: '物品名、物品 ID，或多个用空格、逗号分开的关键词'
          },
          detailed: {
            type: 'boolean',
            description: '用户要详细配方、材料或完整做法时为 true，只要简略配方时为 false'
          }
        },
        required: ['keyword']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'query_optionset',
      description: '查询释放卷属性，对应 opt。多个条件用逗号隔开，支持接头、接尾、等级和属性，负面属性前加 -。',
      parameters: {
        type: 'object',
        properties: {
          keyword: {
            type: 'string',
            description: '释放卷名称、ID 或筛选条件，例如「4，接头，智力，-修理费」'
          }
        },
        required: ['keyword']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'query_option_source',
      description: '按出处反查释放卷，对应 optw。',
      parameters: {
        type: 'object',
        properties: {
          keyword: {
            type: 'string',
            description: '出处关键词，例如「伦达」。不要带 optw 前缀'
          }
        },
        required: ['keyword']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'query_equip_upgrade',
      description: '查询装备升级路线，对应 meu。',
      parameters: {
        type: 'object',
        properties: {
          keyword: {
            type: 'string',
            description: '装备名称或物品 ID'
          }
        },
        required: ['keyword']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'query_boss',
      description: '查询 Boss 刷新时间表，对应 boss、bosswork、boss工作表。',
      parameters: { type: 'object', properties: {} }
    }
  },
  {
    type: 'function',
    function: {
      name: 'query_rua',
      description: '查询茹娅上班时间，对应用户说茹娅上班或 ruawork。',
      parameters: { type: 'object', properties: {} }
    }
  },
  {
    type: 'function',
    function: {
      name: 'query_weather',
      description: '查询洛奇火山天气。',
      parameters: { type: 'object', properties: {} }
    }
  },
  {
    type: 'function',
    function: {
      name: 'query_tc_article',
      description: '获取最新 TC 公告截图。',
      parameters: { type: 'object', properties: {} }
    }
  },
  {
    type: 'function',
    function: {
      name: 'query_television',
      description: '查询出货、抽蛋或装备制造记录，对应 mbtv、mbcd、mbzz。',
      parameters: {
        type: 'object',
        properties: {
          kind: {
            type: 'string',
            enum: ['mbtv', 'mbcd', 'mbzz'],
            description: 'mbtv 出货，mbcd 抽蛋，mbzz 装备制造'
          },
          query: {
            type: 'string',
            description: '筛选词，可在前面加服务器：猫服、伊鲁夏、ylx、亚特、yt。例如「亚特 工程手套」。省略则沿用该用户上次的服务器'
          }
        },
        required: ['kind']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'query_television_stats',
      description: '查询出货、抽蛋或装备制造统计图，对应 mbtvs、mbcds、mbzzs。',
      parameters: {
        type: 'object',
        properties: {
          kind: {
            type: 'string',
            enum: ['mbtvs', 'mbcds', 'mbzzs'],
            description: 'mbtvs 出货统计，mbcds 抽蛋统计，mbzzs 制造统计'
          },
          query: {
            type: 'string',
            description: '关键词，或开始结束日期，例如「稀有卷」「2026-1-1 2026-4-1」。不写时间时默认近三个月'
          }
        },
        required: ['kind']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'query_mblogs',
      description: '查询公开 DPS 排行，对应 mblogs。',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: '角色、副本或 Boss 名，可加 --rank N、--job 职业、--all。留空则查询布里列赫'
          }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'query_expert_dungeon',
      description: '查询今天的专家地下城。',
      parameters: { type: 'object', properties: {} }
    }
  },
  {
    type: 'function',
    function: {
      name: 'query_daily_fortune',
      description: '查询该用户今天的运势，对应今日运势、jrrp。',
      parameters: { type: 'object', properties: {} }
    }
  }
];

const WEB_SEARCH_TOOL = {
  type: 'function',
  function: {
    name: 'web_search',
    description: '搜索互联网，返回标题、链接和摘要。内部洛奇功能能回答时不要用。摘要要再整理；不够时用 read_webpage 打开链接。',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: '搜索词。用具体关键词，不要写整句闲聊'
        },
        topic: {
          type: 'string',
          enum: ['general', 'news', 'finance'],
          description: '一般资料用 general，新闻和公告用 news。省略时使用配置里的默认主题'
        }
      },
      required: ['query']
    }
  }
};

const READ_WEBPAGE_TOOL = {
  type: 'function',
  function: {
    name: 'read_webpage',
    description: '打开本次 web_search 返回的原网页并读取正文。摘要不够或需要核对原文时调用，不要打开搜索结果以外的地址。',
    parameters: {
      type: 'object',
      properties: {
        urls: {
          type: 'array',
          items: { type: 'string' },
          description: '要打开的网页地址，必须来自本次搜索结果，最多 3 个'
        }
      },
      required: ['urls']
    }
  }
};

function getToolDefinitions() {
  return isWebSearchEnabled()
    ? TOOL_DEFINITIONS.concat(WEB_SEARCH_TOOL, READ_WEBPAGE_TOOL)
    : TOOL_DEFINITIONS;
}

let testOverrides = null;

function getLlmConfig() {
  const timeoutMs = Number(process.env.LLM_TIMEOUT_MS || 60000);
  return {
    baseURL: String(process.env.LLM_BASE_URL || '').trim().replace(/\/+$/, ''),
    apiKey: String(process.env.LLM_API_KEY || '').trim(),
    model: String(process.env.LLM_MODEL || '').trim(),
    timeoutMs: Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 60000
  };
}

function isLlmConfigured(config = getLlmConfig()) {
  if (!config.baseURL || !config.apiKey || !config.model) return false;
  try {
    const url = new URL(config.baseURL);
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch (_) {
    return false;
  }
}

function chatCompletionsUrl(baseURL) {
  const root = String(baseURL || '').trim().replace(/\/+$/, '');
  if (root.endsWith('/chat/completions')) return root;
  return `${root}/chat/completions`;
}

function asBoolean(value) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') return /^(1|true|yes|y)$/i.test(value.trim());
  return false;
}

function textArg(args, key) {
  return String(args?.[key] ?? '').trim();
}

function isSilentReply(content) {
  const text = String(content || '').trim().replace(/^[`"'“”]+|[`"'“”]+$/g, '');
  if (!text) return true;
  return /^NO_REPLY[.。!！]?$/i.test(text);
}

function messageText(content) {
  if (typeof content === 'string') return content.trim();
  if (!Array.isArray(content)) return '';
  return content.map((part) => {
    if (typeof part === 'string') return part;
    if (part?.type === 'text') return part.text || '';
    return '';
  }).join('').trim();
}

function parseToolCalls(message) {
  const calls = Array.isArray(message?.tool_calls) ? message.tool_calls : [];
  return calls.slice(0, MAX_TOOL_CALLS).map((call, index) => {
    const fn = call?.function || call || {};
    let args = fn.arguments ?? call?.arguments ?? {};
    const rawArguments = typeof fn.arguments === 'string' ? fn.arguments : null;
    if (typeof args === 'string') {
      try {
        args = args.trim() ? JSON.parse(args) : {};
      } catch (_) {
        args = {};
      }
    }
    if (!args || typeof args !== 'object' || Array.isArray(args)) args = {};
    return {
      id: String(call?.id || `call_${index}`),
      name: String(fn.name || '').trim(),
      args,
      rawArguments: rawArguments == null ? JSON.stringify(args) : rawArguments
    };
  }).filter((call) => call.name);
}

function bridgeMessage(toolName) {
  return toolName === 'query_smuggler'
    ? '走私数据库桥接服务暂不可用'
    : '数据库桥接服务暂不可用，请稍后再试';
}

function combineToolResults(results) {
  const usable = (results || []).filter((item) => item && (item.type === 'image' || item.type === 'text'));
  if (!usable.length) {
    return { type: 'text', message: '功能未返回内容' };
  }

  const images = usable.filter((item) => item.type === 'image');
  const image = images[0];
  const texts = usable
    .filter((item) => item.type === 'text')
    .map((item) => item.message)
    .filter(Boolean);
  if (images.length > 1) {
    texts.push('还有查询图没能和这条消息一起发出，请分开再查一次。');
  }
  if (!image) {
    return { type: 'text', message: texts.join('\n') || '功能未返回内容' };
  }

  const caption = [image.message, ...texts].filter(Boolean).join('\n');
  return caption ? { ...image, message: caption } : { ...image };
}

function runCallbackModule(invoke) {
  return new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve('本地功能处理超时，请稍后再试');
    }, MODULE_TIMEOUT_MS);

    const callback = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };

    Promise.resolve()
      .then(() => invoke(callback))
      .catch((error) => {
        logger.error('洛奇助手工具执行失败', error);
        callback('本地功能处理失败，请稍后再试');
      });
  });
}

function requireKeyword(args) {
  const keyword = textArg(args, 'keyword');
  return keyword || null;
}

function normalizeOptionSourceKeyword(keyword) {
  return String(keyword || '').trim().replace(/^(optw|w)\s+/i, '');
}

const TOOL_HANDLERS = {
  async query_smuggler(args) {
    const { querySmuggler } = require('../features/mabinogi/remoteDataFeatures');
    return querySmuggler({ superQuery: asBoolean(args.superQuery) });
  },
  async query_recipe(args) {
    const keyword = requireKeyword(args);
    if (!keyword) return '请提供查询内容';
    const { searchMabiRecipe } = require('../features/mabinogi/recipeRebuild/searchRecipe');
    return runCallbackModule((callback) => searchMabiRecipe(keyword, callback, asBoolean(args.detailed)));
  },
  async query_optionset(args, context) {
    const keyword = requireKeyword(args);
    if (!keyword) return '请提供查询内容';
    const { op } = require('../features/mabinogi/optionset');
    return runCallbackModule((callback) => op(
      context.userId || '0',
      context.userName || '洛奇小助手',
      keyword,
      'html',
      callback
    ));
  },
  async query_option_source(args, context) {
    const keyword = normalizeOptionSourceKeyword(requireKeyword(args));
    if (!keyword) return '请提供查询内容';
    const { op } = require('../features/mabinogi/optionset');
    return runCallbackModule((callback) => op(
      context.userId || '0',
      context.userName || '洛奇小助手',
      `w ${keyword}`,
      'html',
      callback
    ));
  },
  async query_equip_upgrade(args, context) {
    const keyword = requireKeyword(args);
    if (!keyword) return '请提供查询内容';
    const { searchEquipUpgrade } = require('../features/mabinogi/ItemUpgrade');
    return runCallbackModule((callback) => searchEquipUpgrade(
      context.userId || '0',
      context.groupId || '0',
      keyword,
      callback
    ));
  },
  query_boss(_args, context) {
    const { BossWork } = require('../features/mabinogi/BossWork/BossWork');
    return runCallbackModule((callback) => BossWork(context.userId || '0', context.groupId || 'global', callback));
  },
  query_rua() {
    const rua = require('../features/mabinogi/ruawork');
    return runCallbackModule((callback) => rua(callback));
  },
  query_weather() {
    const { mabiWeather } = require('../features/mabinogi/weather');
    return runCallbackModule((callback) => mabiWeather('洛奇火山天气', callback));
  },
  query_tc_article() {
    const { tcArticle } = require('../features/mabinogi/newArticle');
    return runCallbackModule((callback) => tcArticle('', callback));
  },
  query_television(args, context) {
    const kind = textArg(args, 'kind').toLowerCase();
    if (!['mbtv', 'mbcd', 'mbzz'].includes(kind)) return '请说明要查出货、抽蛋还是装备制造';
    const { queryTelevision } = require('../features/mabinogi/remoteDataFeatures');
    return queryTelevision(kind, textArg(args, 'query'), context);
  },
  query_television_stats(args) {
    const kind = textArg(args, 'kind').toLowerCase();
    if (!['mbtvs', 'mbcds', 'mbzzs'].includes(kind)) return '请说明要查出货统计、抽蛋统计还是制造统计';
    const { queryTelevisionStats } = require('../features/mabinogi/remoteDataFeatures');
    return queryTelevisionStats(kind, textArg(args, 'query'));
  },
  query_mblogs(args) {
    const { queryMblogs } = require('../features/mabinogi/remoteDataFeatures');
    return queryMblogs(textArg(args, 'query'));
  },
  query_expert_dungeon() {
    const { todayExpertDungeon } = require('./localCommandService');
    return todayExpertDungeon();
  },
  query_daily_fortune(_args, context) {
    const { deterministicFortune } = require('./localCommandService');
    return deterministicFortune(context.userId);
  }
};

async function executeTool(name, args, context = {}) {
  const handler = TOOL_HANDLERS[name];
  if (!handler) return normalizeModuleResult('暂不支持这个查询');
  try {
    return normalizeModuleResult(await handler(args || {}, context || {}));
  } catch (error) {
    if (error?.name === 'BridgeUnavailableError') {
      return normalizeModuleResult(bridgeMessage(name));
    }
    logger.error('洛奇助手工具执行失败', error);
    return normalizeModuleResult('本地功能处理失败，请稍后再试');
  }
}

function buildMessages(text) {
  return [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: text }
  ];
}

async function completeChat(messages, tools) {
  const config = getLlmConfig();
  const response = await axios.post(
    chatCompletionsUrl(config.baseURL),
    {
      model: config.model,
      messages,
      tools,
      tool_choice: 'auto',
      temperature: 0.2
    },
    {
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json'
      },
      timeout: config.timeoutMs
    }
  );
  return response.data;
}

async function requestModel(messages) {
  const complete = testOverrides?.complete || completeChat;
  const response = await complete(messages, getToolDefinitions());
  const message = response?.choices?.[0]?.message;
  if (!message) {
    throw new Error('模型没有返回内容');
  }
  return message;
}

function directResultNote(result) {
  if (result?.type === 'image') return '已生成查询图片，会直接发送给用户。';
  return String(result?.message || '功能未返回内容').slice(0, 500);
}

function assistantToolMessage(message, calls) {
  return {
    role: 'assistant',
    content: messageText(message?.content) || '',
    tool_calls: calls.map((call) => ({
      id: call.id,
      type: 'function',
      function: {
        name: call.name,
        arguments: call.rawArguments
      }
    }))
  };
}

function finishReply(directResults, content, searchNote) {
  const pieces = [...directResults];
  if (!isSilentReply(content)) {
    pieces.push({ type: 'text', message: content });
  } else if (!pieces.length && searchNote) {
    pieces.push({ type: 'text', message: searchNote });
  }
  if (!pieces.length) return null;
  return { status: 'ok', data: combineToolResults(pieces) };
}

function searchFallbackNote(outcome) {
  if (!outcome) return '';
  if (!outcome.ok) return '这次没能查到网页资料。';
  return String(outcome.modelContent || '').slice(0, 1200);
}

async function runSearch(call) {
  const query = textArg(call.args, 'query');
  const topic = textArg(call.args, 'topic');
  const search = testOverrides?.searchWeb || searchWeb;
  try {
    return await search(query, topic ? { topic } : {});
  } catch (error) {
    logger.warn('[web_search]通过unknown搜索了0篇文章：查询失败');
    return {
      ok: false,
      provider: 'unknown',
      query,
      count: 0,
      results: [],
      modelContent: '网络搜索失败：查询失败。请继续根据已有材料整理回答，并说明这次没能查到网页。'
    };
  }
}

function rememberSearchUrls(outcome, allowedUrls) {
  for (const item of outcome?.results || []) {
    try {
      allowedUrls.add(canonicalUrl(item.url));
    } catch (_) {
      // 搜索结果里的无效地址不能打开。
    }
  }
}

function pageUrls(args) {
  const value = args?.urls ?? args?.url;
  const list = Array.isArray(value) ? value : String(value || '').split(/\s+/);
  return [...new Set(list.map((item) => String(item || '').trim()).filter(Boolean))].slice(0, pageMaxUrls());
}

async function runReadPages(call, allowedUrls) {
  const requested = pageUrls(call.args);
  const accepted = [];
  const rejected = [];
  for (const url of requested) {
    try {
      if (allowedUrls.has(canonicalUrl(url))) accepted.push(url);
      else rejected.push(url);
    } catch (_) {
      rejected.push(url);
    }
  }
  const read = testOverrides?.readPages || readPages;
  let outcome = { ok: false, count: 0, modelContent: '' };
  if (accepted.length) {
    try {
      outcome = await read(accepted);
    } catch (error) {
      logger.warn('[web_page]读取了0篇原文：打不开');
      outcome = {
        ok: false,
        count: 0,
        modelContent: '原网页没有打开。请根据已有搜索摘要整理回答，并说明没能查看原文。'
      };
    }
  }
  const rejection = rejected.length
    ? `这些地址不在本次搜索结果中，未打开：${rejected.join(' ')}`
    : '';
  return [outcome.modelContent, rejection].filter(Boolean).join('\n')
    || '没有可打开的网页。请根据已有搜索摘要整理回答。';
}

async function runMabinogiAgent(input, context = {}) {
  if (!isLlmConfigured()) return null;
  const text = String(input || '').trim();
  if (!text) return null;

  const execute = testOverrides?.executeTool || executeTool;
  const messages = buildMessages(text);
  const directResults = [];
  const allowedUrls = new Set();
  let searchCalls = 0;
  let pageReads = 0;
  let lastSearch = null;

  try {
    for (let round = 0; round < MAX_MODEL_ROUNDS; round += 1) {
      let message;
      try {
        message = await requestModel(messages);
      } catch (error) {
        logger.error('洛奇助手请求失败', error);
        if (directResults.length || lastSearch) {
          return finishReply(directResults, '', searchFallbackNote(lastSearch));
        }
        return null;
      }

      const calls = parseToolCalls(message);
      if (!calls.length) {
        return finishReply(directResults, messageText(message.content), searchFallbackNote(lastSearch));
      }

      const toolMessages = [];
      let sawResearch = false;
      for (const call of calls) {
        logger.info('洛奇助手调用工具', { tool: call.name });
        if (call.name === 'web_search') {
          sawResearch = true;
          if (searchCalls >= MAX_SEARCH_CALLS) {
            toolMessages.push({
              role: 'tool',
              tool_call_id: call.id,
              content: '已达到搜索次数上限。请根据已有材料整理最终回答。'
            });
            continue;
          }
          searchCalls += 1;
          const outcome = await runSearch(call);
          lastSearch = outcome;
          rememberSearchUrls(outcome, allowedUrls);
          toolMessages.push({
            role: 'tool',
            tool_call_id: call.id,
            content: `${outcome.modelContent}\n如果摘要不够或需要核对原文，调用 read_webpage 打开上面的链接，然后再整理最终回答。不要把摘要原样发给用户。`
          });
          continue;
        }

        if (call.name === 'read_webpage') {
          sawResearch = true;
          if (pageReads >= MAX_PAGE_READS) {
            toolMessages.push({
              role: 'tool',
              tool_call_id: call.id,
              content: '已达到原文阅读上限。请根据已有材料整理最终回答。'
            });
            continue;
          }
          pageReads += pageUrls(call.args).length || 1;
          toolMessages.push({
            role: 'tool',
            tool_call_id: call.id,
            content: await runReadPages(call, allowedUrls)
          });
          continue;
        }

        const result = await execute(call.name, call.args, context);
        directResults.push(result);
        toolMessages.push({
          role: 'tool',
          tool_call_id: call.id,
          content: directResultNote(result)
        });
      }

      if (!sawResearch) {
        return { status: 'ok', data: combineToolResults(directResults) };
      }
      messages.push(assistantToolMessage(message, calls), ...toolMessages);
    }

    return finishReply(directResults, '', searchFallbackNote(lastSearch));
  } catch (error) {
    logger.error('洛奇助手请求失败', error);
    if (directResults.length || lastSearch) {
      return finishReply(directResults, '', searchFallbackNote(lastSearch));
    }
    return null;
  }
}

function setAgentTestOverrides(overrides) {
  testOverrides = overrides || null;
}

function clearAgentTestOverrides() {
  testOverrides = null;
}

module.exports = {
  TOOL_DEFINITIONS,
  WEB_SEARCH_TOOL,
  bridgeMessage,
  getToolDefinitions,
  chatCompletionsUrl,
  clearAgentTestOverrides,
  combineToolResults,
  executeTool,
  isLlmConfigured,
  isSilentReply,
  normalizeOptionSourceKeyword,
  parseToolCalls,
  runMabinogiAgent,
  setAgentTestOverrides,
  asBoolean
};
