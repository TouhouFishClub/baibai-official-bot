const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildTelevisionQuery,
  splitServerPrefix,
  escapeRegex,
  limitedString,
  queryMblogs
} = require('../src/repositories/queryRepository');

test('电视查询只允许受控字段并支持服务器前缀', () => {
  assert.deepEqual(splitServerPrefix('猫服 稀有卷'), {
    server: 'ylx',
    filter: '稀有卷'
  });
  assert.deepEqual(splitServerPrefix('亚特道具-角色'), {
    server: 'yate',
    filter: '道具-角色'
  });

  const query = buildTelevisionQuery('mbcd', '道具-角色-手帕');
  assert.deepEqual(Object.keys(query), ['$and']);
  assert.deepEqual(
    query.$and.map((condition) => Object.keys(condition)[0]),
    ['item_name', 'character_name', 'draw_pool']
  );

  const craft = buildTelevisionQuery('mbzz', '铠甲-角色');
  assert.deepEqual(Object.keys(craft), ['$and']);
  assert.deepEqual(
    craft.$and.map((condition) => Object.keys(condition)[0]),
    ['item_name', 'character_name']
  );
});

test('用户输入会转义正则元字符且仅保留百分号通配', () => {
  assert.equal(escapeRegex('a.*%b'), 'a\\.\\*.*b');
  assert.throws(() => limitedString('x'.repeat(81), 80, '查询内容'), /长度限制/);
});

test('mblogs 在老服务器侧过滤未授权记录并脱敏匿名角色', async () => {
  const collections = {
    cl_mabinogi_dps_ranking_consent: [
      { playerId: '451', mode: 'anonymous', playerName: '不应返回' },
      { playerId: '452', mode: 'public', playerName: '公开角色' }
    ],
    cl_mabinogi_dps_records: [
      { characterId: '451', characterName: '真实名字', dungeonName: '布里列赫', bossName: 'Boss', dps: 20 },
      { characterId: '452', characterName: '旧名字', dungeonName: '布里列赫', bossName: 'Boss', dps: 10 },
      { characterId: '999', characterName: '未授权', dungeonName: '布里列赫', bossName: 'Boss', dps: 999 }
    ]
  };
  const db = {
    collection(name) {
      const rows = collections[name];
      return {
        find(query) {
          const selected = name === 'cl_mabinogi_dps_records'
            ? rows.filter((row) => query.characterId.$in.includes(row.characterId))
            : rows;
          return {
            sort() { return this; },
            limit() { return this; },
            async toArray() { return selected; }
          };
        }
      };
    }
  };

  const result = await queryMblogs(db, { keyword: '布里列赫', showAll: true });
  assert.equal(result.rows.length, 2);
  assert.match(result.rows[0].characterName, /^匿名角色-/);
  assert.equal(result.rows[1].characterName, '公开角色');
  assert.equal(JSON.stringify(result).includes('真实名字'), false);
  assert.equal(JSON.stringify(result).includes('未授权'), false);
  assert.equal(JSON.stringify(result).includes('characterId'), false);
});
