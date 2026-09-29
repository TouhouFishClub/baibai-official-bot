const fs = require('fs');
const path = require('path');

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

module.exports = {
  getChartJsSource,
  getHanyiWenheiDataUrl
};
