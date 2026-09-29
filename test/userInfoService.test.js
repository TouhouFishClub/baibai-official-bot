const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createUserInfoService,
  resolveUserOpenid,
  resolveUserName,
  readSourceName
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

function createService({ collection, now, findGroupMemberName } = {}) {
  return createUserInfoService({
    isConfigured: () => true,
    getCollection: async () => collection,
    findGroupMemberName: findGroupMemberName || (async () => null),
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

test('旧数据只有单一来源时才沿用 username', () => {
  assert.equal(
    readSourceName({ username: '私聊名', sources: ['c2c'] }, 'c2c'),
    '私聊名'
  );
  assert.equal(
    readSourceName({ username: '频道名', sources: ['direct'] }, 'direct'),
    '频道名'
  );
  assert.equal(
    readSourceName({
      username: '芙兰朵露·斯卡雷特',
      sources: ['direct', 'c2c']
    }, 'c2c'),
    null
  );
  assert.equal(
    readSourceName({
      username: '芙兰朵露·斯卡雷特',
      sources: ['direct', 'c2c']
    }, 'direct'),
    null
  );
});

test('收到 C2C 事件后写入 c2c_username，空昵称不覆盖', async () => {
  const collection = createMemoryCollection();
  const service = createService({ collection });
  const openid = 'F4AAE1C41F7D506F25F70BF1473DB1A8';

  await service.rememberUser({
    user_openid: openid,
    username: '群侧昵称'
  }, { source: 'c2c' });
  const stored = collection.docs.get(openid);
  assert.equal(stored.c2c_username, '群侧昵称');
  assert.equal(stored.direct_username, undefined);
  assert.equal(stored.last_source, 'c2c');
  assert.deepEqual(stored.sources, ['c2c']);
  assert.equal(await service.getStoredUserName(openid, 'c2c'), '群侧昵称');
  assert.deepEqual(await service.getLogLabels(openid, 'c2c'), { userName: '群侧昵称' });

  await service.rememberUser({
    user_openid: openid,
    username: ''
  }, { source: 'c2c' });
  assert.equal(await service.getStoredUserName(openid, 'c2c'), '群侧昵称');
});

test('频道私信写入 direct_username，不占用私聊昵称', async () => {
  const collection = createMemoryCollection();
  const service = createService({ collection });

  await service.rememberUser(
    { id: '2823701233424295228', username: '频道私信昵称' },
    { source: 'direct', guildId: 'dm-guild-1' }
  );
  const stored = collection.docs.get('2823701233424295228');
  assert.equal(stored.direct_username, '频道私信昵称');
  assert.equal(stored.c2c_username, undefined);
  assert.equal(stored.user_id, '2823701233424295228');
  assert.equal(stored.guild_id, 'dm-guild-1');
  assert.equal(await service.getStoredUserName('2823701233424295228', 'direct'), '频道私信昵称');
  assert.equal(await service.getStoredUserName('2823701233424295228', 'c2c'), null);
});

test('私聊没有昵称时回退到群成员缓存并写入 c2c_username', async () => {
  const collection = createMemoryCollection();
  const lookups = [];
  const openid = 'F4093B86120D0A670A1E74F0AB58219D';
  const service = createService({
    collection,
    findGroupMemberName: async (id) => {
      lookups.push(id);
      return id === openid ? '群里的雪' : null;
    }
  });

  assert.equal(await service.getStoredUserName(openid, 'c2c'), '群里的雪');
  assert.equal(await service.getStoredUserName(openid, 'direct'), null);

  await service.rememberUser({
    user_openid: openid,
    username: ''
  }, { source: 'c2c' });

  assert.equal(collection.docs.get(openid).c2c_username, '群里的雪');
  assert.ok(lookups.includes(openid));
});

test('同一人频道名和私聊名分开保存互不覆盖', async () => {
  const collection = createMemoryCollection();
  const openid = 'F4AAE1C41F7D506F25F70BF1473DB1A8';
  const service = createService({
    collection,
    findGroupMemberName: async (id) => (id === openid ? '群里的芙兰' : null)
  });

  await service.rememberUser({
    user_openid: openid,
    union_openid: openid,
    id: openid,
    username: '芙兰朵露·斯卡雷特'
  }, { source: 'direct', guildId: '16825186679161182546' });

  await service.rememberUser({
    user_openid: openid,
    union_openid: openid,
    id: openid,
    username: ''
  }, { source: 'c2c' });

  const stored = collection.docs.get(openid);
  assert.equal(stored.direct_username, '芙兰朵露·斯卡雷特');
  assert.equal(stored.c2c_username, '群里的芙兰');
  assert.deepEqual(stored.sources.sort(), ['c2c', 'direct']);
  assert.equal(await service.getStoredUserName(openid, 'direct'), '芙兰朵露·斯卡雷特');
  assert.equal(await service.getStoredUserName(openid, 'c2c'), '群里的芙兰');
});

test('混用旧 username 的记录不会把频道名当成私聊名', async () => {
  const openid = 'F4AAE1C41F7D506F25F70BF1473DB1A8';
  const collection = createMemoryCollection([{
    _id: openid,
    username: '芙兰朵露·斯卡雷特',
    sources: ['direct', 'c2c'],
    last_source: 'c2c'
  }]);
  const service = createService({
    collection,
    findGroupMemberName: async () => '群里的芙兰'
  });

  assert.equal(await service.getStoredUserName(openid, 'direct'), null);
  assert.equal(await service.getStoredUserName(openid, 'c2c'), '群里的芙兰');
});
