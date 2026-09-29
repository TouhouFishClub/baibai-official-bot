const path = require('path');
const { IMAGE_DATA } = require('../../baibaiConfigs');
const { getBrowserLaunchOptions } = require('../../utils/browserOptions');
const { htmlToImage } = require('../../utils/htmlToImage');

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

async function renderDataTable({ fileName, title, description, columns, rows }) {
  const output = path.join(IMAGE_DATA, 'mabi_other', fileName);
  const html = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><style>
*{box-sizing:border-box}body{margin:0;width:980px;padding:24px;background:#111827;color:#e5e7eb;font-family:"Microsoft YaHei",sans-serif}
.panel{background:#1f2937;border:1px solid #374151;border-radius:14px;overflow:hidden;box-shadow:0 12px 30px #0005}
header{padding:22px 26px;background:linear-gradient(135deg,#312e81,#1e3a8a)}
h1{margin:0 0 6px;font-size:28px}.desc{color:#c7d2fe;font-size:14px}
table{width:100%;border-collapse:collapse}th,td{padding:12px 14px;text-align:left;border-bottom:1px solid #374151}
th{color:#93c5fd;background:#111827;font-size:13px}td{font-size:14px;word-break:break-word}
tr:nth-child(even){background:#182234}.empty{text-align:center;padding:42px;color:#9ca3af}
</style></head><body><div class="panel"><header><h1>${escapeHtml(title)}</h1>
<div class="desc">${escapeHtml(description || '')}</div></header>
${rows.length ? `<table><thead><tr>${columns.map((column) => `<th>${escapeHtml(column.label)}</th>`).join('')}</tr></thead>
<tbody>${rows.map((row) => `<tr>${columns.map((column) => `<td>${escapeHtml(column.format ? column.format(row[column.key], row) : row[column.key])}</td>`).join('')}</tr>`).join('')}</tbody></table>` : '<div class="empty">暂无符合条件的数据</div>'}
</div></body></html>`;
  await htmlToImage({
    output,
    html,
    puppeteerArgs: getBrowserLaunchOptions()
  });
  return `[CQ:image,file=${path.join('send', 'mabi_other', fileName)}]`;
}

module.exports = { renderDataTable, escapeHtml };
