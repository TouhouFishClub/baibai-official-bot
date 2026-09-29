const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { getBossRows } = require('../features/mabinogi/BossWork/BossWork');

const BOSS_IMAGES = [
  'BlackDragon.png',
  'WhiteDragon.png',
  'PrairieDragon.png',
  'DesertDragon.png',
  'RedDragon.png',
  'Mokkurkalfi.png',
  'SylvanDragon.png',
  'Mammoth.png',
  'Ifrit.png',
  'Yeti.png',
  'GiantLion.png',
  'GiantSandworm.png',
  'GiantAlligator.png'
];

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

test('Boss 工作表已迁移原版立绘并嵌入图片', () => {
  const imgDir = path.join(__dirname, '../features/mabinogi/BossWork/img');
  for (const name of BOSS_IMAGES) {
    assert.ok(fs.existsSync(path.join(imgDir, name)), name);
  }
  const source = fs.readFileSync(
    path.join(__dirname, '../features/mabinogi/BossWork/BossWork.js'),
    'utf8'
  );
  assert.match(source, /class="boss-image"/);
  assert.match(source, /BossImageParser/);
});
