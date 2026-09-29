const test = require('node:test');
const assert = require('node:assert/strict');
const {
  parseMblogsInput,
  parseMbtvsArgs,
  parseMbcdsArgs,
  parseMbzzsArgs
} = require('../features/mabinogi/remoteDataFeatures');
const { computeSmugglerStatus } = require('../features/mabinogi/smuggler/renderSmuggler');

test('mblogs 参数在新服务器本地解析并限制排行数量', () => {
  assert.deepEqual(
    parseMblogsInput('布里列赫 --rank 100 --job 黑魔导士 --all'),
    {
      keyword: '布里列赫',
      rank: 30,
      job: '黑魔导士',
      showAll: true
    }
  );
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
