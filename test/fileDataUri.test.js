const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { fileToDataUri, resetFileDataUriCache } = require('../utils/fileDataUri');

test('本地文件可转为 data URI，缺失文件返回空', () => {
  resetFileDataUriCache();
  const filePath = path.join(os.tmpdir(), `data-uri-${process.pid}.png`);
  fs.writeFileSync(filePath, Buffer.from('png'));
  try {
    assert.match(fileToDataUri(filePath), /^data:image\/png;base64,/);
    assert.equal(fileToDataUri(`${filePath}.missing`), '');
  } finally {
    resetFileDataUriCache();
    fs.unlinkSync(filePath);
  }
});

test('配方渲染不再通过 file:// 加载本地模板', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '../features/mabinogi/recipeRebuild/renderRecipe.js'),
    'utf8'
  );
  assert.equal(source.includes('pathToFileURL'), false);
  assert.match(source, /setContent\(injectCjkFontHtml\(TEMPLATE_HTML\)/);
});
