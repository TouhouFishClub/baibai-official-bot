const fs = require('fs');
const path = require('path');

const cache = new Map();

function mimeForFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.ttf') return 'font/ttf';
  if (ext === '.otf') return 'font/otf';
  if (ext === '.woff') return 'font/woff';
  if (ext === '.woff2') return 'font/woff2';
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.gif') return 'image/gif';
  if (ext === '.svg') return 'image/svg+xml';
  return 'image/png';
}

function fileToDataUri(filePath) {
  const resolved = path.resolve(filePath);
  if (cache.has(resolved)) {
    return cache.get(resolved);
  }

  if (!fs.existsSync(resolved)) {
    cache.set(resolved, '');
    return '';
  }

  const uri = `data:${mimeForFile(resolved)};base64,${fs.readFileSync(resolved).toString('base64')}`;
  cache.set(resolved, uri);
  return uri;
}

function resetFileDataUriCache() {
  cache.clear();
}

module.exports = {
  fileToDataUri,
  resetFileDataUriCache
};
