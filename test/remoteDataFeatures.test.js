const test = require('node:test');
const assert = require('node:assert/strict');
const {
  parseMblogsInput,
  describeSmuggler
} = require('../features/mabinogi/remoteDataFeatures');

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

test('走私原始数据在新服务器格式化', () => {
  const rows = describeSmuggler({
    recent: [{ type: 'appear', item: '儿童药水', area: '迪尔科内尔', ts: 1 }],
    latest: null,
    prediction: {
      goodsCN: '丝绸',
      positionCN: '塔尔汀',
      krTs: 2
    }
  });
  assert.equal(rows.length, 2);
  assert.equal(rows[0].status, '出现中');
  assert.equal(rows[1].category, '韩服下次预测');
});
