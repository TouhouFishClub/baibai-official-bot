/**
 * mbtv / mbcd / mbzz 记住用户所选洛奇服务器。
 * 旧版用 QQ 号写 cl_mabinogi_user_server；官方机器人改为用 openid。
 */

const logger = require('../utils/logger');
const {
  getDatabase,
  isMongoConfigured,
  warnMissingMongoOnce
} = require('./mongo');

const DEFAULT_COLLECTION = 'cl_mabinogi_user_server';
const DEFAULT_SERVER = 'ylx';
const ALLOWED_SERVERS = new Set(['ylx', 'yate']);
const SERVER_ALIASES = {
  ylx: 'ylx',
  伊鲁夏: 'ylx',
  猫服: 'ylx',
  yt: 'yate',
  亚特: 'yate'
};

function resolveCollectionName(value = process.env.MONGODB_USER_SERVER_COLLECTION) {
  return String(value || DEFAULT_COLLECTION).trim() || DEFAULT_COLLECTION;
}

function splitServerPrefix(content) {
  const input = String(content || '').trim();
  const found = Object.entries(SERVER_ALIASES).find(([alias]) => input.startsWith(alias));
  return found
    ? { server: found[1], filter: input.slice(found[0].length).trim() }
    : { server: null, filter: input };
}

function createUserServerService(options = {}) {
  const now = options.now || (() => new Date());
  const collectionName = resolveCollectionName(options.collectionName);
  const configured = options.isConfigured || isMongoConfigured;
  const getCollection = options.getCollection || (async () => {
    const db = await getDatabase();
    if (!db) return null;
    return db.collection(collectionName);
  });
  const log = options.logger || logger;

  async function saveServer(userOpenid, server) {
    const id = String(userOpenid || '').trim();
    if (!id || !ALLOWED_SERVERS.has(server)) return null;
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
            sv: server,
            user_openid: id,
            updated_at: seenAt
          }
        },
        { upsert: true }
      );
      return { _id: id, sv: server };
    } catch (error) {
      log.warn('保存用户服务器失败', error);
      return null;
    }
  }

  async function findServer(userOpenid) {
    const id = String(userOpenid || '').trim();
    if (!id || !configured()) return null;
    try {
      const collection = await getCollection();
      if (!collection) return null;
      const doc = await collection.findOne({ _id: id }, { projection: { sv: 1 } });
      return ALLOWED_SERVERS.has(doc?.sv) ? doc.sv : null;
    } catch (error) {
      log.warn('读取用户服务器失败', error);
      return null;
    }
  }

  async function resolveAndRemember(userOpenid, content) {
    const parsed = splitServerPrefix(content);
    const id = String(userOpenid || '').trim();
    if (parsed.server) {
      await saveServer(id, parsed.server);
      return { server: parsed.server, filter: parsed.filter };
    }

    const saved = await findServer(id);
    const server = saved || DEFAULT_SERVER;
    if (id && !saved) await saveServer(id, DEFAULT_SERVER);
    return { server, filter: parsed.filter };
  }

  return {
    findServer,
    saveServer,
    resolveAndRemember
  };
}

const defaultService = createUserServerService();

module.exports = {
  ALLOWED_SERVERS,
  DEFAULT_COLLECTION,
  DEFAULT_SERVER,
  SERVER_ALIASES,
  createUserServerService,
  splitServerPrefix,
  resolveAndRememberUserServer: defaultService.resolveAndRemember,
  findUserServer: defaultService.findServer,
  saveUserServer: defaultService.saveServer
};
