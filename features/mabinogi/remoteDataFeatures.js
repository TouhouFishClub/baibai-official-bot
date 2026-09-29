const { getBridgeClient } = require('../../services/legacyDataBridgeClient');
const { renderDataTable } = require('./remoteDataRenderer');

function formatTime(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value || '') : date.toLocaleString('zh-CN', { hour12: false });
}

async function queryTelevision(kind, content, context = {}) {
  const data = await getBridgeClient().television(kind, {
    content,
    userId: context.userId,
    limit: 20
  });
  if (!data.rows.length) return '未找到符合条件的记录';

  const isMbtv = kind === 'mbtv';
  return renderDataTable({
    fileName: isMbtv ? 'MabiTV.png' : 'MabiGC.png',
    title: `${isMbtv ? '出货记录' : '抽蛋记录'}：${data.server === 'yate' ? '亚特' : '猫服'}`,
    description: `数据库匹配 ${data.total} 条，显示最新 ${data.rows.length} 条`,
    columns: isMbtv
      ? [
        { label: '角色', key: 'character_name' },
        { label: '物品', key: 'reward' },
        { label: '地下城', key: 'dungeon_name' },
        { label: '频道', key: 'channel' },
        { label: '时间', key: 'time', format: (value, row) => formatTime(value || row.ts) }
      ]
      : [
        { label: '角色', key: 'character_name' },
        { label: '物品', key: 'item_name' },
        { label: '手帕', key: 'draw_pool' },
        { label: '时间', key: 'time', format: (value, row) => formatTime(value || row.ts) }
      ],
    rows: data.rows
  });
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
  return renderDataTable({
    fileName: 'MabiLogs.png',
    title: `DPS 排行：${data.keyword}`,
    description: `显示前 ${data.rank} 条；匿名玩家已脱敏`,
    columns: [
      { label: '角色', key: 'characterName' },
      { label: '职业', key: 'characterClass' },
      { label: '副本', key: 'dungeonName' },
      { label: 'Boss', key: 'bossName' },
      { label: 'DPS', key: 'dps', format: (value) => Number(value || 0).toLocaleString() },
      { label: '时间', key: 'recordTime', format: formatTime }
    ],
    rows: data.rows
  });
}

function describeSmuggler(data) {
  const latest = data.recent[data.recent.length - 1] || data.latest;
  if (!latest) return [];
  const typeNames = {
    forecast: '即将出现',
    appear: '出现中',
    disappear_forecast: '即将消失'
  };
  const rows = [{
    category: '国服当前观测',
    status: typeNames[latest.type] || latest.type || '未知',
    item: latest.item || '未知物品',
    area: latest.area || '未知地区',
    time: formatTime(latest.ts || latest.time)
  }];
  if (data.prediction) {
    rows.push({
      category: '韩服下次预测',
      status: '预测',
      item: data.prediction.goodsCN || data.prediction.goods || '未知物品',
      area: data.prediction.positionCN || data.prediction.position || '未知地区',
      time: formatTime(data.prediction.krTs || data.prediction.krTime)
    });
  }
  return rows;
}

async function querySmuggler() {
  const data = await getBridgeClient().smuggler();
  const rows = describeSmuggler(data);
  if (!rows.length) return '当前没有检测到走私商人相关消息';
  return renderDataTable({
    fileName: 'smuggler.png',
    title: '走私商人信息',
    description: '数据由老服务器只读数据库桥接提供',
    columns: [
      { label: '类型', key: 'category' },
      { label: '状态', key: 'status' },
      { label: '物品', key: 'item' },
      { label: '地区', key: 'area' },
      { label: '时间', key: 'time' }
    ],
    rows
  });
}

module.exports = {
  queryTelevision,
  queryMblogs,
  querySmuggler,
  parseMblogsInput,
  describeSmuggler
};
