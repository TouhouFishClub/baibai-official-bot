# 数据库功能迁移清单

当前版本不连接数据库。以下入口保留兼容回复，但不会加载原实现。

## 洛奇电视：`mbtv`、`mbcd`

- 原实现：`baibaibot/ai/mabinogi/Television/`
- 原数据：`cl_mbtv_*`、`cl_mbcd_*`、`cl_mabinogi_user_server`
- 后续方案：确定实时数据接入协议，选择 SQLite/PostgreSQL，并补充按服务器分区及保留期。
- 验收：可持续写入、按用户选服查询、无数据时明确回复、重启后数据不丢失。

## 日历与菜单

- 原实现：`baibaibot/ai/calendar.js`、`baibaibot/ai/menu.js`
- 原数据：`cl_calendar*`、`cl_menu`
- 后续方案：先定义权限和 schema，再迁入本地数据库；禁止把管理写操作暴露给普通用户。
- 验收：查询、添加、修改、删除、并发更新及权限测试全部通过。

## 抽卡与蛋池

- 原实现：`baibaibot/ai/mabinogi/gacha/`
- 原数据：`cl_mabinogi_gacha_info`、`cl_mabinogi_gacha`
- 后续方案：将只读蛋池快照与个人记录分离；移除页面脚本 `eval`，为数据源做签名或 schema 校验。
- 验收：固定随机种子测试、池更新回滚、用户记录隔离及数据源异常降级。

## 走私

- 原实现：`baibaibot/ai/mabinogi/smuggler/`
- 原数据：`cl_mabinogi_smuggler`
- 后续方案：将拉取调度器改为显式启动任务，不允许 `require` 时自动创建定时器；确认外部 Lute 数据源和代理配置。
- 验收：任务可启停、去重、过期清理、外部超时和无数据库启动测试。

## DPS / mblogs

- 原实现：`baibaibot/ai/mabinogi/logs/`
- 原数据：`cl_mabinogi_dps_*` 集合及 `mabidata/logs` 文件目录。
- 后续方案：单独设计上传鉴权、nonce、防重放、隐私同意和文件保留策略，再决定数据库。
- 验收：上传限流、签名、防重放、排行脱敏、备份恢复和删除请求。

## mabiPusher

- 原实现：`baibaibot/ai/mabinogi/mabiPusher.js`
- 原数据：`cl_mabinogi_pusher` 及电视/走私动态集合。
- 后续方案：定义受认证的内部事件格式，避免恢复旧服务器间的隐式通信。
- 验收：鉴权、幂等、重放保护、失败重试和审计记录。

## 释放卷国服出处

- 原实现：`baibaibot/ai/mabinogi/tools/optionsetWhere.js`
- 原数据：`cl_mabinogi_optionset`
- 后续方案：优先导出经过审计的只读 JSON 快照；确需在线维护时再接本地数据库。
- 验收：单卷出处、反向查询、管理员维护及快照版本回滚。

## Boss 工作表资源

- 原实现引用 `ai/mabinogi/BossWork/img/*.png` 和字体，但原仓库未包含这些文件。
- 后续方案：确认资源授权和来源后补齐，或重写为不依赖图片素材的 HTML/文本时间表。
- 验收：无缺失资源、跨时区日期测试、图片生成测试。

所有后续实现必须继续满足：无硬编码凭证、无模块加载副作用、可在数据库不可用时启动。
