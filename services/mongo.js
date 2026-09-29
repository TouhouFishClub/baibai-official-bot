/**
 * 机器人本地 MongoDB 连接（db_bot）
 * 未配置 MONGODB_URI 时不连接，调用方自行降级。
 */

const { MongoClient } = require('mongodb');

let clientPromise = null;
let warnedMissingUri = false;

function getMongoConfig() {
  return {
    uri: String(process.env.MONGODB_URI || '').trim(),
    database: String(process.env.MONGODB_DATABASE || 'db_bot').trim() || 'db_bot'
  };
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
  return client.db(getMongoConfig().database);
}

async function connectMongoIfConfigured() {
  if (!isMongoConfigured()) return false;
  const db = await getDatabase();
  if (!db) return false;
  await db.command({ ping: 1 });
  return true;
}

async function closeMongo() {
  if (!clientPromise) return;
  const client = await clientPromise;
  clientPromise = null;
  await client.close();
}

module.exports = {
  getMongoConfig,
  isMongoConfigured,
  warnMissingMongoOnce,
  getDatabase,
  connectMongoIfConfigured,
  closeMongo
};
