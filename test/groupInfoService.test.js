const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createGroupInfoService,
  shouldRefreshGroupInfo,
  parseQqApiError
} = require('../services/groupInfoService');

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
      return { matchedCount: 1, modifiedCount: 1, upsertedCount: doc._id ? 0 : 1 };
    },
    async bulkWrite(ops) {
      for (const op of ops) {
        if (op.updateOne) {
          await this.updateOne(
            op.updateOne.filter,
            op.updateOne.update,
            { upsert: op.updateOne.upsert }
          );
        }
      }
    }
  };
}

function createService({
  collection,
  memberCollection,
  fetchGroupInfo,
  fetchGroupMembers,
  refreshMs = 60 * 60 * 1000,
  now
}) {
  return createGroupInfoService({
    isConfigured: () => true,
    getCollection: async () => collection,
    getMemberCollection: async () => memberCollection || createMemoryCollection(),
    fetchGroupInfo,
    fetchGroupMembers: fetchGroupMembers || (async () => []),
    refreshMs,
    now: now || (() => new Date('2026-09-30T00:00:00+08:00')),
    logger: { warn() {}, debug() {} }
  });
}

test('缺少缓存或超过刷新间隔时需要重新拉取群资料', () => {
  const now = new Date('2026-09-30T12:00:00+08:00');
  assert.equal(shouldRefreshGroupInfo(null, now, 3600000), true);
  assert.equal(
    shouldRefreshGroupInfo({ fetched_at: new Date('2026-09-30T11:30:00+08:00') }, now, 3600000),
    false
  );
  assert.equal(
    shouldRefreshGroupInfo({ fetched_at: new Date('2026-09-30T10:00:00+08:00') }, now, 3600000),
    true
  );
});

test('收到群 openid 后拉取群名并写入集合', async () => {
  const collection = createMemoryCollection();
  const fetchCalls = [];
  const service = createService({
    collection,
    fetchGroupInfo: async (groupOpenid) => {
      fetchCalls.push(groupOpenid);
      return {
        group_openid: groupOpenid,
        group_name: '读书分享会',
        group_finger_memo: '每周共读一本好书',
        group_class_text: '文化',
        group_tags: ['阅读'],
        group_member_num: 256
      };
    }
  });

  const saved = await service.rememberGroupOpenid('3E5D8A1F7B2C9E4D6A0F1B3C5D7E9F2A');
  assert.equal(fetchCalls.length, 1);
  assert.equal(saved.group_name, '读书分享会');
  assert.equal(await service.getStoredGroupName('3E5D8A1F7B2C9E4D6A0F1B3C5D7E9F2A'), '读书分享会');
  assert.equal(collection.docs.get('3E5D8A1F7B2C9E4D6A0F1B3C5D7E9F2A').group_member_num, 256);
});

test('缓存仍在有效期内时不重复请求官方接口', async () => {
  const collection = createMemoryCollection([{
    _id: 'group-1',
    group_openid: 'group-1',
    group_name: '已有群名',
    fetched_at: new Date('2026-09-30T00:00:00+08:00')
  }]);
  let fetchCount = 0;
  const service = createService({
    collection,
    fetchGroupInfo: async () => {
      fetchCount += 1;
      return { group_name: '新群名' };
    }
  });

  await service.rememberGroupOpenid('group-1');
  await service.rememberGroupOpenid('group-1');
  assert.equal(fetchCount, 0);
  assert.equal(await service.getStoredGroupName('group-1'), '已有群名');
});

test('并发收到同一 openid 时只拉取一次', async () => {
  const collection = createMemoryCollection();
  let fetchCount = 0;
  let release;
  const pending = new Promise((resolve) => {
    release = resolve;
  });
  const service = createService({
    collection,
    fetchGroupInfo: async (groupOpenid) => {
      fetchCount += 1;
      await pending;
      return { group_openid: groupOpenid, group_name: '并发群' };
    }
  });

  const first = service.rememberGroupOpenid('group-concurrent');
  const second = service.rememberGroupOpenid('group-concurrent');
  release();
  const [a, b] = await Promise.all([first, second]);
  assert.equal(fetchCount, 1);
  assert.equal(a.group_name, '并发群');
  assert.equal(b.group_name, '并发群');
});

