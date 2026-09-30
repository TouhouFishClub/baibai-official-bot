/**
 * 通过 guild_id 拉取频道资料、指定成员并写入 db_bot
 * GET /guilds/{guild_id}（50 QPS）
 * GET /guilds/{guild_id}/members/{user_id}
 */

const logger = require('../utils/logger');
const {
  getAccessToken,
  qqRequest,
  QQ_API_ROOT
} = require('./messageService');
const {
  getDatabase,
  isMongoConfigured,
  warnMissingMongoOnce
} = require('./mongo');
const {
  parseQqApiError,
  shouldRefreshGroupInfo,
  shouldRefreshMemberInfo,
  resolveMemberRefreshMs
} = require('./groupInfoService');

const DEFAULT_COLLECTION = 'qq_guilds';
const DEFAULT_MEMBER_COLLECTION = 'qq_guild_members';
const DEFAULT_REFRESH_MS = 6 * 60 * 60 * 1000;

function resolveRefreshMs(value = process.env.QQ_GUILD_INFO_REFRESH_MS || process.env.QQ_GROUP_INFO_REFRESH_MS) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_REFRESH_MS;
}

function resolveCollectionName(value = process.env.MONGODB_GUILD_COLLECTION) {
  return String(value || DEFAULT_COLLECTION).trim() || DEFAULT_COLLECTION;
}

function resolveMemberCollectionName(value = process.env.MONGODB_GUILD_MEMBER_COLLECTION) {
  return String(value || DEFAULT_MEMBER_COLLECTION).trim() || DEFAULT_MEMBER_COLLECTION;
}

function memberDocId(guildId, userId) {
  return `${guildId}:${userId}`;
}

function resolveGuildUserId(author = {}) {
  return author.id || author.user_id || null;
}

function resolveGuildMemberName(author = {}, member = {}) {
  const name = member.nick || author.username || author.nick || author.nickname;
  const trimmed = String(name || '').trim();
  return trimmed || null;
}

async function fetchGuildFromQq(guildId) {
  const accessToken = await getAccessToken();
  const response = await qqRequest(
    'GET',
    `${QQ_API_ROOT}/guilds/${encodeURIComponent(guildId)}`,
    null,
    { Authorization: `QQBot ${accessToken}` }
  );
  const data = response?.data || {};
  if (!data.id && !data.name) {
    throw new Error('频道资料响应为空');
  }
  return data;
}

async function fetchGuildMemberFromQq(guildId, userId) {
  const accessToken = await getAccessToken();
  const response = await qqRequest(
    'GET',
    `${QQ_API_ROOT}/guilds/${encodeURIComponent(guildId)}/members/${encodeURIComponent(userId)}`,
    null,
    { Authorization: `QQBot ${accessToken}` }
  );
  const data = response?.data || {};
  if (!data.user?.id && !data.nick && !data.user?.username) {
    throw new Error('频道成员资料响应为空');
  }
  return data;
}

function isUnauthorizedGuild(code) {
  return Number(code) === 11264;
}

function logGuildApiFailure(log, title, details) {
  const payload = {
    guildId: details.guildId,
    userId: details.userId,
    code: details.code,
    reason: details.reason
  };
  if (isUnauthorizedGuild(details.code)) {
    log.debug(title, payload);
    return;
  }
  log.warn(title, payload);
}

