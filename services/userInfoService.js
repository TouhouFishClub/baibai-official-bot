/**
 * 私聊 / 频道私信的昵称与 openid 对应
 * 频道私信和 C2C 昵称分开存（direct_username / c2c_username）。
 * C2C 常无事件昵称，回退 qq_group_members 同 openid 的群昵称，不用频道名。
 */

const logger = require('../utils/logger');
const {
  getDatabase,
  isMongoConfigured,
  warnMissingMongoOnce
} = require('./mongo');
const { EVENT_TYPE } = require('../utils/constants');

const DEFAULT_COLLECTION = 'qq_users';
const PRIVATE_EVENT_SOURCES = {
  [EVENT_TYPE.C2C_MESSAGE_CREATE]: 'c2c',
  [EVENT_TYPE.DIRECT_MESSAGE_CREATE]: 'direct'
};

function resolveCollectionName(value = process.env.MONGODB_USER_COLLECTION) {
  return String(value || DEFAULT_COLLECTION).trim() || DEFAULT_COLLECTION;
}

function resolveUserOpenid(author = {}) {
  return author.user_openid || author.union_openid || author.id || null;
}

function resolveExtraEventData(extra = {}) {
  if (!extra || typeof extra !== 'object') return {};
  if (extra.eventData && typeof extra.eventData === 'object') return extra.eventData;
  return extra;
}

function resolveUserName(author = {}, extra = {}) {
  const eventData = resolveExtraEventData(extra);
  const name =
    author.username ||
    author.member_name ||
    author.nick ||
    author.nickname ||
    eventData.nickname ||
    eventData.username;
  const trimmed = String(name || '').trim();
  return trimmed || null;
}

function resolveSource(extra = {}) {
  const explicit = extra.source || extra.eventType;
  if (PRIVATE_EVENT_SOURCES[explicit]) return PRIVATE_EVENT_SOURCES[explicit];
  if (explicit === 'c2c' || explicit === 'direct') return explicit;
  return null;
}

function sourceUsernameField(source) {
  return source === 'direct' ? 'direct_username' : 'c2c_username';
}

function readSourceName(doc, source) {
  if (!doc || !source) return null;
  const named = String(doc[sourceUsernameField(source)] || '').trim();
  if (named) return named;
  const sources = Array.isArray(doc.sources) ? [...new Set(doc.sources.filter(Boolean))] : [];
  if (sources.length === 1 && sources[0] === source) {
    return String(doc.username || '').trim() || null;
  }
  return null;
}

function defaultFindGroupMemberName(memberOpenid) {
  return require('./groupInfoService').findMemberNameByOpenid(memberOpenid);
}

function createUserInfoService(options = {}) {
  const now = options.now || (() => new Date());
  const collectionName = resolveCollectionName(options.collectionName);
  const configured = options.isConfigured || isMongoConfigured;
  const getCollection = options.getCollection || (async () => {
    const db = await getDatabase();
    if (!db) return null;
    return db.collection(collectionName);
  });
  const log = options.logger || logger;
  const findGroupMemberName = options.findGroupMemberName || defaultFindGroupMemberName;

  async function getStoredUserName(userOpenid, source = 'c2c') {
    const id = String(userOpenid || '').trim();
    const resolvedSource = source === 'direct' ? 'direct' : 'c2c';
    if (!id) return null;
    if (configured()) {
      try {
        const collection = await getCollection();
        if (collection) {
          const doc = await collection.findOne({ _id: id });
          const name = readSourceName(doc, resolvedSource);
          if (name) return name;
        }
      } catch (error) {
        log.warn('读取私聊用户缓存失败', error);
      }
    }
    if (resolvedSource === 'c2c') return findGroupMemberName(id);
    return null;
  }

  async function getLogLabels(userOpenid, source = 'c2c') {
    return { userName: await getStoredUserName(userOpenid, source) };
  }

  async function rememberUser(author = {}, extra = {}) {
    const id = String(resolveUserOpenid(author) || '').trim();
    if (!id) return null;
    if (!configured()) {
      warnMissingMongoOnce(log);
      return null;
    }
    try {
      const collection = await getCollection();
      if (!collection) {
        warnMissingMongoOnce(log);
        return null;
      }
      const seenAt = now();
      const eventData = resolveExtraEventData(extra);
      const source = resolveSource(extra);
      const existing = await collection.findOne({ _id: id });
      let username = resolveUserName(author, extra);
      if (!username && source) {
        username = readSourceName(existing, source);
        if (!username && source === 'c2c') {
          username = await findGroupMemberName(id);
        }
      }
      const guildId = String(extra.guildId || extra.guild_id || eventData.guild_id || '').trim();
      const update = {
        last_seen_at: seenAt,
        updated_at: seenAt
      };
      if (author.user_openid) update.user_openid = String(author.user_openid);
      else if (source === 'c2c') update.user_openid = id;
      if (author.union_openid) update.union_openid = String(author.union_openid);
      if (source === 'direct' && author.id) update.user_id = String(author.id);
      if (source && username) update[sourceUsernameField(source)] = username;
      if (source) update.last_source = source;
      if (source === 'direct' && guildId) update.guild_id = guildId;

      const operation = { $set: update };
      if (source) operation.$addToSet = { sources: source };

      await collection.updateOne(
        { _id: id },
        operation,
        { upsert: true }
      );
      return collection.findOne({ _id: id });
    } catch (error) {
      log.warn('同步私聊用户资料失败', error);
      return null;
    }
  }

  return {
    rememberUser,
    getStoredUserName,
    getLogLabels
  };
}

const defaultService = createUserInfoService();

function observePrivateUser(eventData = {}, eventType = null) {
  const source = PRIVATE_EVENT_SOURCES[eventType];
  if (!source) return;
  void defaultService.rememberUser(eventData.author, {
    eventData,
    source,
    guildId: eventData.guild_id
  });
}

module.exports = {
  DEFAULT_COLLECTION,
  createUserInfoService,
  resolveUserOpenid,
  resolveUserName,
  readSourceName,
  sourceUsernameField,
  rememberUser: defaultService.rememberUser,
  getStoredUserName: defaultService.getStoredUserName,
  getLogLabels: defaultService.getLogLabels,
  observePrivateUser,
  observeC2CUser: observePrivateUser
};
