const {
  DUNGEONS,
  getBossKeysByGroup,
  getGroupSortHp,
  resolveBossGroupKey,
  resolveQueryType
} = require('../../shared/mblogsBossConfig');
const { resolveClassQuery } = require('../../shared/mblogsClassConfig');

const DEFAULT_DUNGEON = '布里列赫';
const DEFAULT_RANK = 10;
const BOSS_DEFAULT_RANK = 30;
const CHARACTER_DEFAULT_RANK = 3;
const USER_MAX_RANK = 30;
const ANONYMOUS_CHARACTER_NAME = '神秘的米莱西安';

const RECORD_PROJECTION = {
  characterId: 1,
  characterName: 1,
  characterClass: 1,
  dungeonName: 1,
  bossName: 1,
  bossKey: 1,
  bossGroup: 1,
  dps: 1,
  duration: 1,
  teamSize: 1,
  recordTime: 1,
  totalDamage: 1,
  damagePercent: 1,
  bossHp: 1,
  runId: 1
};

function escapeRegex(value) {
  return String(value || '')
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function boundedInt(value, fallback, max) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? Math.min(number, max) : fallback;
}

function limitedString(value, maxLength, fieldName) {
  const result = String(value || '').trim();
  if (result.length > maxLength) throw new Error(`${fieldName} 超出长度限制`);
  return result;
}

function resolveRank(queryType, rank) {
  let limit;
  if (rank) {
    limit = boundedInt(rank, DEFAULT_RANK, USER_MAX_RANK);
  } else if (queryType === 'boss') {
    limit = BOSS_DEFAULT_RANK;
  } else if (queryType === 'character') {
    limit = CHARACTER_DEFAULT_RANK;
  } else {
    limit = DEFAULT_RANK;
  }
  return Math.min(limit, USER_MAX_RANK);
}

function buildRankDescription({ mode, showAll, rank, job }) {
  if (mode === 'character') {
    const parts = [`各 Boss 前 ${rank} 名（仅统计已击杀）`];
    if (job) parts.push(`职业：${job}`);
    return parts.join('，');
  }
  const scope = mode === 'dungeon' ? `各 Boss 前 ${rank} 名` : `前 ${rank} 名`;
  const parts = [scope];
  if (showAll) parts.push('仅统计已击杀');
  else parts.push('每角色仅保留最高 DPS');
  if (job) parts.push(`职业：${job}`);
  return `${parts[0]}（${parts.slice(1).join('，')}）`;
}

function buildTitle(baseTitle, job) {
  return job ? `${baseTitle} · ${job}` : baseTitle;
}

function appendRecordFilters(query, { characterClass, characterIds } = {}) {
  const result = { ...query };
  if (characterClass) result.characterClass = String(characterClass);
  if (Array.isArray(characterIds)) {
    result.characterId = { $in: characterIds.map((id) => String(id)) };
  }
  return result;
}

function dedupeBestPerCharacter(records) {
  const best = new Map();
  for (const record of records) {
    const key = String(record.characterId || record.characterName || '').trim();
    if (!key) continue;
    const prev = best.get(key);
    if (!prev || Number(record.dps) > Number(prev.dps)) {
      best.set(key, record);
    }
  }
  return [...best.values()];
}

function groupTopByBoss(records, limitPerBoss, { bestPerCharacter = false } = {}) {
  const groups = new Map();
  for (const record of records) {
    const key = resolveBossGroupKey(record.bossGroup || record.bossKey || record.bossName || 'unknown');
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(record);
  }

  const result = [];
  for (const [groupKey, items] of groups) {
    const candidates = bestPerCharacter ? dedupeBestPerCharacter(items) : items;
    const sorted = candidates.sort((a, b) => b.dps - a.dps).slice(0, limitPerBoss);
    result.push({
      bossKey: groupKey,
      bossName: sorted[0]?.bossName || groupKey,
      records: sorted
    });
  }
  result.sort((a, b) => getGroupSortHp(a.bossKey) - getGroupSortHp(b.bossKey));
  return result;
}

async function findRecords(db, query, limit) {
  return db.collection('cl_mabinogi_dps_records')
    .find(query, { projection: RECORD_PROJECTION })
    .sort({ dps: -1 })
    .limit(limit)
    .toArray();
}

function sanitizeRow(row, consent) {
  const mode = ['anonymous', 'public'].includes(consent?.mode) ? consent.mode : 'none';
  const serverId = String(consent?.serverId || consent?.server || '').trim().toLowerCase();
  const publicName = String(consent?.playerName || '').trim();
  return {
    characterName: mode === 'public' && publicName ? publicName : ANONYMOUS_CHARACTER_NAME,
    characterClass: row.characterClass || '未知',
    dungeonName: row.dungeonName,
    recordTime: row.recordTime,
    teamSize: row.teamSize,
    bossName: row.bossName,
    bossKey: row.bossKey,
    bossGroup: row.bossGroup,
    duration: row.duration,
    dps: row.dps,
    bossHp: row.bossHp,
    totalDamage: row.totalDamage,
    damagePercent: row.damagePercent,
    runId: row.runId ? String(row.runId) : '',
    rankingVisibility: mode,
    serverId
  };
}

