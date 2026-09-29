/**
 * 通过群 openid 拉取群资料、指定成员并写入 db_bot
 * GET /v2/groups/{group_openid}/info（30 QPM）
 * GET /v2/groups/{group_openid}/members/{member_openid}（30 QPM）
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

const DEFAULT_COLLECTION = 'qq_groups';
const DEFAULT_MEMBER_COLLECTION = 'qq_group_members';
const DEFAULT_REFRESH_MS = 6 * 60 * 60 * 1000;

function resolveRefreshMs(value = process.env.QQ_GROUP_INFO_REFRESH_MS) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_REFRESH_MS;
}

function resolveCollectionName(value = process.env.MONGODB_GROUP_COLLECTION) {
  return String(value || DEFAULT_COLLECTION).trim() || DEFAULT_COLLECTION;
}

function resolveMemberCollectionName(value = process.env.MONGODB_GROUP_MEMBER_COLLECTION) {
  return String(value || DEFAULT_MEMBER_COLLECTION).trim() || DEFAULT_MEMBER_COLLECTION;
}

function memberDocId(groupOpenid, memberOpenid) {
  return `${groupOpenid}:${memberOpenid}`;
}

function resolveMemberOpenid(author = {}) {
  return author.member_openid || author.user_openid || author.id || null;
}

function resolveMemberName(author = {}) {
  const name = author.username || author.member_name || author.nick || author.nickname;
  const trimmed = String(name || '').trim();
  return trimmed || null;
}

function parseQqApiError(error) {
  const data = error?.response?.data;
  return {
    code: data?.code ?? data?.err_code ?? error?.response?.status,
    message: data?.message || data?.msg || error?.message || '未知错误'
  };
}

function shouldRefreshGroupInfo(doc, now = new Date(), refreshMs = DEFAULT_REFRESH_MS) {
  if (!doc) return true;
  const fetchedAt = doc.fetched_at ? new Date(doc.fetched_at).getTime() : 0;
  if (fetchedAt && now.getTime() - fetchedAt < refreshMs) {
    return false;
  }
  return true;
}

function mapMemberRecord(groupOpenid, member, savedAt) {
  const memberOpenid = String(member?.member_openid || '').trim();
  if (!memberOpenid) return null;
  return {
    group_openid: groupOpenid,
    member_openid: memberOpenid,
    username: String(member.username || '').trim(),
    member_role: member.member_role || '',
    bot: Boolean(member.bot),
    joined_at: member.joined_at || null,
    union_openid: member.union_openid || '',
    fetched_at: savedAt,
    last_error: null,
    last_error_at: null,
    last_seen_at: savedAt,
    updated_at: savedAt
  };
}

async function fetchGroupInfoFromQq(groupOpenid) {
  const accessToken = await getAccessToken();
  const requestUrl = `${QQ_API_ROOT}/v2/groups/${encodeURIComponent(groupOpenid)}/info`;
  const response = await qqRequest(
    'GET',
    requestUrl,
    null,
    {
      Authorization: `QQBot ${accessToken}`
    }
  );
  const data = response?.data || {};
  if (!data.group_openid && !data.group_name) {
    throw new Error('群资料响应为空');
  }
  return data;
}

async function fetchGroupMemberFromQq(groupOpenid, memberOpenid) {
  const accessToken = await getAccessToken();
  const response = await qqRequest(
    'GET',
    `${QQ_API_ROOT}/v2/groups/${encodeURIComponent(groupOpenid)}/members/${encodeURIComponent(memberOpenid)}`,
    null,
    {
      Authorization: `QQBot ${accessToken}`
    }
  );
  const data = response?.data || {};
  if (!data.member_openid && !data.username) {
    throw new Error('群成员资料响应为空');
  }
  return data;
}

function createGroupInfoService(options = {}) {
  const inFlight = new Map();
  const now = options.now || (() => new Date());
  const refreshMs = resolveRefreshMs(options.refreshMs);
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
  const fetchGroupInfo = options.fetchGroupInfo || fetchGroupInfoFromQq;
  const fetchGroupMember = options.fetchGroupMember || fetchGroupMemberFromQq;
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

  async function getStoredGroupDoc(groupOpenid) {
    const id = String(groupOpenid || '').trim();
    if (!id || !configured()) return null;
    try {
      const collection = await getCollection();
      if (!collection) return null;
      return collection.findOne({ _id: id });
    } catch (error) {
      log.warn('读取群资料缓存失败', error);
      return null;
    }
  }

  async function getStoredGroupName(groupOpenid) {
    const doc = await getStoredGroupDoc(groupOpenid);
    const name = String(doc?.group_name || '').trim();
    return name || null;
  }

  async function getStoredMemberName(groupOpenid, memberOpenid) {
    const groupId = String(groupOpenid || '').trim();
    const memberId = String(memberOpenid || '').trim();
    if (!groupId || !memberId || !configured()) return null;
    try {
      const collection = await getMemberCollection();
      if (!collection) return null;
      const doc = await collection.findOne({ _id: memberDocId(groupId, memberId) });
      const name = String(doc?.username || '').trim();
      return name || null;
    } catch (error) {
      log.warn('读取群成员缓存失败', error);
      return null;
    }
  }

  async function findMemberNameByOpenid(memberOpenid) {
    const id = String(memberOpenid || '').trim();
    if (!id || !configured()) return null;
    try {
      const collection = await getMemberCollection();
      if (!collection) return null;
      const doc = await collection.findOne(
        { member_openid: id, username: { $nin: [null, ''] } },
        { sort: { last_seen_at: -1 } }
      );
      const name = String(doc?.username || '').trim();
      return name || null;
    } catch (error) {
      log.warn('按 openid 查找群成员昵称失败', error);
      return null;
    }
  }

  async function getLogLabels(groupOpenid, memberOpenid) {
    const [groupName, userName] = await Promise.all([
      getStoredGroupName(groupOpenid),
      getStoredMemberName(groupOpenid, memberOpenid)
    ]);
    return { groupName, userName };
  }

  async function touchMemberFromAuthor(groupOpenid, author, seenAt) {
    const memberOpenid = String(resolveMemberOpenid(author) || '').trim();
    if (!memberOpenid) return;
    const collection = await getMemberCollection();
    if (!collection) return;
    const username = resolveMemberName(author);
    const update = {
      group_openid: groupOpenid,
      member_openid: memberOpenid,
      last_seen_at: seenAt,
      updated_at: seenAt
    };
    if (username) update.username = username;
    await collection.updateOne(
      { _id: memberDocId(groupOpenid, memberOpenid) },
      { $set: update },
      { upsert: true }
    );
  }

  async function refreshGroupIfNeeded(groupOpenid, seenAt) {
    return runExclusive(`group:${groupOpenid}`, async () => {
      const collection = await getCollection();
      if (!collection) return null;
      const existing = await collection.findOne({ _id: groupOpenid });
      if (!shouldRefreshGroupInfo(existing, seenAt, refreshMs)) {
        return existing;
      }
      try {
        const info = await fetchGroupInfo(groupOpenid);
        const savedAt = now();
        const saved = {
          group_openid: info.group_openid || groupOpenid,
          group_name: String(info.group_name || '').trim(),
          group_finger_memo: info.group_finger_memo || '',
          group_class_text: info.group_class_text || '',
          group_tags: Array.isArray(info.group_tags) ? info.group_tags : [],
          group_member_num: Number.isFinite(Number(info.group_member_num))
            ? Number(info.group_member_num)
            : null,
          fetched_at: savedAt,
          last_error: null,
          last_error_at: null,
          last_seen_at: savedAt,
          updated_at: savedAt
        };
        await collection.updateOne({ _id: groupOpenid }, { $set: saved }, { upsert: true });
        log.debug('已更新群资料', {
          groupOpenid,
          groupName: saved.group_name
        });
        return { _id: groupOpenid, ...saved };
      } catch (error) {
        const failedAt = now();
        const { code, message } = parseQqApiError(error);
        await collection.updateOne(
          { _id: groupOpenid },
          {
            $set: {
              fetched_at: failedAt,
              last_error: `${code == null ? '' : code} ${message}`.trim(),
              last_error_at: failedAt,
              updated_at: failedAt
            }
          }
        );
        if (Number(code) === 11253) {
          log.warn('获取群资料无权限，该接口仅白名单机器人可用', { groupOpenid });
        } else {
          log.warn('获取群资料失败', { groupOpenid, code, message });
        }
        return existing;
      }
    });
  }

  async function refreshMemberIfNeeded(groupOpenid, memberOpenid, seenAt) {
    return runExclusive(`member:${groupOpenid}:${memberOpenid}`, async () => {
      const collection = await getMemberCollection();
      if (!collection) return null;
      const existing = await collection.findOne({ _id: memberDocId(groupOpenid, memberOpenid) });
      if (!shouldRefreshGroupInfo(existing, seenAt, refreshMs)) {
        return existing;
      }
      try {
        const info = await fetchGroupMember(groupOpenid, memberOpenid);
        const savedAt = now();
        const saved = mapMemberRecord(groupOpenid, {
          ...info,
          member_openid: info.member_openid || memberOpenid
        }, savedAt);
        if (!saved) return existing;
        await collection.updateOne(
          { _id: memberDocId(groupOpenid, memberOpenid) },
          { $set: saved },
          { upsert: true }
        );
        log.debug('已更新群成员资料', {
          groupOpenid,
          memberOpenid,
          username: saved.username
        });
        return { _id: memberDocId(groupOpenid, memberOpenid), ...saved };
      } catch (error) {
        const failedAt = now();
        const { code, message } = parseQqApiError(error);
        await collection.updateOne(
          { _id: memberDocId(groupOpenid, memberOpenid) },
          {
            $set: {
              group_openid: groupOpenid,
              member_openid: memberOpenid,
              fetched_at: failedAt,
              last_error: `${code == null ? '' : code} ${message}`.trim(),
              last_error_at: failedAt,
              updated_at: failedAt
            }
          },
          { upsert: true }
        );
        if (Number(code) === 11253) {
          log.warn('获取群成员无权限，该接口仅白名单机器人可用', { groupOpenid, memberOpenid });
        } else {
          log.warn('获取群成员失败', { groupOpenid, memberOpenid, code, message });
        }
        return existing;
      }
    });
  }

  async function rememberGroupOpenid(groupOpenid, extra = {}) {
    const id = String(groupOpenid || '').trim();
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
            group_openid: id,
            last_seen_at: seenAt,
            updated_at: seenAt
          }
        },
        { upsert: true }
      );
      const memberOpenid = String(resolveMemberOpenid(extra.author) || '').trim();
      if (memberOpenid) {
        await touchMemberFromAuthor(id, extra.author, seenAt);
      }
      await Promise.all([
        refreshGroupIfNeeded(id, seenAt),
        memberOpenid ? refreshMemberIfNeeded(id, memberOpenid, seenAt) : Promise.resolve()
      ]);
      return collection.findOne({ _id: id });
    } catch (error) {
      log.warn('同步群资料失败', error);
      return null;
    }
  }

  return {
    rememberGroupOpenid,
    getStoredGroupName,
    getStoredGroupDoc,
    getStoredMemberName,
    findMemberNameByOpenid,
    getLogLabels
  };
}

const defaultService = createGroupInfoService();

function observeGroupOpenid(eventData = {}) {
  const groupOpenid = eventData.group_openid || eventData.group_id || null;
  if (!groupOpenid) return;
  void defaultService.rememberGroupOpenid(groupOpenid, { author: eventData.author });
}

module.exports = {
  DEFAULT_COLLECTION,
  DEFAULT_MEMBER_COLLECTION,
  DEFAULT_REFRESH_MS,
  createGroupInfoService,
  shouldRefreshGroupInfo,
  fetchGroupInfoFromQq,
  fetchGroupMemberFromQq,
  parseQqApiError,
  memberDocId,
  resolveMemberOpenid,
  resolveMemberName,
  rememberGroupOpenid: defaultService.rememberGroupOpenid,
  getStoredGroupName: defaultService.getStoredGroupName,
  getStoredMemberName: defaultService.getStoredMemberName,
  findMemberNameByOpenid: defaultService.findMemberNameByOpenid,
  getLogLabels: defaultService.getLogLabels,
  observeGroupOpenid
};