function createGuildInfoService(options = {}) {
  const inFlight = new Map();
  const now = options.now || (() => new Date());
  const refreshMs = resolveRefreshMs(options.refreshMs);
  const memberRefreshMs = resolveMemberRefreshMs(
    options.memberRefreshMs ?? process.env.QQ_GUILD_MEMBER_INFO_REFRESH_MS
  );
  const collectionName = resolveCollectionName(options.collectionName);
  const memberCollectionName = resolveMemberCollectionName(options.memberCollectionName);
  const configured = options.isConfigured || isMongoConfigured;
  const getCollection = options.getCollection || (async () => {
    const db = await getDatabase();
    if (!db) return null;
    return db.collection(collectionName);
  });
  const getMemberCollection = options.getMemberCollection || (async () => {
    const db = await getDatabase();
    if (!db) return null;
    return db.collection(memberCollectionName);
  });
  const fetchGuild = options.fetchGuild || fetchGuildFromQq;
  const fetchGuildMember = options.fetchGuildMember || fetchGuildMemberFromQq;
  const log = options.logger || logger;

  async function runExclusive(key, task) {
    if (inFlight.has(key)) return inFlight.get(key);
    const pending = Promise.resolve().then(task);
    inFlight.set(key, pending);
    try {
      return await pending;
    } finally {
      inFlight.delete(key);
    }
  }

  async function getStoredGuildName(guildId) {
    const id = String(guildId || '').trim();
    if (!id || !configured()) return null;
    try {
      const collection = await getCollection();
      if (!collection) return null;
      const doc = await collection.findOne({ _id: id });
      const name = String(doc?.name || '').trim();
      return name || null;
    } catch (error) {
      log.warn('读取频道资料缓存失败', error);
      return null;
    }
  }

  async function getStoredMemberName(guildId, userId) {
    const guild = String(guildId || '').trim();
    const user = String(userId || '').trim();
    if (!guild || !user || !configured()) return null;
    try {
      const collection = await getMemberCollection();
      if (!collection) return null;
      const doc = await collection.findOne({ _id: memberDocId(guild, user) });
      const name = String(doc?.username || '').trim();
      return name || null;
    } catch (error) {
      log.warn('读取频道成员缓存失败', error);
      return null;
    }
  }

  async function getLogLabels(guildId, userId) {
    const [groupName, userName] = await Promise.all([
      getStoredGuildName(guildId),
      getStoredMemberName(guildId, userId)
    ]);
    return { groupName, userName };
  }

  async function touchMemberFromEvent(guildId, author, member, seenAt) {
    const userId = String(resolveGuildUserId(author) || '').trim();
    if (!userId) return;
    const collection = await getMemberCollection();
    if (!collection) return;
    const username = resolveGuildMemberName(author, member);
    const existing = await collection.findOne({ _id: memberDocId(guildId, userId) });
    const update = {
      guild_id: guildId,
      user_id: userId,
      last_seen_at: seenAt,
      updated_at: seenAt
    };
    if (username) update.username = username;
    if (username && !existing?.fetched_at) update.fetched_at = seenAt;
    await collection.updateOne(
      { _id: memberDocId(guildId, userId) },
      { $set: update },
      { upsert: true }
    );
  }

  async function refreshGuildIfNeeded(guildId, seenAt) {
    return runExclusive(`guild:${guildId}`, async () => {
      const collection = await getCollection();
      if (!collection) return null;
      const existing = await collection.findOne({ _id: guildId });
      if (!shouldRefreshGroupInfo(existing, seenAt, refreshMs)) {
        return existing;
      }
      try {
        const info = await fetchGuild(guildId);
        const savedAt = now();
        const saved = {
          guild_id: info.id || guildId,
          name: String(info.name || '').trim(),
          icon: info.icon || '',
          owner_id: info.owner_id || '',
          owner: Boolean(info.owner),
          member_count: Number.isFinite(Number(info.member_count)) ? Number(info.member_count) : null,
          max_members: Number.isFinite(Number(info.max_members)) ? Number(info.max_members) : null,
          description: info.description || '',
          joined_at: info.joined_at || null,
          fetched_at: savedAt,
          last_error: null,
          last_error_at: null,
          last_seen_at: savedAt,
          updated_at: savedAt
        };
        await collection.updateOne({ _id: guildId }, { $set: saved }, { upsert: true });
        log.debug('已更新频道资料', { guildId, name: saved.name });
        return { _id: guildId, ...saved };
      } catch (error) {
        const failedAt = now();
        const { code, message } = parseQqApiError(error);
        await collection.updateOne(
          { _id: guildId },
          {
            $set: {
              fetched_at: failedAt,
              last_error: `${code == null ? '' : code} ${message}`.trim(),
              last_error_at: failedAt,
              updated_at: failedAt
            }
          }
        );
        logGuildApiFailure(log, '获取频道资料失败', {
          guildId,
          code,
          reason: message
        });
        return existing;
      }
    });
  }

  async function refreshMemberIfNeeded(guildId, userId, seenAt) {
    return runExclusive(`member:${guildId}:${userId}`, async () => {
      const collection = await getMemberCollection();
      if (!collection) return null;
      const existing = await collection.findOne({ _id: memberDocId(guildId, userId) });
      if (!shouldRefreshMemberInfo(existing, seenAt, memberRefreshMs)) {
        return existing;
      }
      try {
        const info = await fetchGuildMember(guildId, userId);
        const savedAt = now();
        const user = info.user || {};
        const nick = String(info.nick || '').trim();
        const username = nick || String(user.username || '').trim();
        const saved = {
          guild_id: guildId,
          user_id: user.id || userId,
          username,
          nick,
          avatar: user.avatar || '',
          bot: Boolean(user.bot),
          roles: Array.isArray(info.roles) ? info.roles : [],
          joined_at: info.joined_at || null,
          union_openid: user.union_openid || '',
          fetched_at: savedAt,
          last_seen_at: savedAt,
          last_error: null,
          last_error_at: null,
          updated_at: savedAt
        };
        await collection.updateOne(
          { _id: memberDocId(guildId, userId) },
          { $set: saved },
          { upsert: true }
        );
        log.debug('已更新频道成员资料', { guildId, userId, username: saved.username });
        return { _id: memberDocId(guildId, userId), ...saved };
      } catch (error) {
        const failedAt = now();
        const { code, message } = parseQqApiError(error);
        await collection.updateOne(
          { _id: memberDocId(guildId, userId) },
          {
            $set: {
              guild_id: guildId,
              user_id: userId,
              fetched_at: failedAt,
              last_error: `${code == null ? '' : code} ${message}`.trim(),
              last_error_at: failedAt,
              updated_at: failedAt
            }
          },
          { upsert: true }
        );
        logGuildApiFailure(log, '获取频道成员失败', {
          guildId,
          userId,
          code,
          reason: message
        });
        return existing;
      }
    });
  }

  async function rememberGuild(guildId, extra = {}) {
    const id = String(guildId || '').trim();
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
      await collection.updateOne(
        { _id: id },
        {
          $set: {
            guild_id: id,
            last_seen_at: seenAt,
            updated_at: seenAt
          }
        },
        { upsert: true }
      );
      const userId = String(resolveGuildUserId(extra.author) || '').trim();
      if (userId) {
        await touchMemberFromEvent(id, extra.author, extra.member, seenAt);
      }
      if (extra.fetchProfile === false) {
        return collection.findOne({ _id: id });
      }
      await Promise.all([
        refreshGuildIfNeeded(id, seenAt),
        userId ? refreshMemberIfNeeded(id, userId, seenAt) : Promise.resolve()
      ]);
      return collection.findOne({ _id: id });
    } catch (error) {
      log.warn('同步频道资料失败', error);
      return null;
    }
  }

  return {
    rememberGuild,
    getStoredGuildName,
    getStoredMemberName,
    getLogLabels
  };
}

const defaultService = createGuildInfoService();

function observeGuild(eventData = {}, eventType = null) {
  const guildId = eventData.guild_id || null;
  if (!guildId) return;
  void defaultService.rememberGuild(guildId, {
    author: eventData.author,
    member: eventData.member,
    fetchProfile: eventType !== 'DIRECT_MESSAGE_CREATE'
  });
}

module.exports = {
  DEFAULT_COLLECTION,
  DEFAULT_MEMBER_COLLECTION,
  createGuildInfoService,
  fetchGuildFromQq,
  fetchGuildMemberFromQq,
  memberDocId,
  resolveGuildUserId,
  resolveGuildMemberName,
  rememberGuild: defaultService.rememberGuild,
  getStoredGuildName: defaultService.getStoredGuildName,
  getStoredMemberName: defaultService.getStoredMemberName,
  getLogLabels: defaultService.getLogLabels,
  observeGuild
};
