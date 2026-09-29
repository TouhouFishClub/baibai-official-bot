# 快速部署

1. 安装 Node.js 20+，在项目目录执行 `npm install`。
2. 将 `.env.example` 复制为 `.env`，填写所有必填项。
3. 将 `config/*.example.json` 复制为对应的 `.json`，填入频道、管理员和可选群映射。
4. 执行 `npm run check` 和 `npm test`。
5. 执行 `npm start`。
6. 将 QQ 平台回调设置为 `https://<PUBLIC_HOST>/qq/webhook`。

管理页面位于 `https://<PUBLIC_HOST>/admin`。若需要发送查询生成的图片，`SERVER_HOST` 必须是 QQ 可访问的 HTTPS 地址。

不要提交 `.env`、`config/channel.json`、`config/groups.json`、`data/qa/`、推送运行数据或生成图片。
