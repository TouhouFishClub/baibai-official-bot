const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');
const { normalizeModuleResult } = require('../utils/cqResultAdapter');
const { getAnswer, setAnswer } = require('./qaStore');

const COMMAND_PREFIXES = ['mblogs', 'mbtvs', 'mbcds', 'mbzzs', 'mbi', 'mbd', 'opt', 'meu', 'mbtv', 'mbcd', 'mbzz'];
const DATABASE_TODO_MESSAGE = '该功能依赖尚未迁移的数据库，暂不可用。';
const MODULE_TIMEOUT_MS = Number(process.env.LOCAL_COMMAND_TIMEOUT_MS || 120000);

function ok(data) {
  return { status: 'ok', data };
}

function text(message) {
  return ok({ type: 'text', message });
}

function parseCommand(input) {
  const original = String(input || '').trim();
  const normalized = original.startsWith('/') ? original.slice(1).trim() : original;
  const lowered = normalized.toLowerCase();
  const prefix = COMMAND_PREFIXES.find((candidate) => lowered.startsWith(candidate));

  if (!prefix) {
    return { command: null, content: original };
  }
  return {
    command: prefix,
    content: normalized.slice(prefix.length).trim()
  };
}

function runCallbackModule(invoke) {
  return new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        resolve('本地功能处理超时，请稍后再试');
      }
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
        logger.error('本地功能执行失败', error.message);
        callback('本地功能处理失败，请稍后再试');
      });
  });
}

