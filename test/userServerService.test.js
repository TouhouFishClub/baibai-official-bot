const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createUserServerService,
  splitServerPrefix
} = require('../services/userServerService');

function createMemoryCollection(initialDocs = []) {
  const docs = new Map(initialDocs.map((doc) => [doc._id, { ...doc }]));
  return {
    docs,
    async findOne(query) {
      return docs.has(query._id) ? { ...docs.get(query._id) } : null;
    },
    async updateOne(filter, update, options = {}) {
      let doc = docs.get(filter._id);
      if (!doc) {
        if (!options.upsert) {
          return { matchedCount: 0, modifiedCount: 0, upsertedCount: 0 };
        }
        doc = { _id: filter._id };
      }
      const next = { ...doc, ...(update.$set || {}) };
      docs.set(filter._id, next);
      return { matchedCount: 1, modifiedCount: 1, upsertedCount: 1 };
    }
  };
}

function createService({ collection, configured = true } = {}) {
  return createUserServerService({
    isConfigured: () => configured,
    getCollection: async () => collection,
    now: () => new Date('2026-09-30T01:00:00+08:00'),
    logger: { warn() {} }
  });
}

test('服务器前缀与旧版一致', () => {
  assert.deepEqual(splitServerPrefix('猫服 稀有卷'), {
    server: 'ylx',
    filter: '稀有卷'
  });
  assert.deepEqual(splitServerPrefix('伊鲁夏道具'), {
    server: 'ylx',
    filter: '道具'
  });
  assert.deepEqual(splitServerPrefix('ylx 芙兰'), {
    server: 'ylx',
    filter: '芙兰'
  });
  assert.deepEqual(splitServerPrefix('亚特道具-角色'), {
    server: 'yate',
    filter: '道具-角色'
  });
  assert.deepEqual(splitServerPrefix('yt铠甲'), {
    server: 'yate',
    filter: '铠甲'
  });
  assert.deepEqual(splitServerPrefix('稀有卷'), {
    server: null,
    filter: '稀有卷'
  });
});

test('带服务器前缀时按 openid 写入本地库并去掉前缀', async () => {
  const collection = createMemoryCollection();
  const service = createService({ collection });

  const resolved = await service.resolveAndRemember('openid-a', '亚特 稀有卷');
  assert.deepEqual(resolved, { server: 'yate', filter: '稀有卷' });
  assert.equal(collection.docs.get('openid-a').sv, 'yate');
  assert.equal(collection.docs.get('openid-a').user_openid, 'openid-a');
});

test('没有前缀时沿用已保存的服务器', async () => {
  const collection = createMemoryCollection([
    { _id: 'openid-b', sv: 'yate' }
  ]);
  const service = createService({ collection });

  const resolved = await service.resolveAndRemember('openid-b', '铠甲');
  assert.deepEqual(resolved, { server: 'yate', filter: '铠甲' });
  assert.equal(collection.docs.get('openid-b').sv, 'yate');
});

test('首次使用默认猫服并写入 openid', async () => {
  const collection = createMemoryCollection();
  const service = createService({ collection });

  const resolved = await service.resolveAndRemember('openid-c', '');
  assert.deepEqual(resolved, { server: 'ylx', filter: '' });
  assert.equal(collection.docs.get('openid-c').sv, 'ylx');
});

test('未配置数据库时仍解析前缀，但不写入', async () => {
  const collection = createMemoryCollection();
  const service = createService({ collection, configured: false });

  const explicit = await service.resolveAndRemember('openid-d', '亚特 道具');
  const fallback = await service.resolveAndRemember('openid-d', '道具');
  assert.deepEqual(explicit, { server: 'yate', filter: '道具' });
  assert.deepEqual(fallback, { server: 'ylx', filter: '道具' });
  assert.equal(collection.docs.size, 0);
});

test('没有 openid 时不写入', async () => {
  const collection = createMemoryCollection();
  const service = createService({ collection });

  const resolved = await service.resolveAndRemember('', '亚特 道具');
  assert.deepEqual(resolved, { server: 'yate', filter: '道具' });
  assert.equal(collection.docs.size, 0);
});
