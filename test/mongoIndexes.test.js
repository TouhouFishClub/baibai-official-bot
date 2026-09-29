const test = require('node:test');
const assert = require('node:assert/strict');
const { resolveIndexSpecs, ensureBotIndexes } = require('../services/mongo');

test('群成员按 openid 回查和用户别名查询会声明索引', () => {
  const specs = resolveIndexSpecs();
  const groupMemberIndex = specs.find((spec) => spec.options.name === 'member_openid_last_seen');
  const userIdIndex = specs.find((spec) => spec.options.name === 'user_id');
  const unionIndex = specs.find((spec) => spec.options.name === 'union_openid');

  assert.equal(groupMemberIndex.collection, 'qq_group_members');
  assert.deepEqual(groupMemberIndex.keys, { member_openid: 1, last_seen_at: -1 });
  assert.equal(userIdIndex.collection, 'qq_users');
  assert.equal(userIdIndex.options.sparse, true);
  assert.equal(unionIndex.collection, 'qq_users');
});

test('ensureBotIndexes 会对声明的集合调用 createIndex', async () => {
  const created = [];
  const db = {
    collection(name) {
      return {
        async createIndex(keys, options) {
          created.push({ name, keys, options });
          return options.name;
        }
      };
    }
  };

  const names = await ensureBotIndexes(db);
  assert.deepEqual(names, ['member_openid_last_seen', 'user_id', 'union_openid']);
  assert.equal(created.length, 3);
  assert.equal(created[0].name, 'qq_group_members');
  assert.deepEqual(created[0].keys, { member_openid: 1, last_seen_at: -1 });
});
