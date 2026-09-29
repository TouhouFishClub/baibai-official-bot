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

test('mblogs 在老服务器侧按原版分组并脱敏匿名角色', async () => {
  const collections = {
    cl_mabinogi_dps_ranking_consent: [
      { playerId: '451', mode: 'anonymous', playerName: '不应返回', serverId: 'yiluxia' },
      { playerId: '452', mode: 'public', playerName: '公开角色', serverId: 'yate' }
    ],
    cl_mabinogi_dps_records: [
      {
        characterId: '451', characterName: '真实名字', characterClass: '黑魔导士',
        dungeonName: '布里列赫', bossName: '枯木之佩塔克', bossGroup: 'petak', dps: 20, duration: 90
      },
      {
        characterId: '452', characterName: '旧名字', characterClass: '流星射手',
        dungeonName: '布里列赫', bossName: '布隆塔纳斯', bossGroup: 'brontanas', dps: 10, duration: 80
      },
      {
        characterId: '999', characterName: '未授权', characterClass: '黑魔导士',
        dungeonName: '布里列赫', bossName: '枯木之佩塔克', bossGroup: 'petak', dps: 999, duration: 70
      }
    ]
  };

  function matchQuery(row, query = {}) {
    if (query.$or) return query.$or.some((part) => matchQuery(row, part));
    if (query.$and) return query.$and.every((part) => matchQuery(row, part));
    return Object.entries(query).every(([key, cond]) => {
      if (cond && typeof cond === 'object' && cond.$in) return cond.$in.includes(row[key]);
      if (cond instanceof RegExp) return cond.test(String(row[key] || ''));
      return row[key] === cond;
    });
  }

  const db = {
    collection(name) {
      const rows = collections[name];
      return {
        find(query) {
          const selected = rows.filter((row) => matchQuery(row, query));
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
  assert.equal(result.mode, 'dungeon');
  assert.equal(result.title, 'DPS记录：布里列赫');
  assert.equal(result.sections.length, 2);
  const names = result.sections.flatMap((section) => section.rows.map((row) => row.characterName));
  assert.deepEqual(names.sort(), ['公开角色', '神秘的米莱西安']);
  assert.equal(result.sections.find((section) => section.title === '枯木之佩塔克').rows[0].rankingVisibility, 'anonymous');
  assert.equal(JSON.stringify(result).includes('真实名字'), false);
  assert.equal(JSON.stringify(result).includes('未授权'), false);
  assert.equal(JSON.stringify(result).includes('characterId'), false);
});
