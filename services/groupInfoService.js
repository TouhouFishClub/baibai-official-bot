/**
 * 通过群 openid 拉取群资料、群成员并写入 db_bot
 * GET /v2/groups/{group_openid}/info（30 QPM）
 * GET /v2/groups/{group_openid}/members（60 QPM，每页最多 30 条）
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
const DEFAULT_MEMBERS_MAX_PAGES = 100;

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

function resolveMembersMaxPages(value = process.env.QQ_GROUP_MEMBERS_MAX_PAGES) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0
    ? Math.floor(parsed)
    : DEFAULT_MEMBERS_MAX_PAGES;
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
    _id: memberDocId(groupOpenid, memberOpenid),
    group_openid: groupOpenid,
    member_openid: memberOpenid,
    username: String(member.username || '').trim(),
    member_role: member.member_role || '',
    bot: Boolean(member.bot),
    joined_at: member.joined_at || null,
    union_openid: member.union_openid || '',
    fetched_at: savedAt,
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

async function fetchGroupMembersFromQq(groupOpenid, { maxPages = DEFAULT_MEMBERS_MAX_PAGES } = {}) {
  const accessToken = await getAccessToken();
  const members = [];
  let cursor = '';

  for (let page = 0; page < maxPages; page += 1) {
    const requestUrl = new URL(
      `${QQ_API_ROOT}/v2/groups/${encodeURIComponent(groupOpenid)}/members`
    );
    if (cursor) {
      requestUrl.searchParams.set('cursor', cursor);
    }
    const response = await qqRequest(
      'GET',
      requestUrl.toString(),
      null,
      {
        Authorization: `QQBot ${accessToken}`
      }
    );
    const data = response?.data || {};
    const batch = Array.isArray(data.members) ? data.members : [];
    members.push(...batch);
    cursor = String(data.next_cursor || '').trim();
    if (!cursor) break;
  }

  return members;
}

function createGroupInfoService(options = {}) {
  const inFlight = new Map();
  const now = options.now || (() => new Date());
  const refreshMs = resolveRefreshMs(options.refreshMs);
  const collectionName = resolveCollectionName(options.collectionName);
  const memberCollectionName = resolveMemberCollectionName(options.memberCollectionName);
  const membersMaxPages = resolveMembersMaxPages(options.membersMaxPages);
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
  const fetchGroupMembers = options.fetchGroupMembers || ((groupOpenid) => (
    fetchGroupMembersFromQq(groupOpenid, { maxPages: membersMaxPages })
  ));
  const log = options.logger || logger;

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

  async function getLogLabels(groupOpenid, memberOpenid) {
    const [groupName, userName] = await Promise.all([
      getStoredGroupName(groupOpenid),
      getStoredMemberName(groupOpenid, memberOpenid)
    ]);
    return { groupName, userName };
  }

  async function saveMembers(groupOpenid, members, savedAt) {
    const collection = await getMemberCollection();
    if (!collection) return 0;
    const records = (members || [])
      .map((member) => mapMemberRecord(groupOpenid, member, savedAt))
      .filter(Boolean);
    if (!records.length) return 0;
    if (typeof collection.bulkWrite === 'function') {
      await collection.bulkWrite(
        records.map((record) => ({
          updateOne: {
            filter: { _id: record._id },
            update: { $set: record },
            upsert: true
          }
        })),
        { ordered: false }
      );
    } else {
      for (const record of records) {
        await collection.updateOne(
          { _id: record._id },
          { $set: record },
          { upsert: true }
        );
      }
    }
    return records.length;
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

  async function rememberGroupOpenid(groupOpenid, extra = {}) {
    const id = String(groupOpenid || '').trim();
    if (!id) return null;
    if (!configured()) {
      warnMissingMongoOnce(log);
      return null;
    }
    if (inFlight.has(id)) {
      return inFlight.get(id);
    }

    const task = (async () => {
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
      await touchMemberFromAuthor(id, extra.author, seenAt);

      const existing = await collection.findOne({ _id: id });
      if (!shouldRefreshGroupInfo(existing, seenAt, refreshMs)) {
        return existing;
      }

      try {
        const info = await fetchGroupInfo(id);
        const savedAt = now();
        let members = [];
        let membersError = null;
        try {
          members = await fetchGroupMembers(id);
        } catch (memberError) {
          membersError = parseQqApiError(memberError);
          if (Number(membersError.code) === 11253) {
            log.warn('获取群成员无权限，该接口仅白名单机器人可用', { groupOpenid: id });
          } else {
            log.warn('获取群成员失败', {
              groupOpenid: id,
              code: membersError.code,
              message: membersError.message
            });
          }
        }

        const savedMemberCount = membersError ? 0 : await saveMembers(id, members, savedAt);
        const saved = {
          group_openid: info.group_openid || id,
          group_name: String(info.group_name || '').trim(),
          group_finger_memo: info.group_finger_memo || '',
          group_class_text: info.group_class_text || '',
          group_tags: Array.isArray(info.group_tags) ? info.group_tags : [],
          group_member_num: Number.isFinite(Number(info.group_member_num))
            ? Number(info.group_member_num)
            : null,
          members_fetched: savedMemberCount,
          members_last_error: membersError
            ? `${membersError.code == null ? '' : membersError.code} ${membersError.message}`.trim()
            : null,
          fetched_at: savedAt,
          last_error: null,
          last_error_at: null,
          last_seen_at: savedAt,
          updated_at: savedAt
        };
        await collection.updateOne({ _id: id }, { $set: saved }, { upsert: true });
        log.debug('已更新群资料', {
          groupOpenid: id,
          groupName: saved.group_name,
          membersFetched: savedMemberCount
        });
        return { _id: id, ...saved };
      } catch (error) {
        const failedAt = now();
        const { code, message } = parseQqApiError(error);
        await collection.updateOne(
          { _id: id },
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
          log.warn('获取群资料无权限，该接口仅白名单机器人可用', { groupOpenid: id });
        } else {
          log.warn('获取群资料失败', { groupOpenid: id, code, message });
        }
        return existing;
      }
    })();

    inFlight.set(id, task);
    try {
      return await task;
    } catch (error) {
      log.warn('同步群资料失败', error);
      return null;
    } finally {
      inFlight.delete(id);
    }
  }

  return {
    rememberGroupOpenid,
    getStoredGroupName,
    getStoredGroupDoc,
    getStoredMemberName,
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
  fetchGroupMembersFromQq,
  parseQqApiError,
  memberDocId,
  resolveMemberOpenid,
  resolveMemberName,
  rememberGroupOpenid: defaultService.rememberGroupOpenid,
  getStoredGroupName: defaultService.getStoredGroupName,
  getStoredMemberName: defaultService.getStoredMemberName,
  getLogLabels: defaultService.getLogLabels,
  observeGroupOpenid
};
