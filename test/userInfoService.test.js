const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createUserInfoService,
  resolveUserOpenid,
  resolveUserName
} = require('../services/userInfoService');

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
      if (update.$addToSet) {
        for (const [key, value] of Object.entries(update.$addToSet)) {
          const current = Array.isArray(next[key]) ? next[key] : [];
          next[key] = current.includes(value) ? current : [...current, value];
        }
      }
      docs.set(filter._id, next);
      return { matchedCount: 1, modifiedCount: 1, upsertedCount: 1 };
    }
  };
}

function createService({ collection, now } = {}) {
  return createUserInfoService({
    isConfigured: () => true,
    getCollection: async () => collection,
    now: now || (() => new Date('2026-09-30T00:00:00+08:00')),
    logger: { warn() {}, debug() {} }
  });
}

test('C2C 优先用 user_openid，昵称取 author.username', () => {
  assert.equal(
    resolveUserOpenid({ user_openid: 'openid-1', id: 'id-1' }),
    'openid-1'
  );
  assert.equal(
    resolveUserName({ username: '芙兰朵露', nickname: '忽略' }),
    '芙兰朵露'
  );
  assert.equal(resolveUserName({ nickname: '别名' }), '别名');
  assert.equal(resolveUserName({}, { nickname: '事件昵称' }), '事件昵称');
  assert.equal(resolveUserName({ username: '  ' }), null);
});

test('收到 C2C 事件后缓存昵称，空昵称不覆盖已有名字', async () => {
  const collection = createMemoryCollection();
  const service = createService({ collection });

  await service.rememberUser({
    user_openid: 'F4AAE1C41F7D506F25F70BF1473DB1A8',
    username: '芙兰朵露·斯卡雷特'
  }, { source: 'c2c' });
  const stored = collection.docs.get('F4AAE1C41F7D506F25F70BF1473DB1A8');
  assert.equal(stored.username, '芙兰朵露·斯卡雷特');
  assert.equal(stored.last_source, 'c2c');
  assert.deepEqual(stored.sources, ['c2c']);
  assert.equal(
    await service.getStoredUserName('F4AAE1C41F7D506F25F70BF1473DB1A8'),
    '芙兰朵露·斯卡雷特'
  );
  assert.deepEqual(
    await service.getLogLabels('F4AAE1C41F7D506F25F70BF1473DB1A8'),
    { userName: '芙兰朵露·斯卡雷特' }
  );

  await service.rememberUser({
    user_openid: 'F4AAE1C41F7D506F25F70BF1473DB1A8',
    username: ''
  }, { source: 'c2c' });
  assert.equal(
    await service.getStoredUserName('F4AAE1C41F7D506F25F70BF1473DB1A8'),
    '芙兰朵露·斯卡雷特'
  );
});

test('频道私信按用户 id 写入同一张昵称对应表', async () => {
  const collection = createMemoryCollection();
  const service = createService({ collection });

  await service.rememberUser(
    { id: '2823701233424295228', username: '频道私信昵称' },
    { source: 'direct', guildId: 'dm-guild-1' }
  );
  const stored = collection.docs.get('2823701233424295228');
  assert.equal(stored.username, '频道私信昵称');
  assert.equal(stored.user_id, '2823701233424295228');
  assert.equal(stored.guild_id, 'dm-guild-1');
  assert.equal(stored.last_source, 'direct');
  assert.deepEqual(stored.sources, ['direct']);
  assert.equal(await service.getStoredUserName('2823701233424295228'), '频道私信昵称');
});
