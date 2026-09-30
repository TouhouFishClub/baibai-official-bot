const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createGroupInfoService,
  shouldRefreshGroupInfo,
  shouldRefreshMemberInfo,
  parseQqApiError
} = require('../services/groupInfoService');

function matchQuery(doc, query) {
  return Object.entries(query).every(([key, value]) => {
    if (value && typeof value === 'object' && !Array.isArray(value) && Array.isArray(value.$nin)) {
      return !value.$nin.includes(doc[key]);
    }
    return doc[key] === value;
  });
}

function createMemoryCollection(initialDocs = []) {
  const docs = new Map(initialDocs.map((doc) => [doc._id, { ...doc }]));
  return {
    docs,
    async findOne(query, options = {}) {
      const matches = [...docs.values()].filter((doc) => matchQuery(doc, query));
      if (options.sort?.last_seen_at === -1) {
        matches.sort((a, b) => new Date(b.last_seen_at || 0) - new Date(a.last_seen_at || 0));
      }
      return matches[0] ? { ...matches[0] } : null;
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
  fetchGroupMember,
  refreshMs = 60 * 60 * 1000,
  memberRefreshMs,
  now
}) {
  return createGroupInfoService({
    isConfigured: () => true,
    getCollection: async () => collection,
    getMemberCollection: async () => memberCollection || createMemoryCollection(),
    fetchGroupInfo,
    fetchGroupMember: fetchGroupMember || (async () => ({ member_openid: 'skip', username: '忽略' })),
    refreshMs,
    memberRefreshMs,
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

test('成员已有名称或失败后按上次更新隔一天再请求，发言不会后延', () => {
  const now = new Date('2026-09-30T12:00:00+08:00');
  const day = 24 * 60 * 60 * 1000;
  assert.equal(shouldRefreshMemberInfo(null, now, day), true);
  assert.equal(
    shouldRefreshMemberInfo({ username: 'Егг' }, now, day),
    true
  );
  assert.equal(
    shouldRefreshMemberInfo({
      username: 'Егг',
      fetched_at: new Date('2026-09-30T00:00:00+08:00')
    }, now, day),
    false
  );
  assert.equal(
    shouldRefreshMemberInfo({
      username: 'Егг',
      fetched_at: new Date('2026-09-29T11:59:00+08:00')
    }, now, day),
    true
  );
  assert.equal(
    shouldRefreshMemberInfo({ fetched_at: new Date('2026-09-30T00:00:00+08:00') }, now, day),
    false
  );
  assert.equal(
    shouldRefreshMemberInfo({ fetched_at: new Date('2026-09-29T11:59:00+08:00') }, now, day),
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

test('收到群 openid 后按发言人拉取成员并入库', async () => {
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
    fetchGroupMember: async (groupOpenid, memberOpenid) => {
      memberCalls.push([groupOpenid, memberOpenid]);
      return {
        member_openid: memberOpenid,
        username: '小明',
        member_role: 'admin',
        bot: false,
        joined_at: '2025-08-20T09:15:00+08:00',
        union_openid: 'B4C6D8E0F2A4B6C8D0E2F4A6B8C0D2E4'
      };
    }
  });

  await service.rememberGroupOpenid('3E5D8A1F7B2C9E4D6A0F1B3C5D7E9F2A', {
    author: { member_openid: '7A3B9C1D5E2F4A6B8C0D1E3F5A7B9C2D' }
  });
  assert.deepEqual(memberCalls, [[
    '3E5D8A1F7B2C9E4D6A0F1B3C5D7E9F2A',
    '7A3B9C1D5E2F4A6B8C0D1E3F5A7B9C2D'
  ]]);
  assert.equal(
    await service.getStoredMemberName(
      '3E5D8A1F7B2C9E4D6A0F1B3C5D7E9F2A',
      '7A3B9C1D5E2F4A6B8C0D1E3F5A7B9C2D'
    ),
    '小明'
  );
  assert.deepEqual(
    await service.getLogLabels(
      '3E5D8A1F7B2C9E4D6A0F1B3C5D7E9F2A',
      '7A3B9C1D5E2F4A6B8C0D1E3F5A7B9C2D'
    ),
    { groupName: '读书分享会', userName: '小明' }
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
    fetchGroupMember: async () => {
      const error = new Error('应用无接口访问权限');
      error.response = { status: 403, data: { code: 11253, message: '应用无接口访问权限' } };
      throw error;
    }
  });

  const saved = await service.rememberGroupOpenid('group-members-denied', {
    author: { member_openid: 'member-denied' }
  });
  assert.equal(saved.group_name, '还能记下群名');
  assert.match(memberCollection.docs.get('group-members-denied:member-denied').last_error, /11253/);
});

test('事件里已有昵称时不请求群成员接口', async () => {
  const collection = createMemoryCollection();
  const memberCollection = createMemoryCollection();
  let memberFetch = 0;
  const service = createService({
    collection,
    memberCollection,
    fetchGroupInfo: async (groupOpenid) => ({
      group_openid: groupOpenid,
      group_name: '读书分享会'
    }),
    fetchGroupMember: async () => {
      memberFetch += 1;
      throw new Error('不应请求');
    }
  });

  await service.rememberGroupOpenid('group-named', {
    author: { member_openid: 'member-named', username: 'Егг' }
  });
  assert.equal(memberFetch, 0);
  assert.equal(await service.getStoredMemberName('group-named', 'member-named'), 'Егг');
});

test('成员冷却从上次更新起算，中间发言不会后延一天', async () => {
  let current = new Date('2026-09-30T00:00:00+08:00');
  const memberCollection = createMemoryCollection();
  let memberFetch = 0;
  const service = createService({
    collection: createMemoryCollection(),
    memberCollection,
    memberRefreshMs: 24 * 60 * 60 * 1000,
    now: () => current,
    fetchGroupInfo: async (groupOpenid) => ({
      group_openid: groupOpenid,
      group_name: '测试群'
    }),
    fetchGroupMember: async () => {
      memberFetch += 1;
      const error = new Error('应用无接口访问权限');
      error.response = { status: 403, data: { code: 11253, message: '应用无接口访问权限' } };
      throw error;
    }
  });

  await service.rememberGroupOpenid('g1', {
    author: { member_openid: 'm1', username: 'Егг' }
  });
  assert.equal(memberFetch, 0);

  current = new Date('2026-09-30T12:00:00+08:00');
  await service.rememberGroupOpenid('g1', {
    author: { member_openid: 'm1', username: 'Егг' }
  });
  assert.equal(memberFetch, 0);
  assert.equal(
    memberCollection.docs.get('g1:m1').fetched_at.getTime(),
    new Date('2026-09-30T00:00:00+08:00').getTime()
  );

  current = new Date('2026-10-01T00:00:01+08:00');
  await service.rememberGroupOpenid('g1', {
    author: { member_openid: 'm1', username: 'Егг' }
  });
  assert.equal(memberFetch, 1);
});

test('群资料在有效期内仍会按发言人补成员', async () => {
  const collection = createMemoryCollection([{
    _id: 'group-1',
    group_openid: 'group-1',
    group_name: '已有群名',
    fetched_at: new Date('2026-09-30T00:00:00+08:00')
  }]);
  const memberCollection = createMemoryCollection();
  let groupFetch = 0;
  let memberFetch = 0;
  const service = createService({
    collection,
    memberCollection,
    fetchGroupInfo: async () => {
      groupFetch += 1;
      return { group_name: '新群名' };
    },
    fetchGroupMember: async (_groupOpenid, memberOpenid) => {
      memberFetch += 1;
      return { member_openid: memberOpenid, username: '接口昵称' };
    }
  });

  await service.rememberGroupOpenid('group-1', {
    author: { member_openid: 'member-1', username: '发言昵称' }
  });
  assert.equal(groupFetch, 0);
  assert.equal(memberFetch, 0);
  assert.equal(await service.getStoredMemberName('group-1', 'member-1'), '发言昵称');
});

test('可按成员 openid 跨群取最近一次有昵称的记录', async () => {
  const service = createService({
    collection: createMemoryCollection(),
    memberCollection: createMemoryCollection([
      {
        _id: 'group-old:member-1',
        member_openid: 'member-1',
        username: '旧群昵称',
        last_seen_at: new Date('2026-09-29T10:00:00Z')
      },
      {
        _id: 'group-new:member-1',
        member_openid: 'member-1',
        username: '新群昵称',
        last_seen_at: new Date('2026-09-29T12:00:00Z')
      },
      {
        _id: 'group-empty:member-1',
        member_openid: 'member-1',
        username: '',
        last_seen_at: new Date('2026-09-29T13:00:00Z')
      }
    ]),
    fetchGroupInfo: async () => ({ group_name: '忽略' })
  });

  assert.equal(await service.findMemberNameByOpenid('member-1'), '新群昵称');
  assert.equal(await service.findMemberNameByOpenid('nobody'), null);
});
