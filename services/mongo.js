/**
 * 机器人本地 MongoDB 连接（db_bot）
 * 未配置 MONGODB_URI 时不连接，调用方自行降级。
 */

const { MongoClient } = require('mongodb');

let clientPromise = null;
let indexesPromise = null;
let warnedMissingUri = false;

function getMongoConfig() {
  return {
    uri: String(process.env.MONGODB_URI || '').trim(),
    database: String(process.env.MONGODB_DATABASE || 'db_bot').trim() || 'db_bot'
  };
}

function collectionName(envKey, fallback) {
  return String(process.env[envKey] || fallback).trim() || fallback;
}

function resolveIndexSpecs() {
  const groupMembers = collectionName('MONGODB_GROUP_MEMBER_COLLECTION', 'qq_group_members');
  const users = collectionName('MONGODB_USER_COLLECTION', 'qq_users');
  return [
    {
      collection: groupMembers,
      keys: { member_openid: 1, last_seen_at: -1 },
      options: { name: 'member_openid_last_seen' }
    },
    {
      collection: users,
      keys: { user_id: 1 },
      options: { name: 'user_id', sparse: true }
    },
    {
      collection: users,
      keys: { union_openid: 1 },
      options: { name: 'union_openid', sparse: true }
    }
  ];
}

function isMongoConfigured() {
  return Boolean(getMongoConfig().uri);
}

function warnMissingMongoOnce(logger) {
  if (warnedMissingUri || isMongoConfigured()) return;
  warnedMissingUri = true;
  if (logger && typeof logger.warn === 'function') {
    logger.warn('未配置 MONGODB_URI，跳过群资料入库');
  }
}

async function ensureBotIndexes(db, log) {
  if (!db) return [];
  const created = [];
  for (const spec of resolveIndexSpecs()) {
    try {
      await db.collection(spec.collection).createIndex(spec.keys, spec.options);
      created.push(spec.options.name);
    } catch (error) {
      if (log && typeof log.warn === 'function') {
        log.warn('创建 Mongo 索引失败', {
          collection: spec.collection,
          index: spec.options.name,
          reason: error.message
        });
      }
    }
  }
  return created;
}

function scheduleEnsureIndexes(db) {
  if (indexesPromise) return indexesPromise;
  const log = require('../utils/logger');
  indexesPromise = ensureBotIndexes(db, log).catch((error) => {
    indexesPromise = null;
    log.warn('确保 Mongo 索引失败', error);
    return [];
  });
  return indexesPromise;
}

async function getMongoClient() {
  const { uri } = getMongoConfig();
  if (!uri) return null;
  if (!clientPromise) {
    const client = new MongoClient(uri, {
      maxPoolSize: 10,
      serverSelectionTimeoutMS: 5000
    });
    clientPromise = client.connect().catch((error) => {
      clientPromise = null;
      throw error;
    });
  }
  return clientPromise;
}

async function getDatabase() {
  const client = await getMongoClient();
  if (!client) return null;
  const db = client.db(getMongoConfig().database);
  scheduleEnsureIndexes(db);
  return db;
}

async function connectMongoIfConfigured() {
  if (!isMongoConfigured()) return false;
  const db = await getDatabase();
  if (!db) return false;
  await db.command({ ping: 1 });
  await scheduleEnsureIndexes(db);
  return true;
}

async function closeMongo() {
  indexesPromise = null;
  if (!clientPromise) return;
  const client = await clientPromise;
  clientPromise = null;
  await client.close();
}

module.exports = {
  getMongoConfig,
  isMongoConfigured,
  warnMissingMongoOnce,
  resolveIndexSpecs,
  ensureBotIndexes,
  getDatabase,
  connectMongoIfConfigured,
  closeMongo
};