function getConfiguredQaWriters(groupId) {
  const writers = new Set(
    String(process.env.QA_WRITE_USER_IDS || '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean)
  );

  try {
    const channelConfig = JSON.parse(
      fs.readFileSync(path.join(__dirname, '..', 'config', 'channel.json'), 'utf8')
    );
    if (channelConfig.admin_user) writers.add(String(channelConfig.admin_user));
  } catch (_) {
    // 配置文件可选。
  }

  try {
    const groupsConfig = JSON.parse(
      fs.readFileSync(path.join(__dirname, '..', 'config', 'groups.json'), 'utf8')
    );
    const groupConfig = groupsConfig[String(groupId)];
    for (const userId of groupConfig?.admin_users || []) {
      writers.add(String(userId));
    }
  } catch (_) {
    // 配置文件可选。
  }

  return writers;
}

function canWriteQa(context) {
  return Boolean(context.canManageQa) ||
    getConfiguredQaWriters(context.sourceGroupId || context.groupId).has(String(context.userId || ''));
}

function deterministicFortune(userId) {
  const date = new Date();
  const day = `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
  const seed = `${userId || 'anonymous'}:${day}`;
  let hash = 2166136261;
  for (const character of seed) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  const score = Math.abs(hash) % 101;
  const rating = score >= 80 ? '大吉' : score >= 60 ? '吉' : score >= 40 ? '平' : score >= 20 ? '小凶' : '大凶';
  return `今日运势：${rating}（${score}/100）`;
}

function todayExpertDungeon() {
  const index = ~~(((Date.now() + 28800000 - 25200000) / 86400000) % 9);
  const dungeons = ['皮卡', '伊比', '赛尔', '拉比', '玛斯', '菲奥娜', '巴里', '克里尔', '伦达'];
  return `今天的专家地下城是${dungeons[index]}地下城`;
}

function whatToEat(prefix) {
  const foods = [
    '馄饨', '拉面', '热干面', '刀削面', '米线', '酸辣粉', '麻辣烫',
    '炒饭', '盖浇饭', '黄焖鸡米饭', '火锅', '酸菜鱼', '烤串', '寿司',
    '煲仔饭', '小笼包', '手抓饼', '胡辣汤', '羊肉泡馍'
  ];
  return `${prefix}${foods[Math.floor(Math.random() * foods.length)]}`;
}

async function executeMessage(content, context = {}) {
  const normalized = String(content || '').trim();
  const lower = normalized.toLowerCase();

  if (['bosswork', 'boss'].includes(lower) || normalized.startsWith('boss工作表')) {
    const { BossWork } = require('../features/mabinogi/BossWork/BossWork');
    return ok(normalizeModuleResult(
      await runCallbackModule((callback) =>
        BossWork(context.userId || '0', context.groupId || 'global', callback)
      )
    ));
  }
  if (lower === 'ruawork' || (normalized.includes('茹娅') && normalized.includes('上班'))) {
    const rua = require('../features/mabinogi/ruawork');
    return ok(normalizeModuleResult(await runCallbackModule((callback) => rua(callback))));
  }
  if (lower === 'jrrp' || normalized === '今日运势') {
    return text(deterministicFortune(context.userId));
  }
  if (normalized === '今日专家' || normalized === '今日专家地下城') {
    return text(todayExpertDungeon());
  }
  if (normalized === '洛奇火山天气') {
    const { mabiWeather } = require('../features/mabinogi/weather');
    return ok(normalizeModuleResult(
      await runCallbackModule((callback) => mabiWeather(normalized, callback))
    ));
  }
  if (normalized.toUpperCase().startsWith('TC公告')) {
    const { tcArticle } = require('../features/mabinogi/newArticle');
    return ok(normalizeModuleResult(
      await runCallbackModule((callback) => tcArticle(normalized.slice(4), callback))
    ));
  }
  if (normalized.endsWith('吃什么')) {
    return text(whatToEat(normalized.slice(0, -3)));
  }
  if (/^(走私查询|超级走私查询)/.test(normalized)) {
    try {
      const { querySmuggler } = require('../features/mabinogi/remoteDataFeatures');
      return ok(normalizeModuleResult(await querySmuggler({
        superQuery: normalized.startsWith('超级走私查询')
      })));
    } catch (error) {
      if (error?.name === 'BridgeUnavailableError') {
        return text('走私数据库桥接服务暂不可用');
      }
      logger.error('走私查询桥接失败', error);
      return text('走私数据库桥接服务暂不可用');
    }
  }

  // TODO(database-migration): calendar/menu/gacha 仍依赖原 Mongo 数据。
  if (
    /^(日历设置|日历修改|选择日历|日历删除|选择删除)/.test(normalized) ||
    normalized.endsWith('日历') ||
    /^(菜单|menu)/i.test(normalized) ||
    /^(洛奇来一发|洛奇来十连|洛奇来一单|洛奇来十单|洛奇蛋池)/.test(normalized)
  ) {
    return text(DATABASE_TODO_MESSAGE);
  }

  if (normalized.includes('|')) {
    if (!canWriteQa(context)) {
      return text('此功能仅限管理员使用');
    }
    const [key, ...answerParts] = normalized.split('|');
    const result = await setAnswer({
      groupId: context.groupId || 'global',
      groupName: context.groupName,
      key,
      answer: answerParts.join('|').trim(),
      authorId: context.userId,
      authorName: context.userName
    });
    return text(result);
  }

  const answer = await getAnswer({
    groupId: context.groupId || 'global',
    groupName: context.groupName,
    key: normalized
  });
  if (answer) {
    return ok(normalizeModuleResult(answer));
  }

  const { cal } = require('../features/calculator');
  const calculation = cal(normalized);
  if (calculation !== undefined && calculation !== null) {
    return text(`${normalized}=${calculation}`);
  }
  return ok(null);
}

async function executeCommand(command, content, context = {}) {
  const normalizedCommand = String(command || '').toLowerCase();
  const normalizedContent = String(content || '').trim();
  if (!COMMAND_PREFIXES.includes(normalizedCommand)) {
    return { status: 'error', message: '不支持的命令' };
  }
  logger.command(normalizedCommand, normalizedContent);

  if (!normalizedContent && !['mbtv', 'mbcd', 'mbzz', 'mbtvs', 'mbcds', 'mbzzs', 'mblogs'].includes(normalizedCommand)) {
    return text('请提供查询内容');
  }

  try {
    if (normalizedCommand === 'mbi' || normalizedCommand === 'mbd') {
      const { searchMabiRecipe } = require('../features/mabinogi/recipeRebuild/searchRecipe');
      const result = await runCallbackModule((callback) =>
        searchMabiRecipe(normalizedContent, callback, normalizedCommand === 'mbd')
      );
      return ok(normalizeModuleResult(result));
    }

    if (normalizedCommand === 'opt') {
      const { op } = require('../features/mabinogi/optionset');
      const result = await runCallbackModule((callback) =>
        op(context.userId || '0', context.userName || '本地用户', normalizedContent, 'html', callback)
      );
      return ok(normalizeModuleResult(result));
    }

    if (normalizedCommand === 'meu') {
      const { searchEquipUpgrade } = require('../features/mabinogi/ItemUpgrade');
      const result = await runCallbackModule((callback) =>
        searchEquipUpgrade(
          context.userId || '0',
          context.groupId || '0',
          normalizedContent,
          callback
        )
      );
      return ok(normalizeModuleResult(result));
    }

    if (normalizedCommand === 'mbtv' || normalizedCommand === 'mbcd' || normalizedCommand === 'mbzz') {
      const { queryTelevision } = require('../features/mabinogi/remoteDataFeatures');
      return ok(normalizeModuleResult(
        await queryTelevision(normalizedCommand, normalizedContent, context)
      ));
    }

    if (normalizedCommand === 'mbtvs' || normalizedCommand === 'mbcds' || normalizedCommand === 'mbzzs') {
      const { queryTelevisionStats } = require('../features/mabinogi/remoteDataFeatures');
      return ok(normalizeModuleResult(
        await queryTelevisionStats(normalizedCommand, normalizedContent)
      ));
    }

    if (normalizedCommand === 'mblogs') {
      const { queryMblogs } = require('../features/mabinogi/remoteDataFeatures');
      return ok(normalizeModuleResult(await queryMblogs(normalizedContent)));
    }

    return { status: 'error', message: '不支持的命令' };
  } catch (error) {
    if (error?.name === 'BridgeUnavailableError') {
      return text('数据库桥接服务暂不可用，请稍后再试');
    }
    logger.error(`本地命令失败 (${normalizedCommand})`, error);
    return text('本地功能处理失败，请稍后再试');
  }
}

async function executeInput(input, context = {}) {
  const parsed = parseCommand(input);
  return parsed.command
    ? executeCommand(parsed.command, parsed.content, context)
    : executeMessage(parsed.content, context);
}

module.exports = {
  COMMAND_PREFIXES,
  DATABASE_TODO_MESSAGE,
  executeCommand,
  executeInput,
  executeMessage,
  parseCommand,
  canWriteQa
};