test('官方接口失败时不抛错，并避免短时间内重试', async () => {
  const collection = createMemoryCollection();
  let fetchCount = 0;
  const service = createService({
    collection,
    fetchGroupInfo: async () => {
      fetchCount += 1;
      const error = new Error('应用无接口访问权限');
      error.response = { status: 403, data: { code: 11253, message: '应用无接口访问权限' } };
      throw error;
    }
  });

  await service.rememberGroupOpenid('group-denied');
  await service.rememberGroupOpenid('group-denied');
  assert.equal(fetchCount, 1);
  assert.equal(await service.getStoredGroupName('group-denied'), null);
  assert.match(collection.docs.get('group-denied').last_error, /11253/);
});

test('未配置数据库时跳过拉取', async () => {
  let fetchCount = 0;
  const service = createGroupInfoService({
    isConfigured: () => false,
    fetchGroupInfo: async () => {
      fetchCount += 1;
      return { group_name: '不应出现' };
    },
    logger: { warn() {}, debug() {} }
  });

  assert.equal(await service.rememberGroupOpenid('group-skip'), null);
  assert.equal(await service.getStoredGroupName('group-skip'), null);
  assert.equal(fetchCount, 0);
});

test('解析 QQ 接口错误码', () => {
  assert.deepEqual(
    parseQqApiError({
      response: { status: 403, data: { code: 11253, message: '应用无接口访问权限' } }
    }),
    { code: 11253, message: '应用无接口访问权限' }
  );
});

test('拉取群资料时一并分页写入群成员', async () => {
  const collection = createMemoryCollection();
  const memberCollection = createMemoryCollection();
  const memberCalls = [];
  const service = createService({
    collection,
    memberCollection,
    fetchGroupInfo: async (groupOpenid) => ({
      group_openid: groupOpenid,
      group_name: '读书分享会'
    }),
    fetchGroupMembers: async (groupOpenid) => {
      memberCalls.push(groupOpenid);
      return [
        {
          member_openid: '969942F23E62DF96C38CD1FA36566760',
          username: '成员名',
          member_role: 'member',
          bot: false
        },
        {
          member_openid: 'EC58D87F598C8294A533B9D458DAAF33',
          username: 'T小不点101',
          member_role: 'admin'
        }
      ];
    }
  });

  const saved = await service.rememberGroupOpenid('7C8467413F22B6981B448E41DC8F1B5D');
  assert.deepEqual(memberCalls, ['7C8467413F22B6981B448E41DC8F1B5D']);
  assert.equal(saved.members_fetched, 2);
  assert.equal(
    await service.getStoredMemberName(
      '7C8467413F22B6981B448E41DC8F1B5D',
      '969942F23E62DF96C38CD1FA36566760'
    ),
    '成员名'
  );
  assert.deepEqual(
    await service.getLogLabels(
      '7C8467413F22B6981B448E41DC8F1B5D',
      '969942F23E62DF96C38CD1FA36566760'
    ),
    { groupName: '读书分享会', userName: '成员名' }
  );
});

test('群成员接口失败不影响群名入库', async () => {
  const collection = createMemoryCollection();
  const memberCollection = createMemoryCollection();
  const service = createService({
    collection,
    memberCollection,
    fetchGroupInfo: async (groupOpenid) => ({
      group_openid: groupOpenid,
      group_name: '还能记下群名'
    }),
    fetchGroupMembers: async () => {
      const error = new Error('应用无接口访问权限');
      error.response = { status: 403, data: { code: 11253, message: '应用无接口访问权限' } };
      throw error;
    }
  });

  const saved = await service.rememberGroupOpenid('group-members-denied');
  assert.equal(saved.group_name, '还能记下群名');
  assert.match(saved.members_last_error, /11253/);
  assert.equal(memberCollection.docs.size, 0);
});

test('消息里带昵称时会先写入该成员缓存', async () => {
  const collection = createMemoryCollection([{
    _id: 'group-1',
    group_openid: 'group-1',
    group_name: '已有群名',
    fetched_at: new Date('2026-09-30T00:00:00+08:00')
  }]);
  const memberCollection = createMemoryCollection();
  let memberFetchCount = 0;
  const service = createService({
    collection,
    memberCollection,
    fetchGroupInfo: async () => ({ group_name: '新群名' }),
    fetchGroupMembers: async () => {
      memberFetchCount += 1;
      return [];
    }
  });

  await service.rememberGroupOpenid('group-1', {
    author: {
      member_openid: 'member-1',
      username: '发言昵称'
    }
  });
  assert.equal(memberFetchCount, 0);
  assert.equal(await service.getStoredMemberName('group-1', 'member-1'), '发言昵称');
});
