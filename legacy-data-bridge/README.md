# Legacy Data Bridge

部署在能够访问旧 MongoDB 的服务器上，为新官方机器人提供只读数据。该目录可独立复制和运行，不依赖旧 bot 进程。

## 安全边界

- 只开放固定查询：mbtv、mbcd、mbzz、mbtvs、mbcds、mbzzs、释放卷国服出处、mblogs、走私。
- 不提供任意集合名、任意 Mongo 条件或写操作。
- 请求和响应均使用 AES-256-GCM 加密，并绑定方法、路径、时间戳和 nonce。
- 请求时间窗口默认 60 秒，重复 nonce 会被拒绝。
- mblogs 仅返回同意公开排行的数据；匿名用户名称在老服务器侧脱敏。
- MongoDB 账号应配置为 `db_bot` 的只读账号。
- 应优先通过 Nginx/Caddy 提供 HTTPS；应用层加密不能隐藏目标地址和流量特征。

## 部署

```bash
cp .env.example .env
bash run.sh
```

`run.sh` 会执行 `npm ci --omit=dev`，并复用老服务器上原项目已经能够调用的 `forever` 命令，不需要安装 PM2 或其他全局包。重复执行脚本会先停止同名进程再按最新代码启动。

常用管理命令：

```bash
forever list
forever stop baibai-legacy-data-bridge
tail -f out.log
tail -f err.log
```

Node.js 最大堆内存与旧项目一致设置为 8192 MB；普通日志和错误日志分别追加到当前目录的 `out.log`、`err.log`。

使用以下命令生成共享密钥，并把同一个值分别写入老服和新服 `.env`：

```bash
openssl rand -base64 32
```

推荐让服务保持默认 `BRIDGE_HOST=127.0.0.1`，由 HTTPS 反向代理转发到 `127.0.0.1:3100`。如果必须直接暴露端口，显式设置 `BRIDGE_HOST=0.0.0.0`，同时保留云防火墙限流规则。

服务器时钟必须启用 NTP，否则加密请求会因时间偏差被拒绝。

## 验证

```bash
npm install
npm test
npm run check
curl http://127.0.0.1:3100/health
```

`/health` 只用于存活探测，不检查或泄露数据库状态。业务入口只有 `POST /v1/query`，明文请求会返回 401。
