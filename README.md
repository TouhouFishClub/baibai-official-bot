# BaiBai Official Bot

QQ 官方机器人服务，包含：

- 频道、群、QQ 私聊、频道私信消息回复
- 频道文章手动发布与自动推送
- 管理登录与管理页面
- 本地洛奇查询：`mbi`、`mbd`、`opt`、`meu`
- 本地 JSON 关键词问答及部分无数据库通用命令

本项目不再请求旧版 bot 的 OpenAPI，也不需要 MongoDB 才能启动。尚未迁移的数据库功能见 [TODO.md](TODO.md)。

## 环境要求

- Node.js 20 或更高版本
- 可选：可供 QQ 平台访问的公网 HTTPS 地址（发送生成图片时需要）
- Chrome、Edge 或 Chromium；无法自动检测时设置 `BROWSER_EXECUTABLE_PATH`

## 快速启动

```powershell
npm install
Copy-Item .env.example .env
Copy-Item config/channel.example.json config/channel.json
Copy-Item config/groups.example.json config/groups.json
npm start
```

在 `.env` 中填写 QQ、JWT 和管理员配置。不要提交 `.env`、真实频道/群配置或 `data/qa/`。

服务默认监听 `3000` 端口：

- `GET /`：健康状态
- `POST /qq/webhook`：QQ 回调
- `GET /admin`：管理页面
- `/put/*`：频道文章
- `/auto-push/*`：自动推送
- `/openapi/{mbi,mbd,opt,meu,mbtv,mbcd}`：具名命令兼容接口

消息 handler 直接把普通消息交给本地分发器，具名命令才进入对应命令处理器；不再存在旧版 `uni` 通用接口。

## 本地命令

- `mbi <关键词>`：简略配方
- `mbd <关键词>`：详细配方
- `opt <关键词>`：释放卷属性
- `meu <关键词>`：装备升级
- `boss` / `bosswork` / `boss工作表`：Boss 刷新时间表
- 其他文本：QA 查询或内置本地功能
- `关键词|回答`：管理员添加/更新 QA
- `关键词|`：管理员删除 QA

QA 管理员来自 `QA_WRITE_USER_IDS`、`config/channel.json` 的 `admin_user`，或 `config/groups.json` 中对应群的 `admin_users`。

## 开发验证

```powershell
npm run check
npm test
```

测试使用临时目录和 mock，不访问真实 QQ、旧 bot、MongoDB 或生产源站。

## PM2 日志

使用仓库内配置启动后，普通日志和错误详情会分别写入 `logs/baibai-official-bot-out.log` 与 `logs/baibai-official-bot-error.log`：

```bash
pm2 start ecosystem.config.js
pm2 save
```

`pm2 logs baibai-official-bot` 会同时显示两个日志流。只查看普通日志或错误详情时使用：

```bash
pm2 logs baibai-official-bot --out --lines 200
pm2 logs baibai-official-bot --err --lines 200
```

普通日志只记录错误摘要；错误日志记录经过脱敏、截断的单行详情，不会展开 Axios 的 request、headers 等对象。已有的旧日志可用 `pm2 flush` 清空。生产环境建议安装 `pm2-logrotate` 控制日志大小和保留时间。

仓库根目录提供了常用管理脚本：

```bash
bash run.sh          # 首次启动；已存在时按最新配置重启
bash restart.sh      # 重启
bash stop.sh         # 停止
bash log.sh 200      # 查看最近 200 行普通日志
bash err.sh 200      # 查看最近 200 行错误日志
```

## 安全

- 生产环境缺少 QQ/JWT/管理员必填配置时拒绝启动。
- 回调 token、签名、消息正文、base64 和 `file_info` 不写入日志。
- 所有真实凭证必须通过环境变量提供。
- 旧仓库文档中曾出现过敏感配置；上线前应在对应平台轮换旧凭证。
