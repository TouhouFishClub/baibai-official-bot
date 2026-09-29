# 管理认证

管理账户仅从环境变量读取：

- `ADMIN_USERNAME`
- `ADMIN_PASSWORD`
- `ADMIN_DISPLAY_NAME`
- `ADMIN_ROLE`
- `JWT_SECRET`

项目不提供默认账户、默认密码或默认 JWT 密钥。生产环境缺少必填配置时服务拒绝启动。

登录接口为 `POST /admin/login`，成功后在 `/put/*` 和 `/auto-push/*` 请求中发送 `Authorization: Bearer <TOKEN>`。
