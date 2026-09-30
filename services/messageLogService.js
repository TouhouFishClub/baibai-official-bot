/**
 * 收发消息写入 db_bot，供后续群分析使用。
 * 失败不影响回复；未配置 Mongo 时跳过。
 */

const logger = require('../utils/logger');
const {
  getDatabase,
  isMongoConfigured,
  warnMissingMongoOnce
} = require('./mongo');

const DEFAULT_COLLECTION = 'qq_messages';
const MAX_CONTENT_LENGTH = 16_000;
const SELF_USER_ID = '10000';
const SELF_USER_NAME = '百百';
const SEND_EVENT_TYPE = 'SEND_MESSAGE';
const CHANNEL_TYPES = {
  群: 'group',
  私聊: 'c2c',
  频道: 'channel',
  频道私信: 'dm',
  group: 'group',
  c2c: 'c2c',
  channel: 'channel',
  dm: 'dm'
};
const ALLOWED_CHANNEL_TYPES = new Set(['c2c', 'group', 'channel', 'dm']);

function resolveCollectionName(value = process.env.MONGODB_MESSAGE_COLLECTION) {
  return String(value || DEFAULT_COLLECTION).trim() || DEFAULT_COLLECTION;
}

function resolveChannelType(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  const mapped = CHANNEL_TYPES[raw] || CHANNEL_TYPES[raw.toLowerCase()];
  if (ALLOWED_CHANNEL_TYPES.has(mapped)) return mapped;
  return null;
}

function trimOrNull(value) {
  const text = String(value ?? '').trim();
  if (!text || text === '-') return null;
  return text;
}

function clampContent(value) {
  const text = String(value ?? '');
  return text.length > MAX_CONTENT_LENGTH
    ? `${text.slice(0, MAX_CONTENT_LENGTH)}…`
    : text;
}

function resolveTime(payload, now) {
  const raw = payload.timestamp ?? payload.ts;
  if (raw instanceof Date && !Number.isNaN(raw.getTime())) return raw;
  if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) {
    return new Date(raw < 1e12 ? raw * 1000 : raw);
  }
  if (typeof raw === 'string' && raw.trim()) {
    const numeric = Number(raw);
    if (Number.isFinite(numeric) && numeric > 0) {
      return new Date(numeric < 1e12 ? numeric * 1000 : numeric);
    }
    const parsed = new Date(raw);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return now();
}

function buildMessageDoc(payload = {}, now = () => new Date()) {
  const time = resolveTime(payload, now);
  const isSelf = Boolean(payload.isSelf);
  const doc = {
    type: resolveChannelType(payload.type),
    eventType: trimOrNull(payload.eventType) || (isSelf ? SEND_EVENT_TYPE : null),
    sessionName: trimOrNull(payload.groupName || payload.sessionName),
    sessionId: trimOrNull(payload.groupId || payload.sessionId),
    userName: isSelf ? SELF_USER_NAME : trimOrNull(payload.userName),
    userId: isSelf ? SELF_USER_ID : trimOrNull(payload.userId),
    content: clampContent(payload.content),
    isSelf,
    isBot: isSelf || Boolean(payload.isBot),
    time,
    ts: time.getTime()
  };
  const messageId = trimOrNull(payload.messageId);
  if (messageId) doc.messageId = messageId;
  return doc;
}

function isDuplicateKeyError(error) {
  return Number(error?.code) === 11000;
}

function createMessageLogService(options = {}) {
  const now = options.now || (() => new Date());
  const collectionName = resolveCollectionName(options.collectionName);
  const configured = options.isConfigured || isMongoConfigured;
  const getCollection = options.getCollection || (async () => {
    const db = await getDatabase();
    if (!db) return null;
    return db.collection(collectionName);
  });
  const log = options.logger || logger;

  async function persist(payload) {
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
      const doc = buildMessageDoc(payload, now);
      await collection.insertOne(doc);
      return doc;
    } catch (error) {
      if (isDuplicateKeyError(error)) return null;
      log.warn('保存消息记录失败', error);
      return null;
    }
  }

  function recordMessage(payload) {
    return persist(payload);
  }

  function logIncoming(payload = {}) {
    log.message(payload);
    return persist({
      ...payload,
      isSelf: false,
      isBot: Boolean(payload.isBot)
    });
  }

  function logOutgoing(payload = {}) {
    log.reply(payload);
    return persist({
      ...payload,
      eventType: SEND_EVENT_TYPE,
      userId: SELF_USER_ID,
      userName: SELF_USER_NAME,
      isSelf: true,
      isBot: true
    });
  }

  return {
    persist,
    recordMessage,
    logIncoming,
    logOutgoing,
    buildMessageDoc: (payload) => buildMessageDoc(payload, now)
  };
}

const defaultService = createMessageLogService();

module.exports = {
  DEFAULT_COLLECTION,
  MAX_CONTENT_LENGTH,
  SELF_USER_ID,
  SELF_USER_NAME,
  CHANNEL_TYPES,
  ALLOWED_CHANNEL_TYPES,
  SEND_EVENT_TYPE,
  createMessageLogService,
  buildMessageDoc,
  resolveChannelType,
  logIncoming: defaultService.logIncoming,
  logOutgoing: defaultService.logOutgoing,
  recordMessage: defaultService.recordMessage
};
