const fs = require('fs');
const path = require('path');
const { getCjkFontFaceCss } = require('./cjkFont');

const FONT_PATH = path.join(__dirname, '..', 'fonts', 'hk4e_zh-cn.ttf');
const CHART_PATH = path.join(__dirname, '..', 'features', 'mabinogi', 'Television', 'chart.umd.min.js');

let fontUrl;
let chartSource;

function getHanyiWenheiDataUrl() {
  if (!fontUrl) {
    if (!fs.existsSync(FONT_PATH)) {
      throw new Error('缺少 fonts/hk4e_zh-cn.ttf，无法按原版字体渲染');
    }
    fontUrl = `data:font/ttf;base64,${fs.readFileSync(FONT_PATH).toString('base64')}`;
  }
  return fontUrl;
}

function getChartJsSource() {
  if (!chartSource) {
    chartSource = fs.readFileSync(CHART_PATH, 'utf8');
  }
  return chartSource;
}

function wrapChartInitScript(body) {
  return [
    '(async function () {',
    '  try {',
    '    if (document.fonts) {',
    '      if (document.fonts.ready) await document.fonts.ready;',
    "      var names = ['HANYIWENHEI', 'BaibaiCJK', 'Microsoft YaHei'];",
    '      for (var i = 0; i < names.length; i++) {',
    "        try { await document.fonts.load('12px ' + names[i]); } catch (e) {}",
    "        try { await document.fonts.load('16px ' + names[i]); } catch (e) {}",
    '      }',
    '    }',
    '  } catch (e) {}',
    '  Chart.defaults.font.family = "HANYIWENHEI, BaibaiCJK, \'Microsoft YaHei\', sans-serif";',
    '  if (Chart.defaults.plugins && Chart.defaults.plugins.legend && Chart.defaults.plugins.legend.labels) {',
    '    Chart.defaults.plugins.legend.labels.font = Chart.defaults.plugins.legend.labels.font || {};',
    '    Chart.defaults.plugins.legend.labels.font.family = Chart.defaults.font.family;',
    '  }',
    '  try {',
    body,
    '  } finally {',
    "    document.documentElement.setAttribute('data-charts-ready', '1');",
    '  }',
    '})();'
  ].join('\n');
}

module.exports = {
  getChartJsSource,
  getCjkFontFaceCss,
  getHanyiWenheiDataUrl,
  wrapChartInitScript
};
