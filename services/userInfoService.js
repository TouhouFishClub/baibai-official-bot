/**
 * 私聊 / 频道私信的昵称与 openid 对应
 * 来源是事件体 author.username（及 nick/nickname），写入 db_bot.qq_users。
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

  async function getStoredUserName(userOpenid) {
    const id = String(userOpenid || '').trim();
    if (!id || !configured()) return null;
    try {
      const collection = await getCollection();
      if (!collection) return null;
      const doc = await collection.findOne({ _id: id });
      const name = String(doc?.username || '').trim();
      return name || null;
    } catch (error) {
      log.warn('读取私聊用户缓存失败', error);
      return null;
    }
  }

  async function getLogLabels(userOpenid) {
    return { userName: await getStoredUserName(userOpenid) };
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
      const username = resolveUserName(author, extra);
      const source = resolveSource(extra);
      const guildId = String(extra.guildId || extra.guild_id || eventData.guild_id || '').trim();
      const update = {
        user_openid: author.user_openid || '',
        user_id: author.id || '',
        union_openid: author.union_openid || '',
        last_seen_at: seenAt,
        updated_at: seenAt
      };
      if (!update.user_openid && source === 'c2c') update.user_openid = id;
      if (!update.user_id && source === 'direct') update.user_id = id;
      if (username) update.username = username;
      if (source) update.last_source = source;
      if (guildId) update.guild_id = guildId;

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
  rememberUser: defaultService.rememberUser,
  getStoredUserName: defaultService.getStoredUserName,
  getLogLabels: defaultService.getLogLabels,
  observePrivateUser,
  observeC2CUser: observePrivateUser
};
