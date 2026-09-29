# 文章推送配置

复制 `data/push_configs.example.json` 为 `data/push_configs.json`，通过管理页面维护频道、源地址、检查间隔和启用状态。

运行记录写入 `data/pushed_records.json`。这两个真实文件均不进入 Git。

管理 API 位于 `/auto-push/*`，必须携带管理员登录返回的 Bearer Token。文章源抓取失败不会阻止机器人消息服务启动。
