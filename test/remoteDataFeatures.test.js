const test = require('node:test');
const assert = require('node:assert/strict');
const {
  parseMblogsInput,
  parseMbtvsArgs,
  parseMbcdsArgs,
  parseMbzzsArgs
} = require('../features/mabinogi/remoteDataFeatures');
const { computeSmugglerStatus } = require('../features/mabinogi/smuggler/renderSmuggler');

test('mblogs 参数在新服务器本地解析，排行上限由查询类型决定', () => {
  assert.deepEqual(
    parseMblogsInput('布里列赫 --rank 100 --job 黑魔导士 --all'),
    {
      keyword: '布里列赫',
      rank: 100,
      job: '黑魔导士',
      showAll: true,
      help: false
    }
  );
  assert.equal(parseMblogsInput('').keyword, '');
  assert.equal(parseMblogsInput('--job 流 子').job, '流 子');
});

test('mblogs 帮助文本与原版公开用法一致', () => {
  const { buildMblogsHelp } = require('../features/mabinogi/remoteDataFeatures');
  const help = buildMblogsHelp();
  assert.match(help, /【mblogs DPS 查询帮助】/);
  assert.match(help, /布里列赫/);
  assert.match(help, /--rank N/);
  assert.doesNotMatch(help, /AI锐评/);
});

test('统计命令参数与原版一致', () => {
  const tv = parseMbtvsArgs('稀有卷 2026-1-1 2026-4-1');
  assert.equal(tv.filter, '稀有卷');
  assert.equal(tv.start.getFullYear(), 2026);
  assert.equal(tv.end.getMonth(), 3);

  const cd = parseMbcdsArgs('角色名');
  assert.equal(cd.keyword, '角色名');
  assert.ok(cd.start instanceof Date);

  const zz = parseMbzzsArgs('');
  assert.equal(zz.itemFilter, null);
});

test('走私状态由最近观测反推当前相位', () => {
  const now = Date.parse('2026-01-01T00:10:00+08:00');
  const status = computeSmugglerStatus([
    { type: 'forecast', item: '儿童药水', area: '迪尔科内尔', ts: now - 4 * 60 * 1000 }
  ], now);
  assert.equal(status.status, 'forecast');
  assert.equal(status.item, '儿童药水');
  assert.equal(status.stale, false);
});

test('mblogs 渲染沿用原版卡片榜', () => {
  const { buildHtml, ANONYMOUS_CHARACTER_NAME } = require('../features/mabinogi/logs/renderMblogsList');
  const html = buildHtml({
    sections: [{
      title: '枯木之佩塔克',
      rows: [{
        characterName: ANONYMOUS_CHARACTER_NAME,
        characterClass: '黑魔导士',
        rankingVisibility: 'anonymous',
        serverId: 'yiluxia',
        dps: 1_500_000,
        duration: 90,
        teamSize: 4,
        damagePercent: 25,
        totalDamage: 100_000_000,
        bossHp: 698_000_000,
        runId: 'abc12345'
      }]
    }]
  });
  assert.match(html, /枯木之佩塔克/);
  assert.match(html, /神秘的米莱西安/);
  assert.match(html, /@伊鲁夏/);
  assert.match(html, /share-ring/);
  assert.match(html, /DAMAGE \/ SEC/);
  assert.match(html, /ZZZDisplay/);
});
