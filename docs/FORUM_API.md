# 频道文章 API

所有 `/put/*` 路由都需要管理员 Bearer Token。

- `GET /put/status`：配置与 QQ 凭证状态
- `GET /put/guilds`：机器人所在频道列表
- `GET /put/channels?guild_id=<GUILD_ID>`：子频道列表
- `POST /put/custom`：发布自定义文章

`POST /put/custom` 请求体：

```json
{
  "channel_id": "<CHANNEL_ID>",
  "title": "标题",
  "content": "正文",
  "format": 2
}
```

真实频道 ID、应用凭证和公网主机名不得写入本文档。