function mapSections(groups, consentMap) {
  return groups.map((group) => ({
    title: group.bossName,
    rows: (group.records || [])
      .map((row) => {
        const consent = consentMap.get(String(row.characterId));
        const mode = ['anonymous', 'public'].includes(consent?.mode) ? consent.mode : 'none';
        if (mode === 'none') return null;
        return sanitizeRow(row, consent);
      })
      .filter(Boolean)
  })).filter((section) => section.rows.length);
}

async function queryMblogs(db, params) {
  const keyword = limitedString(params.keyword || DEFAULT_DUNGEON, 80, 'mblogs 关键词') || DEFAULT_DUNGEON;
  const jobRaw = params.job ? limitedString(params.job, 40, '职业') : '';
  const resolvedJob = jobRaw ? resolveClassQuery(jobRaw) : undefined;
  const showAll = Boolean(params.showAll);
  const query = resolveQueryType(keyword);
  const resolved = query.type === 'help'
    ? { type: 'dungeon', dungeon: DUNGEONS[0] }
    : query;
  const rank = resolveRank(resolved.type, params.rank);

  const consentRows = await db.collection('cl_mabinogi_dps_ranking_consent')
    .find(
      { mode: { $in: ['anonymous', 'public'] }, playerId: /^45[0-9]{1,18}$/ },
      { projection: { playerId: 1, playerName: 1, mode: 1, serverId: 1, server: 1 } }
    )
    .toArray();
  const consentMap = new Map(consentRows.map((row) => [String(row.playerId), row]));
  const characterIds = [...consentMap.keys()];
  if (!characterIds.length) {
    return { error: '未找到已同意参与公开排行的 DPS 记录' };
  }

  const queryOptions = {
    characterClass: resolvedJob || undefined,
    characterIds
  };

  let mode;
  let title;
  let description;
  let sections;

  if (resolved.type === 'character') {
    const all = await findRecords(db, appendRecordFilters({
      characterName: new RegExp(escapeRegex(resolved.name), 'i')
    }, queryOptions), 500);
    const groups = groupTopByBoss(all, rank);
    sections = mapSections(groups, consentMap);
    if (!sections.length) {
      const suffix = jobRaw ? `（职业：${resolvedJob || jobRaw}）` : '';
      return { error: `未找到角色「${resolved.name}」的通关 DPS 记录${suffix}` };
    }
    mode = 'character';
    title = buildTitle(`DPS记录：${resolved.name}`, resolvedJob || jobRaw);
    description = buildRankDescription({ mode, showAll, rank, job: resolvedJob || jobRaw });
  } else if (resolved.type === 'dungeon') {
    const all = await findRecords(db, appendRecordFilters({
      dungeonName: new RegExp(escapeRegex(resolved.dungeon.name), 'i')
    }, queryOptions), 1000);
    const groups = groupTopByBoss(all, rank, { bestPerCharacter: !showAll });
    sections = mapSections(groups, consentMap);
    if (!sections.length) {
      const suffix = jobRaw ? `（职业：${resolvedJob || jobRaw}）` : '';
      return { error: `未找到副本「${resolved.dungeon.name}」的 DPS 记录${suffix}` };
    }
    mode = 'dungeon';
    title = buildTitle(`DPS记录：${resolved.dungeon.name}`, resolvedJob || jobRaw);
    description = buildRankDescription({ mode, showAll, rank, job: resolvedJob || jobRaw });
  } else {
    const bossKeys = getBossKeysByGroup(resolved.boss.groupKey);
    const all = await findRecords(db, appendRecordFilters({
      $or: [
        { bossGroup: resolved.boss.groupKey },
        { bossKey: { $in: bossKeys } }
      ]
    }, queryOptions), 500);
    let sorted = all.sort((a, b) => b.dps - a.dps);
    if (!showAll) sorted = dedupeBestPerCharacter(sorted);
    const rows = sorted.slice(0, rank)
      .map((row) => {
        const consent = consentMap.get(String(row.characterId));
        const visibility = ['anonymous', 'public'].includes(consent?.mode) ? consent.mode : 'none';
        if (visibility === 'none') return null;
        return sanitizeRow(row, consent);
      })
      .filter(Boolean);
    if (!rows.length) {
      const suffix = jobRaw ? `（职业：${jobRaw}）` : '';
      return { error: `未找到 Boss「${resolved.boss.displayName}」的 DPS 记录${suffix}` };
    }
    mode = 'boss';
    title = buildTitle(`DPS记录：${resolved.boss.displayName}`, resolvedJob || jobRaw);
    description = buildRankDescription({ mode, showAll, rank, job: resolvedJob || jobRaw });
    sections = [{ rows }];
  }

  return { keyword, rank, mode, title, description, sections };
}

module.exports = {
  ANONYMOUS_CHARACTER_NAME,
  DEFAULT_DUNGEON,
  queryMblogs,
  resolveRank
};
