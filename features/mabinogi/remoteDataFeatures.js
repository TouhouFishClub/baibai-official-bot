const path = require('path');
const { IMAGE_DATA } = require('../../baibaiConfigs');
const { getBridgeClient } = require('../../services/legacyDataBridgeClient');
const { resolveAndRememberUserServer } = require('../../services/userServerService');
const { render } = require('./Television/render');
const { parseMbtvsArgs, renderStatsImage: renderMbtvStatsImage } = require('./Television/mbtvStats');
const { parseMbcdsArgs, renderStatsImage: renderMbcdStatsImage } = require('./Television/mbcdStats');
const { parseMbzzsArgs, renderStatsImage: renderMbzzStatsImage } = require('./Television/mbzzStats');
const { renderSmugglerFromBridge } = require('./smuggler/renderSmuggler');
const { renderMblogsList } = require('./logs/renderMblogsList');
const { DUNGEONS, BOSSES } = require('../../legacy-data-bridge/shared/mblogsBossConfig');
const { CLASSES, formatClassHelpLine } = require('../../legacy-data-bridge/shared/mblogsClassConfig');

function pad2(n) {
  return n < 10 ? `0${n}` : `${n}`;
}

function formatRecordTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value || '');
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`;
}

function serverLabel(server) {
  return server === 'yate' ? '亚特' : '猫服';
}

async function renderLegacyTable({ fileName, title, description, columns, rows }) {
  const output = path.join(IMAGE_DATA, 'mabi_other', fileName);
  await render(rows, { title, description, output, columns });
  return `[CQ:image,file=${path.join('send', 'mabi_other', fileName)}]`;
}

async function queryTelevision(kind, content, context = {}) {
  const { server, filter } = await resolveAndRememberUserServer(context.userId, content);
  const data = await getBridgeClient().television(kind, {
    content: filter,
    userId: context.userId,
    server,
    limit: 20
  });
  if (!data.rows.length) return '未找到符合条件的记录';

  const layouts = {
    mbtv: {
      fileName: 'MabiTV.png',
      title: `出货记录查询：${serverLabel(data.server)}`,
      columns: [
        { label: '角色名称', key: 'character_name' },
        { label: '物品名称', key: 'reward' },
        { label: '地下城名称', key: 'dungeon_name' },
        { label: '时间', key: 'data_time', format: (time) => formatRecordTime(time) },
        { label: '频道', key: 'channel' }
      ],
      rows: data.rows.map((row) => ({
        ...row,
        data_time: row.time || new Date(row.ts)
      }))
    },
    mbcd: {
      fileName: 'MabiGC.png',
      title: `抽蛋查询：${serverLabel(data.server)}`,
      columns: [
        { label: '角色名称', key: 'character_name' },
        { label: '物品名称', key: 'item_name' },
        { label: '时间', key: 'data_time', format: (time) => formatRecordTime(time) },
        { label: '手帕名称', key: 'draw_pool' }
      ],
      rows: data.rows.map((row) => ({
        ...row,
        draw_pool: row.draw_pool || '未知手帕',
        data_time: row.time || new Date(row.ts)
      }))
    },
    mbzz: {
      fileName: 'MabiZZ.png',
      title: `装备制造查询：${serverLabel(data.server)}`,
      columns: [
        { label: '角色名称', key: 'character_name' },
        { label: '物品名称', key: 'item_name' },
        { label: '时间', key: 'data_time', format: (time) => formatRecordTime(time) },
        { label: '频道', key: 'channel' }
      ],
      rows: data.rows.map((row) => ({
        ...row,
        data_time: row.time || new Date(row.ts)
      }))
    }
  };

  const layout = layouts[kind] || layouts.mbtv;
  return renderLegacyTable({
    ...layout,
    description: `(MongoDB 总数: ${data.total})`
  });
}

function parseStatsArgs(kind, content) {
  if (kind === 'mbtvs') return parseMbtvsArgs(content);
  if (kind === 'mbcds') return parseMbcdsArgs(content);
  return parseMbzzsArgs(content);
}

function statsFilter(kind, parsed) {
  if (kind === 'mbtvs') return parsed.filter || '';
  if (kind === 'mbcds') return parsed.keyword || '';
  return parsed.itemFilter || '';
}

async function queryTelevisionStats(kind, content) {
  const parsed = parseStatsArgs(kind, content);
  if (parsed.error) return parsed.error;

  const payload = await getBridgeClient().televisionStats(kind, {
    startTs: parsed.start.getTime(),
    endTs: parsed.end.getTime(),
    filter: statsFilter(kind, parsed)
  });

  if (kind === 'mbcds') {
    if (!payload.summary && !payload.character && !payload.pool && !payload.item) {
      return '该时间范围内三维度均无数据（角色完全匹配 / 蛋池完全匹配 / 道具正则匹配）。可调整关键词或时间。';
    }
    const outputPath = path.join(IMAGE_DATA, 'mabi_other', 'MabiCDStats.png');
    await renderMbcdStatsImage(payload, outputPath);
    return `[CQ:image,file=${path.join('send', 'mabi_other', 'MabiCDStats.png')}]`;
  }

  if (!payload.totalRecords) {
    return '该时间范围内没有匹配的记录，可放宽筛选或调整时间。';
  }

  if (kind === 'mbzzs') {
    const outputPath = path.join(IMAGE_DATA, 'mabi_other', 'MabiZZStats.png');
    await renderMbzzStatsImage(payload, outputPath);
    return `[CQ:image,file=${path.join('send', 'mabi_other', 'MabiZZStats.png')}]`;
  }

  const outputPath = path.join(IMAGE_DATA, 'mabi_other', 'MabiTVStats.png');
  await renderMbtvStatsImage(payload, outputPath);
  return `[CQ:image,file=${path.join('send', 'mabi_other', 'MabiTVStats.png')}]`;
}

const DEFAULT_DUNGEON = '布里列赫';
const DEFAULT_RANK = 10;
const BOSS_DEFAULT_RANK = 30;

function isMblogsHelpRequest(content) {
  const tokens = String(content || '').trim().split(/\s+/).filter(Boolean);
  if (!tokens.length) return false;
  return tokens.some((token) => token === '--help' || token.toLowerCase() === 'help' || token === '帮助');
}

function buildMblogsHelp() {
  const bossNames = [...new Set(BOSSES.map((boss) => boss.displayName))].join('、');
  const classNames = CLASSES.map(formatClassHelpLine).join('、');
  return [
    '【mblogs DPS 查询帮助】',
    '',
    '基本用法：',
    `  mblogs                    默认查询${DEFAULT_DUNGEON}，各 Boss 前${DEFAULT_RANK}名`,
    '  mblogs 角色名             查询该角色各 Boss 最高 DPS（按 Boss 分段）',
    `  mblogs ${DEFAULT_DUNGEON}           查询副本各 Boss 排行榜`,
    `  mblogs Boss名             查询单个 Boss，默认前${BOSS_DEFAULT_RANK}名`,
    '',
    '参数：',
    '  --rank N    显示前 N 名（副本默认 10，Boss 默认 30，角色默认 3；普通用户最多 30）',
    '  --job 职业名  只显示指定职业（模糊匹配）',
    '  --all       显示全部记录，不做「每角色仅保留最高 DPS」去重',
    '  --help      显示本帮助',
    '',
    '示例：',
    '  mblogs 布里列赫 --rank 20',
    '  mblogs 枯木之佩塔克 --job 流子',
    '  mblogs 枯木之佩塔克 --rank 15 --job 黑魔导士',
    '  mblogs 布里列赫 --all',
    '  mblogs --help',
    '',
    `支持副本：${DUNGEONS.map((item) => item.name).join('、')}`,
    `支持 Boss：${bossNames}`,
    `支持职业：${classNames}`
  ].join('\n');
}

function parseMblogsInput(content) {
  const tokens = String(content || '').trim().split(/\s+/).filter(Boolean);
  let showAll = false;
  let help = false;
  let rank = null;
  let job = null;
  const keywordParts = [];

  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (token === '--help' || token.toLowerCase() === 'help' || token === '帮助') {
      help = true;
      continue;
    }
    if (token === '--all') {
      showAll = true;
      continue;
    }
    if (token === '--withskill') {
      continue;
    }
    if (token === '--rank') {
      const value = Number(tokens[++i]);
      if (Number.isFinite(value) && value > 0) {
        rank = Math.floor(value);
      }
      continue;
    }
    if (token === '--job') {
      const jobParts = [];
      while (i + 1 < tokens.length && !String(tokens[i + 1]).startsWith('--')) {
        jobParts.push(tokens[++i]);
      }
      job = jobParts.join(' ').trim() || null;
      continue;
    }
    if (token === '--show') {
      while (i + 1 < tokens.length && !String(tokens[i + 1]).startsWith('--')) i += 1;
      continue;
    }
    keywordParts.push(token);
  }

  return {
    keyword: keywordParts.join(' '),
    showAll,
    help,
    rank,
    job
  };
}

async function queryMblogs(content) {
  if (isMblogsHelpRequest(content)) {
    return buildMblogsHelp();
  }
  const params = parseMblogsInput(content);
  if (params.help) return buildMblogsHelp();

  const data = await getBridgeClient().mblogs({
    keyword: params.keyword || DEFAULT_DUNGEON,
    rank: params.rank,
    job: params.job || '',
    showAll: params.showAll
  });
  if (data.error) return data.error;
  if (!data.sections?.some((section) => section.rows?.length)) {
    return '未找到已同意参与公开排行的 DPS 记录';
  }

  const output = path.join(IMAGE_DATA, 'mabi_other', 'MabiLogs.png');
  await renderMblogsList({
    title: data.title,
    description: data.description,
    output,
    showMode: 'hidden',
    sections: data.sections
  });
  return `[CQ:image,file=${path.join('send', 'mabi_other', 'MabiLogs.png')}]`;
}

async function querySmuggler({ superQuery = false } = {}) {
  const data = await getBridgeClient().smuggler();
  return renderSmugglerFromBridge(data, { includePrediction: superQuery });
}

module.exports = {
  queryTelevision,
  queryTelevisionStats,
  queryMblogs,
  querySmuggler,
  parseMblogsInput,
  parseMbtvsArgs,
  parseMbcdsArgs,
  parseMbzzsArgs,
  formatRecordTime,
  buildMblogsHelp
};
