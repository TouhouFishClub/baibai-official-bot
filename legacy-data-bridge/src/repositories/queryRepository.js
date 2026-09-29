const SERVER_ALIASES = {
  ylx: 'ylx',
  伊鲁夏: 'ylx',
  猫服: 'ylx',
  yt: 'yate',
  亚特: 'yate'
};
const ALLOWED_SERVERS = new Set(['ylx', 'yate']);
const TV_FIELDS = {
  mbtv: ['reward', 'character_name', 'dungeon_name'],
  mbcd: ['item_name', 'character_name', 'draw_pool'],
  mbzz: ['item_name', 'character_name']
};

function escapeRegex(value) {
  return String(value || '')
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    .replace(/%/g, '.*');
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

function splitServerPrefix(content) {
  const input = limitedString(content, 80, '查询内容');
  const found = Object.entries(SERVER_ALIASES).find(([alias]) => input.startsWith(alias));
  return found
    ? { server: found[1], filter: input.slice(found[0].length).trim() }
    : { server: null, filter: input };
}

function buildTelevisionQuery(kind, filter) {
  const fields = TV_FIELDS[kind];
  if (!fields || !filter) return {};
  const parts = String(filter).split('-');
  if (parts.length === 1) {
    const regex = new RegExp(escapeRegex(filter), 'i');
    const orFields = kind === 'mbtv' ? fields : fields.slice(0, 2);
    return { $or: orFields.map((field) => ({ [field]: regex })) };
  }
  const conditions = parts
    .slice(0, fields.length)
    .map((part, index) => part ? { [fields[index]]: new RegExp(escapeRegex(part), 'i') } : null)
    .filter(Boolean);
  return conditions.length > 1 ? { $and: conditions } : (conditions[0] || {});
}

async function resolveServer(db, userId, explicitServer) {
  if (ALLOWED_SERVERS.has(explicitServer)) return explicitServer;
  if (userId) {
    const saved = await db.collection('cl_mabinogi_user_server').findOne(
      { _id: String(userId) },
      { projection: { sv: 1 } }
    );
    if (ALLOWED_SERVERS.has(saved?.sv)) return saved.sv;
  }
  return 'ylx';
}

const TV_PROJECTION = {
  mbtv: { character_name: 1, reward: 1, dungeon_name: 1, channel: 1, time: 1, ts: 1 },
  mbcd: { character_name: 1, item_name: 1, draw_pool: 1, time: 1, ts: 1 },
  mbzz: { character_name: 1, item_name: 1, channel: 1, time: 1, ts: 1 }
};

async function queryTelevision(db, params) {
  const kind = TV_FIELDS[params.kind] ? params.kind : 'mbtv';
  const parsed = splitServerPrefix(params.content);
  const server = await resolveServer(db, params.userId, params.server || parsed.server);
  const limit = boundedInt(params.limit, 20, 50);
  const query = buildTelevisionQuery(kind, parsed.filter);
  const collection = db.collection(`cl_${kind}_${server}`);
  const projection = TV_PROJECTION[kind];
  const [total, rows] = await Promise.all([
    collection.countDocuments(query),
    collection.find(query, { projection }).sort({ ts: -1 }).limit(limit).toArray()
  ]);
  return {
    kind,
    server,
    filter: parsed.filter,
    total,
    rows: rows.map(({ _id, ...row }) => row)
  };
}

async function queryOptionsetWhere(db, params) {
  const name = limitedString(params.name, 100, '释放卷名称');
  const level = limitedString(params.level, 4, '释放卷等级');
  if (!name || !level) throw new Error('释放卷名称和等级不能为空');
  const row = await db.collection('cl_mabinogi_optionset').findOne(
    { _id: `${name}_${level}` },
    { projection: { where: 1, customWhere: 1, author: 1, Usage: 1, level: 1 } }
  );
  if (!row) return { rows: [] };
  const rows = Array.isArray(row.customWhere) && row.customWhere.length
    ? row.customWhere
    : (row.where || []);
  return { rows: rows.map(String) };
}

async function searchOptionsetWhere(db, params) {
  const keywords = (params.keywords || [])
    .map((value) => limitedString(value, 60, '出处关键词'))
    .filter(Boolean)
    .slice(0, 6);
  if (!keywords.length) return { rows: [] };
  const conditions = keywords.map((keyword) => {
    const regex = new RegExp(escapeRegex(keyword), 'i');
    return { $or: [{ customWhere: regex }, { where: regex }] };
  });
  const rows = await db.collection('cl_mabinogi_optionset')
    .find({ $and: conditions }, { projection: { Usage: 1, level: 1 } })
    .limit(100)
    .toArray();
  return { rows: rows.map((row) => ({ _id: String(row._id), Usage: row.Usage, level: row.level })) };
}

const { queryMblogs } = require('./mblogsQuery');

async function querySmuggler(db) {
  const now = Date.now();
  const [recent, latest, prediction] = await Promise.all([
    db.collection('cl_mabinogi_smuggler')
      .find(
        {
          ts: { $gte: now - 60 * 60 * 1000 },
          type: { $in: ['forecast', 'appear', 'disappear_forecast'] },
          area: { $ne: null }
        },
        { projection: { type: 1, area: 1, item: 1, ts: 1, time: 1 } }
      )
      .sort({ ts: 1 }).toArray(),
    db.collection('cl_mabinogi_smuggler')
      .findOne({}, { sort: { ts: -1 }, projection: { type: 1, area: 1, item: 1, ts: 1, time: 1 } }),
    db.collection('cl_mabinogi_smuggler_kr')
      .findOne(
        { krTs: { $gte: now } },
        { sort: { krTs: 1 }, projection: { goods: 1, goodsCN: 1, position: 1, positionCN: 1, krTs: 1, krTime: 1, values: 1 } }
      )
  ]);
  const stripId = (row) => row ? Object.fromEntries(Object.entries(row).filter(([key]) => key !== '_id')) : null;
  return { now, recent: recent.map(stripId), latest: stripId(latest), prediction: stripId(prediction) };
}

async function executeOperation(db, operation, params = {}) {
  switch (operation) {
    case 'television.mbtv':
      return queryTelevision(db, { ...params, kind: 'mbtv' });
    case 'television.mbcd':
      return queryTelevision(db, { ...params, kind: 'mbcd' });
    case 'television.mbzz':
      return queryTelevision(db, { ...params, kind: 'mbzz' });
    case 'television.mbtvs':
      return require('./televisionStats').queryMbtvStats(db, params);
    case 'television.mbcds':
      return require('./televisionStats').queryMbcdStats(db, params);
    case 'television.mbzzs':
      return require('./televisionStats').queryMbzzStats(db, params);
    case 'optionset.where':
      return queryOptionsetWhere(db, params);
    case 'optionset.search':
      return searchOptionsetWhere(db, params);
    case 'mblogs.query':
      return queryMblogs(db, params);
    case 'smuggler.latest':
      return querySmuggler(db);
    default:
      throw new Error('不支持的查询操作');
  }
}

module.exports = {
  executeOperation,
  buildTelevisionQuery,
  splitServerPrefix,
  escapeRegex,
  limitedString,
  queryMblogs
};
