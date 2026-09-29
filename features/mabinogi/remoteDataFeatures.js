const path = require('path');
const { IMAGE_DATA } = require('../../baibaiConfigs');
const { getBridgeClient } = require('../../services/legacyDataBridgeClient');
const { render } = require('./Television/render');
const { parseMbtvsArgs, renderStatsImage: renderMbtvStatsImage } = require('./Television/mbtvStats');
const { parseMbcdsArgs, renderStatsImage: renderMbcdStatsImage } = require('./Television/mbcdStats');
const { parseMbzzsArgs, renderStatsImage: renderMbzzStatsImage } = require('./Television/mbzzStats');
const { renderSmugglerFromBridge } = require('./smuggler/renderSmuggler');

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
  const data = await getBridgeClient().television(kind, {
    content,
    userId: context.userId,
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

function parseMblogsInput(content) {
  const tokens = String(content || '').trim().split(/\s+/).filter(Boolean);
  const result = { keyword: '', rank: 10, job: '', showAll: false };
  const keyword = [];
  for (let index = 0; index < tokens.length; index += 1) {
    if (tokens[index] === '--rank') {
      result.rank = Math.min(Math.max(Number(tokens[++index]) || 10, 1), 30);
    } else if (tokens[index] === '--job') {
      result.job = tokens[++index] || '';
    } else if (tokens[index] === '--all') {
      result.showAll = true;
    } else {
      keyword.push(tokens[index]);
    }
  }
  result.keyword = keyword.join(' ') || '布里列赫';
  return result;
}

async function queryMblogs(content) {
  if (/^(help|帮助|--help)$/i.test(String(content || '').trim())) {
    return '用法：mblogs [角色/副本/Boss] [--rank 1-30] [--job 职业] [--all]';
  }
  const params = parseMblogsInput(content);
  const data = await getBridgeClient().mblogs(params);
  if (!data.rows.length) return '未找到已同意公开排行的 DPS 记录';
  return renderLegacyTable({
    fileName: 'MabiLogs.png',
    title: `DPS 排行：${data.keyword}`,
    description: `显示前 ${data.rank} 条；匿名玩家已脱敏`,
    columns: [
      { label: '角色', key: 'characterName' },
      { label: '职业', key: 'characterClass' },
      { label: '副本', key: 'dungeonName' },
      { label: 'Boss', key: 'bossName' },
      { label: 'DPS', key: 'dps', format: (value) => Number(value || 0).toLocaleString() },
      { label: '时间', key: 'recordTime', format: formatRecordTime }
    ],
    rows: data.rows
  });
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
  formatRecordTime
};
