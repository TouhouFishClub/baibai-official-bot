const fs = require('fs');
const path = require('path');
const logger = require('./logger');

let cachedFaceCss;
let cachedCss;
let warnedMissing = false;

function fontFaceFormat(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.otf') {
    return { mime: 'font/otf', format: 'opentype' };
  }
  if (ext === '.woff2') {
    return { mime: 'font/woff2', format: 'woff2' };
  }
  if (ext === '.woff') {
    return { mime: 'font/woff', format: 'woff' };
  }
  if (ext === '.ttc') {
    return { mime: 'font/collection', format: 'collection' };
  }
  return { mime: 'font/ttf', format: 'truetype' };
}

const PROJECT_FONTS_DIR = path.join(__dirname, '..', 'fonts');
const DEFAULT_CJK_FONT_NAME = 'msyh.ttc';
const PREFERRED_FONT_NAMES = [
  'msyh.ttc',
  'msyh.ttf',
  'msyhbd.ttc',
  'msyhl.ttc',
  'Microsoft YaHei.ttf',
  'MicrosoftYaHei.ttf',
  'STXIHEI.TTF',
  'FZJiHJW.TTF',
  'FZYouSTJW-R.TTF',
  'hk4e_zh-cn.ttf',
  'TXQYW3.ttf'
];

function resolveConfiguredFontPath(filePath) {
  if (!filePath) {
    return undefined;
  }
  const candidates = [
    filePath,
    path.resolve(filePath),
    path.resolve(__dirname, '..', filePath),
    path.join(PROJECT_FONTS_DIR, filePath)
  ];
  return candidates.find((candidate) => candidate && fs.existsSync(candidate));
}

function listProjectFontFiles() {
  if (!fs.existsSync(PROJECT_FONTS_DIR)) {
    return [];
  }

  let names = [];
  try {
    names = fs.readdirSync(PROJECT_FONTS_DIR);
  } catch (_) {
    return [];
  }

  const fontNames = names.filter((name) => /\.(ttf|ttc|otf|woff2|woff)$/i.test(name));
  const preferred = PREFERRED_FONT_NAMES
    .map((wanted) => fontNames.find((name) => name.toLowerCase() === wanted.toLowerCase()))
    .filter(Boolean);
  const rest = fontNames.filter((name) => !preferred.includes(name));
  return [...preferred, ...rest].map((name) => path.join(PROJECT_FONTS_DIR, name));
}

function systemFontPaths() {
  const linux = [
    '/usr/share/fonts/truetype/wqy/wqy-microhei.ttc',
    '/usr/share/fonts/truetype/wqy-microhei/wqy-microhei.ttc',
    '/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc',
    '/usr/share/fonts/opentype/noto/NotoSansCJKsc-Regular.otf',
    '/usr/share/fonts/truetype/noto/NotoSansSC-Regular.otf',
    '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc',
    '/usr/share/fonts/noto-cjk/NotoSansCJK-Regular.ttc',
    '/usr/share/fonts/truetype/droid/DroidSansFallbackFull.ttf',
    '/usr/share/fonts/truetype/arphic/uming.ttc',
    '/usr/share/fonts/opentype/source-han-sans/SourceHanSansCN-Regular.otf'
  ];
  const windows = process.platform === 'win32'
    ? [
        `${process.env.WINDIR || 'C:\\Windows'}\\Fonts\\msyh.ttc`,
        `${process.env.WINDIR || 'C:\\Windows'}\\Fonts\\msyh.ttf`,
        `${process.env.WINDIR || 'C:\\Windows'}\\Fonts\\simhei.ttf`,
        `${process.env.WINDIR || 'C:\\Windows'}\\Fonts\\simsun.ttc`
      ]
    : [];
  return [...linux, ...windows];
}

function findCjkFontPath() {
  const configuredPath = resolveConfiguredFontPath(process.env.CJK_FONT_PATH);
  if (configuredPath) {
    return configuredPath;
  }

  const projectFonts = listProjectFontFiles();
  const wantedName = String(process.env.CJK_FONT_NAME || DEFAULT_CJK_FONT_NAME).toLowerCase();
  const named = projectFonts.find((filePath) => path.basename(filePath).toLowerCase() === wantedName);
  if (named) {
    return named;
  }

  return [...projectFonts, ...systemFontPaths()].find((candidate) => fs.existsSync(candidate));
}

function getCjkFontFaceCss() {
  if (cachedFaceCss !== undefined) {
    return cachedFaceCss;
  }

  const fontPath = findCjkFontPath();
  if (!fontPath) {
    if (!warnedMissing) {
      warnedMissing = true;
      logger.warn('未找到中文字体，渲染图片中的汉字会变成方框。请将中文字体放到 fonts/ 目录，或设置 CJK_FONT_NAME / CJK_FONT_PATH');
    }
    cachedFaceCss = '';
    return cachedFaceCss;
  }

  const { mime, format } = fontFaceFormat(fontPath);
  const data = fs.readFileSync(fontPath).toString('base64');
  cachedFaceCss = `@font-face{font-family:'BaibaiCJK';src:url(data:${mime};base64,${data}) format('${format}');font-weight:normal;font-style:normal;}`;
  logger.info('已嵌入中文字体', { fontPath });
  return cachedFaceCss;
}

function getCjkFontCss() {
  if (cachedCss !== undefined) {
    return cachedCss;
  }
  const face = getCjkFontFaceCss();
  cachedCss = face
    ? `${face}html,body,*{font-family:'BaibaiCJK',"Noto Sans CJK SC","Microsoft YaHei",sans-serif !important;}`
    : '';
  return cachedCss;
}

function injectCjkFontHtml(html) {
  const css = getCjkFontCss();
  if (!css) {
    return html;
  }
  const tag = `<style>${css}</style>`;
  if (/<head[^>]*>/i.test(html)) {
    return html.replace(/<head[^>]*>/i, (match) => `${match}${tag}`);
  }
  return `${tag}${html}`;
}

function resetCjkFontCache() {
  cachedFaceCss = undefined;
  cachedCss = undefined;
  warnedMissing = false;
}

module.exports = {
  DEFAULT_CJK_FONT_NAME,
  PROJECT_FONTS_DIR,
  findCjkFontPath,
  getCjkFontCss,
  getCjkFontFaceCss,
  injectCjkFontHtml,
  listProjectFontFiles,
  resetCjkFontCache
};
