const { buildTelevisionQuery, limitedString } = require('./queryRepository');
const { queryMbcdStats } = require('./mbcdPayload');

const ONE_YEAR_MS = 366 * 24 * 60 * 60 * 1000;
const CHANNEL_COUNT = 10;
const PIE_PALETTE = [
  '#6C9BD2', '#E8A87C', '#C38D9E', '#41B3A3', '#E27D60',
  '#8FC1A9', '#F64C72', '#99738E', '#85CDCA', '#EAB965'
];

function pad2(n) {
  return n < 10 ? `0${n}` : `${n}`;
}

function dateKey(value) {
  const date = new Date(value);
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function enumerateDays(start, end) {
  const days = [];
  const cursor = new Date(start.getFullYear(), start.getMonth(), start.getDate(), 0, 0, 0, 0);
  const last = new Date(end.getFullYear(), end.getMonth(), end.getDate(), 0, 0, 0, 0);
  while (cursor <= last) {
    days.push(dateKey(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return days;
}

function formatRangeText(start, end) {
  const format = (value) => {
    const date = new Date(value);
    return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()} ${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
  };
  return `${format(start)} ~ ${format(end)}`;
}

function topNWithOther(map, n = 15) {
  const arr = [...map.entries()].sort((a, b) => b[1] - a[1]);
  if (arr.length <= n) {
    return { labels: arr.map(([key]) => key), data: arr.map(([, value]) => value) };
  }
  const head = arr.slice(0, n);
  const rest = arr.slice(n).reduce((sum, [, value]) => sum + value, 0);
  return {
    labels: [...head.map(([key]) => key), '其他'],
    data: [...head.map(([, value]) => value), rest]
  };
}

function parseRange(params) {
  const startTs = Number(params.startTs);
  const endTs = Number(params.endTs);
  if (!Number.isFinite(startTs) || !Number.isFinite(endTs)) {
    throw new Error('时间范围无效');
  }
  if (endTs < startTs) {
    throw new Error('结束时间不能早于开始时间');
  }
  if (endTs - startTs > ONE_YEAR_MS) {
    throw new Error('时间范围不能超过1年');
  }
  return { start: new Date(startTs), end: new Date(endTs) };
}

function parseChannelNum(channel) {
  if (channel === undefined || channel === null || channel === '') return null;
  const number = Number(channel);
  return Number.isFinite(number) && number >= 1 && number <= CHANNEL_COUNT ? number : null;
}

function channelsToBits(channelSet) {
  const bits = new Array(CHANNEL_COUNT).fill(false);
  if (!channelSet) return bits;
  for (const channel of channelSet) {
    if (channel >= 1 && channel <= CHANNEL_COUNT) bits[channel - 1] = true;
  }
  return bits;
}

function normalizeRewardForPie(reward) {
  const raw = reward && String(reward).trim().length ? String(reward).trim() : '(空)';
  if (raw === '(空)') return raw;
  if (raw.indexOf('魔法释放') > -1) {
    const idx = raw.lastIndexOf('-');
    if (idx > -1 && idx < raw.length - 1) {
      return raw.substring(idx + 1).replace(/[。.]$/, '').trim();
    }
  }
  if (raw.indexOf('咒语书') > -1) {
    const plusIdx = raw.indexOf('+1');
    if (plusIdx > -1) {
      const head = raw.substring(0, plusIdx);
      const cut = Math.max(head.indexOf('效果'), head.indexOf('专用'));
      const core = (cut > -1 ? head.substring(cut + 2) : head).trim();
      if (core) return `${core}+1`;
    }
  }
  return raw;
}

function normalizeItemForPie(name) {
  const raw = name && String(name).length ? String(name) : '(无名称)';
  return raw.replace(/布里安恩德斯/g, '').trim();
}

function bump(map, key) {
  const normalized = key && String(key).length ? String(key) : '(空)';
  map.set(normalized, (map.get(normalized) || 0) + 1);
}

async function loadBothServers(db, collectionPrefix, query, projection) {
  const [ylx, yate] = await Promise.all([
    db.collection(`${collectionPrefix}_ylx`).find(query, { projection }).sort({ ts: -1 }).toArray(),
    db.collection(`${collectionPrefix}_yate`).find(query, { projection }).sort({ ts: -1 }).toArray()
  ]);
  return { ylx, yate };
}

function aggregateMbtv(docsYlx, docsYate) {
  const rewardYlx = new Map();
  const rewardYate = new Map();
  const rewardTotal = new Map();
  const dungeonTotal = new Map();
  const channelYlx = new Map();
  const channelYate = new Map();
  const dayYlx = new Map();
  const dayYate = new Map();
  const charYlx = new Map();
  const charYate = new Map();
  const charChannelsYlx = new Map();
  const charChannelsYate = new Map();

  const walk = (docs, server) => {
    for (const doc of docs) {
      const time = doc.time ? new Date(doc.time) : new Date(doc.ts);
      const day = dateKey(time);
      const characterName = doc.character_name || '';
      const rewardLabel = normalizeRewardForPie(doc.reward || '');
      const dungeon = doc.dungeon_name || '';
      const channel = doc.channel === undefined || doc.channel === null ? '' : String(doc.channel);
      bump(server === 'ylx' ? rewardYlx : rewardYate, rewardLabel);
      bump(rewardTotal, rewardLabel);
      bump(dungeonTotal, dungeon);
      bump(server === 'ylx' ? channelYlx : channelYate, channel ? `CH${channel}` : '(空)');
      const dayMap = server === 'ylx' ? dayYlx : dayYate;
      if (!dayMap.has(day)) dayMap.set(day, new Set());
      if (characterName) {
        dayMap.get(day).add(characterName);
        const charMap = server === 'ylx' ? charYlx : charYate;
        charMap.set(characterName, (charMap.get(characterName) || 0) + 1);
        const channelNum = parseChannelNum(channel);
        if (channelNum != null) {
          const channelMap = server === 'ylx' ? charChannelsYlx : charChannelsYate;
          if (!channelMap.has(characterName)) channelMap.set(characterName, new Set());
          channelMap.get(characterName).add(channelNum);
        }
      }
    }
  };

  walk(docsYlx, 'ylx');
  walk(docsYate, 'yate');
  return {
    rewardYlx, rewardYate, rewardTotal, dungeonTotal, channelYlx, channelYate,
    dayYlx, dayYate, charYlx, charYate, charChannelsYlx, charChannelsYate
  };
}

function buildMbtvPayload(start, end, agg, filterText) {
  const labels = enumerateDays(start, end);
  const ylxSeries = labels.map((day) => (agg.dayYlx.get(day) ? agg.dayYlx.get(day).size : 0));
  const yateSeries = labels.map((day) => (agg.dayYate.get(day) ? agg.dayYate.get(day).size : 0));
  const buildTop = (charMap, channelMap) => [...charMap.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([name, count], index) => ({
      rank: index + 1,
      name,
      count,
      channels: channelsToBits(channelMap.get(name))
    }));

  return {
    rangeText: formatRangeText(start, end),
    filterNote: filterText && filterText.trim() ? `筛选：${filterText.trim()}` : '筛选：无（全量）',
    totalRecords: [...agg.rewardYlx.values()].reduce((sum, value) => sum + value, 0)
      + [...agg.rewardYate.values()].reduce((sum, value) => sum + value, 0),
    pieRewardYlx: topNWithOther(agg.rewardYlx, 15),
    pieRewardYate: topNWithOther(agg.rewardYate, 15),
    pieRewardTotal: topNWithOther(agg.rewardTotal, 15),
    pieDungeon: topNWithOther(agg.dungeonTotal, 15),
    pieChannelYlx: topNWithOther(agg.channelYlx, 15),
    pieChannelYate: topNWithOther(agg.channelYate, 15),
    line: {
      labels,
      ylxSeries,
      yateSeries,
      sumSeries: labels.map((_, index) => ylxSeries[index] + yateSeries[index])
    },
    topYlx: buildTop(agg.charYlx, agg.charChannelsYlx),
    topYate: buildTop(agg.charYate, agg.charChannelsYate),
    piePalette: PIE_PALETTE
  };
}

function aggregateMbzz(docsYlx, docsYate) {
  const itemYlx = new Map();
  const itemYate = new Map();
  const itemTotal = new Map();
  const dayYlx = new Map();
  const dayYate = new Map();
  const charYlx = new Map();
  const charYate = new Map();

  const walk = (docs, server) => {
    for (const doc of docs) {
      const time = doc.time ? new Date(doc.time) : new Date(doc.ts);
      const day = dateKey(time);
      const characterName = doc.character_name || '';
      const itemLabel = normalizeItemForPie(doc.item_name);
      bump(server === 'ylx' ? itemYlx : itemYate, itemLabel);
      bump(itemTotal, itemLabel);
      const dayMap = server === 'ylx' ? dayYlx : dayYate;
      if (!dayMap.has(day)) dayMap.set(day, new Set());
      if (characterName) {
        dayMap.get(day).add(characterName);
        const charMap = server === 'ylx' ? charYlx : charYate;
        charMap.set(characterName, (charMap.get(characterName) || 0) + 1);
      }
    }
  };

  walk(docsYlx, 'ylx');
  walk(docsYate, 'yate');
  return { itemYlx, itemYate, itemTotal, dayYlx, dayYate, charYlx, charYate };
}

function buildMbzzPayload(start, end, agg, itemFilter) {
  const labels = enumerateDays(start, end);
  const ylxSeries = labels.map((day) => (agg.dayYlx.get(day) ? agg.dayYlx.get(day).size : 0));
  const yateSeries = labels.map((day) => (agg.dayYate.get(day) ? agg.dayYate.get(day).size : 0));
  const buildTop = (charMap) => [...charMap.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([name, count], index) => ({ rank: index + 1, name, count }));

  return {
    rangeText: formatRangeText(start, end),
    filterNote: itemFilter ? `物品筛选：${itemFilter}` : '物品：全部（未按关键词筛选）',
    totalRecords: [...agg.itemYlx.values()].reduce((sum, value) => sum + value, 0)
      + [...agg.itemYate.values()].reduce((sum, value) => sum + value, 0),
    pieYlx: topNWithOther(agg.itemYlx, 15),
    pieYate: topNWithOther(agg.itemYate, 15),
    pieTotal: topNWithOther(agg.itemTotal, 15),
    line: {
      labels,
      ylxSeries,
      yateSeries,
      sumSeries: labels.map((_, index) => ylxSeries[index] + yateSeries[index])
    },
    topYlx: buildTop(agg.charYlx),
    topYate: buildTop(agg.charYate),
    piePalette: PIE_PALETTE
  };
}

async function queryMbtvStats(db, params) {
  const { start, end } = parseRange(params);
  const filter = limitedString(params.filter, 80, '筛选内容');
  const baseQuery = buildTelevisionQuery('mbtv', filter);
  const timeQuery = { time: { $gte: start, $lte: end } };
  const query = Object.keys(baseQuery).length ? { $and: [baseQuery, timeQuery] } : timeQuery;
  const { ylx, yate } = await loadBothServers(db, 'cl_mbtv', query, {
    time: 1, reward: 1, dungeon_name: 1, character_name: 1, channel: 1, ts: 1
  });
  return buildMbtvPayload(start, end, aggregateMbtv(ylx, yate), filter);
}

async function queryMbzzStats(db, params) {
  const { start, end } = parseRange(params);
  const itemFilter = limitedString(params.filter, 80, '筛选内容');
  const query = { time: { $gte: start, $lte: end } };
  if (itemFilter) {
    query.item_name = new RegExp(
      String(itemFilter).replace(/([.+?^${}()|[\]\\])/g, '\\$1').replace(/%/g, '.*'),
      'i'
    );
  }
  const { ylx, yate } = await loadBothServers(db, 'cl_mbzz', query, {
    time: 1, item_name: 1, character_name: 1, ts: 1
  });
  return buildMbzzPayload(start, end, aggregateMbzz(ylx, yate), itemFilter || null);
}

async function queryMbcdStatsForBridge(db, params) {
  const { start, end } = parseRange(params);
  const keyword = limitedString(params.filter, 80, '筛选内容') || null;
  return queryMbcdStats(db, start, end, keyword);
}

module.exports = {
  queryMbtvStats,
  queryMbzzStats,
  queryMbcdStats: queryMbcdStatsForBridge
};
