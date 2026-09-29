const fs = require('fs');
const path = require('path');
const { IMAGE_DATA } = require('../baibaiConfigs');

const CQ_IMAGE_PATTERN = /\[CQ:image,file=([^\]]+)\]/;

function normalizeModuleResult(rawResult) {
  const message = rawResult == null ? '' : String(rawResult);
  const imageMatch = message.match(CQ_IMAGE_PATTERN);

  if (!imageMatch) {
    return {
      type: 'text',
      message: message || '功能未返回内容'
    };
  }

  const relativePath = imageMatch[1].replace(/\\/g, '/').replace(/^send\//, '');
  const imagePath = path.resolve(IMAGE_DATA, relativePath);
  const imageRoot = `${path.resolve(IMAGE_DATA)}${path.sep}`;

  if (!imagePath.startsWith(imageRoot) || !fs.existsSync(imagePath)) {
    return {
      type: 'text',
      message: '图片生成失败，请稍后再试'
    };
  }

  const caption = message.replace(CQ_IMAGE_PATTERN, '').trim();
  return {
    type: 'image',
    path: relativePath,
    base64: fs.readFileSync(imagePath).toString('base64'),
    ...(caption ? { message: caption } : {})
  };
}

module.exports = {
  normalizeModuleResult
};
