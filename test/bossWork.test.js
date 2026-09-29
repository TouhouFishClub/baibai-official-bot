const test = require('node:test');
const assert = require('node:assert/strict');
const { getBossRows } = require('../features/mabinogi/BossWork/BossWork');

test('Boss 工作表使用本地时间表生成全部 Boss 状态', () => {
  const rows = getBossRows(new Date(2026, 8, 29, 12, 0, 0));

  assert.equal(rows.length, 13);
  assert.ok(rows.some((row) => row.cnName === '黑龙'));
  assert.ok(rows.some((row) => row.cnName === '巨大鳄鱼'));

  for (const row of rows) {
    assert.match(row.nextInfo.time, /^\d{1,2}:\d{1,2}$/);
    assert.ok(row.currentInfo.count >= 0);
    assert.ok(Array.isArray(row.todayHours));
  }
});
