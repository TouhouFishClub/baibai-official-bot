const test = require('node:test');
const assert = require('node:assert/strict');
const { createGuildInfoService } = require('../services/guildInfoService');

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
      docs.set(filter._id, { ...doc, ...(update.$set || {}) });
      return { matchedCount: 1, modifiedCount: 1 };
    }
  };
}

function createService({
  collection,
  memberCollection,
  fetchGuild,
  fetchGuildMember,
  refreshMs = 60 * 60 * 1000,
  now
}) {
  return createGuildInfoService({
    isConfigured: () => true,
    getCollection: async () => collection,
    getMemberCollection: async () => memberCollection,
    fetchGuild,
    fetchGuildMember: fetchGuildMember || (async () => ({ user: { id: 'u1', username: '忽略' } })),
    refreshMs,
    now: now || (() => new Date('2026-09-30T00:00:00+08:00')),
    logger: { warn() {}, debug() {} }
  });
}

test('收到 guild_id 后拉取频道名和该成员并入库', async () => {
  const collection = createMemoryCollection();
  const memberCollection = createMemoryCollection();
  const guildCalls = [];
  const memberCalls = [];
  const service = createService({
    collection,
    memberCollection,
    fetchGuild: async (guildId) => {
      guildCalls.push(guildId);
      return {
        id: guildId,
        name: '技术交流频道',
        member_count: 100
      };
    },
    fetchGuildMember: async (guildId, userId) => {
      memberCalls.push([guildId, userId]);
      return {
        user: { id: userId, username: 'xxx', bot: false },
        nick: '频道昵称',
        roles: ['1'],
        joined_at: '2021-12-05T14:08:29+08:00'
      };
    }
  });

  await service.rememberGuild('123456789012345678', {
    author: { id: '2823701233424295228' }
  });

  assert.deepEqual(guildCalls, ['123456789012345678']);
  assert.deepEqual(memberCalls, [['123456789012345678', '2823701233424295228']]);
  assert.equal(await service.getStoredGuildName('123456789012345678'), '技术交流频道');
  assert.equal(
    await service.getStoredMemberName('123456789012345678', '2823701233424295228'),
    '频道昵称'
  );
  assert.deepEqual(
    await service.getLogLabels('123456789012345678', '2823701233424295228'),
    { groupName: '技术交流频道', userName: '频道昵称' }
  );
});

test('缓存有效期内不重复请求频道接口', async () => {
  const collection = createMemoryCollection([{
    _id: 'guild-1',
    guild_id: 'guild-1',
    name: '已有频道',
    fetched_at: new Date('2026-09-30T00:00:00+08:00')
  }]);
  const memberCollection = createMemoryCollection([{
    _id: 'guild-1:u1',
    guild_id: 'guild-1',
    user_id: 'u1',
    username: '已有成员',
    fetched_at: new Date('2026-09-30T00:00:00+08:00')
  }]);
  let guildFetch = 0;
  let memberFetch = 0;
  const service = createService({
    collection,
    memberCollection,
    fetchGuild: async () => {
      guildFetch += 1;
      return { name: '新频道' };
    },
    fetchGuildMember: async () => {
      memberFetch += 1;
      return { user: { id: 'u1', username: '新成员' } };
    }
  });

  await service.rememberGuild('guild-1', { author: { id: 'u1' } });
  await service.rememberGuild('guild-1', { author: { id: 'u1' } });
  assert.equal(guildFetch, 0);
  assert.equal(memberFetch, 0);
  assert.equal(await service.getStoredGuildName('guild-1'), '已有频道');
  assert.equal(await service.getStoredMemberName('guild-1', 'u1'), '已有成员');
});

test('频道资料失败不影响把事件里的昵称先写入成员缓存', async () => {
  const collection = createMemoryCollection();
  const memberCollection = createMemoryCollection();
  const service = createService({
    collection,
    memberCollection,
    fetchGuild: async () => {
      throw new Error('频道接口失败');
    },
    fetchGuildMember: async () => {
      throw new Error('成员接口失败');
    }
  });

  await service.rememberGuild('guild-fail', {
    author: { id: 'u2', username: '事件昵称' },
    member: { nick: '群名片' }
  });
  assert.equal(await service.getStoredGuildName('guild-fail'), null);
  assert.equal(await service.getStoredMemberName('guild-fail', 'u2'), '群名片');
});

test('未配置数据库时跳过频道拉取', async () => {
  let fetchCount = 0;
  const service = createGuildInfoService({
    isConfigured: () => false,
    fetchGuild: async () => {
      fetchCount += 1;
      return { name: '不应出现' };
    },
    logger: { warn() {}, debug() {} }
  });
  assert.equal(await service.rememberGuild('guild-skip', { author: { id: 'u1' } }), null);
  assert.equal(await service.getStoredGuildName('guild-skip'), null);
  assert.equal(fetchCount, 0);
});
